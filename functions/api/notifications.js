import { json, getUser, readJson, positiveId, isBanned } from './_lib.js';

// 接收关系在读取时由现存评论计算，删除和恢复无需维护第二份通知正文。
// 顶层评论送给帖主；回复送给被回复的人；自己发出的内容不提醒自己。
const SOURCE = `FROM active_comments c JOIN active_posts p ON p.id = c.post_id
  LEFT JOIN notification_reads receipt ON receipt.comment_id = c.id AND receipt.user_id = ?`;
const RECIPIENT = `c.user_id <> ? AND
  ((c.parent_id IS NULL AND p.user_id = ?) OR (c.parent_id IS NOT NULL AND c.reply_to_uid = ?))`;
const UNREAD = `(c.created_at >= ? AND receipt.comment_id IS NULL)`;

function scope(userId) { return [userId, userId, userId, userId]; }
function parseCursor(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const match = /^([1-9]\d*):([1-9]\d*)$/.exec(value);
  if (!match) return null;
  const createdAt = Number(match[1]), id = Number(match[2]);
  return Number.isSafeInteger(createdAt) && Number.isSafeInteger(id) ? { createdAt, id } : null;
}

async function authenticated(context) {
  const user = await getUser(context);
  if (!user) return { error: json({ error: '请先登录' }, { status: 401 }) };
  if (isBanned(user)) return { error: json({ error: '账号封禁中' }, { status: 403 }) };
  const setting = await context.env.DB.prepare("SELECT value FROM system_settings WHERE key = 'site_inbox_started_at'").first();
  const startedAt = Number(setting?.value);
  if (!Number.isSafeInteger(startedAt) || startedAt <= 0) return { error: json({ error: '回复提醒暂未启用' }, { status: 503 }) };
  return { user, startedAt };
}

async function counts(db, userId, startedAt) {
  return db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(${UNREAD}), 0) AS unread_count,
    COALESCE(MAX(c.id), 0) AS read_through ${SOURCE} WHERE ${RECIPIENT}`)
    .bind(startedAt, ...scope(userId)).first();
}

function excerpt(content) {
  return String(content || '').replace(/<[^>]*>/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*_#>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

export async function onRequestGet(context) {
  const auth = await authenticated(context);
  if (auth.error) return auth.error;
  const { user, startedAt } = auth;
  const query = new URL(context.request.url).searchParams;
  const page = query.has('page') ? positiveId(query.get('page')) : 1;
  const limit = query.has('limit') ? positiveId(query.get('limit')) : 20;
  const unreadOnly = query.get('unread') === '1';
  const summary = query.get('summary') === '1';
  const cursor = query.has('cursor') ? parseCursor(query.get('cursor')) : null;
  if (!page || page > 100000 || !limit || limit > 50 ||
      (query.has('cursor') && (!cursor || page !== 1)) ||
      (query.has('unread') && !['0', '1'].includes(query.get('unread'))) ||
      (query.has('summary') && !['0', '1'].includes(query.get('summary')))) {
    return json({ error: '分页参数无效' }, { status: 400 });
  }
  const db = context.env.DB;
  const totals = await counts(db, user.id, startedAt);
  if (summary) return json(totals);
  const offset = cursor ? 0 : (page - 1) * limit;
  const rows = await db.prepare(`SELECT c.id AS comment_id, c.post_id, c.created_at,
    c.parent_id, c.content, p.title AS post_title, users.username, users.nickname,
    ${UNREAD} AS is_unread ${SOURCE} JOIN users ON users.id = c.user_id
    WHERE ${RECIPIENT}${unreadOnly ? ` AND ${UNREAD}` : ''}${cursor ? ' AND (c.created_at < ? OR (c.created_at = ? AND c.id < ?))' : ''}
    ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`)
    .bind(startedAt, ...scope(user.id), ...(unreadOnly ? [startedAt] : []), ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []), limit + 1, offset).all();
  const returned = rows.results.slice(0, limit);
  const results = returned.map(row => ({ comment_id: row.comment_id, post_id: row.post_id,
    created_at: row.created_at, kind: row.parent_id ? 'reply' : 'comment', post_title: row.post_title,
    username: row.username, nickname: row.nickname, excerpt: excerpt(row.content), is_unread: Boolean(row.is_unread) }));
  const filteredTotal = unreadOnly ? totals.unread_count : totals.total;
  const last = returned.at(-1);
  return json({ ...totals, filtered_total: filteredTotal, page, limit, has_more: rows.results.length > limit,
    next_cursor: last ? `${last.created_at}:${last.comment_id}` : null, results });
}

export async function onRequestPut(context) {
  const auth = await authenticated(context);
  if (auth.error) return auth.error;
  const { user, startedAt } = auth;
  const payload = await readJson(context.request);
  const db = context.env.DB;
  if (payload.action === 'read') {
    const id = positiveId(payload.comment_id);
    if (!id) return json({ error: '评论编号无效' }, { status: 400 });
    const result = await db.prepare(`INSERT OR IGNORE INTO notification_reads (user_id, comment_id, read_at)
      SELECT ?, c.id, ? ${SOURCE} WHERE ${RECIPIENT} AND c.id = ?`)
      .bind(user.id, Date.now(), ...scope(user.id), id).run();
    // 已读操作幂等；他人的评论编号没有写入或读取已读状态的权限。
    if (!result.meta.changes) {
      const owned = await db.prepare(`SELECT c.id ${SOURCE} WHERE ${RECIPIENT} AND c.id = ?`).bind(...scope(user.id), id).first();
      if (!owned) return json({ error: '回复不存在' }, { status: 404 });
    }
  } else if (payload.action === 'read_all') {
    const through = positiveId(payload.through_id);
    if (!through) return json({ error: '已读范围无效' }, { status: 400 });
    // 只标记本次列表看到的快照；提交期间新到达的回复继续保持未读。
    await db.prepare(`INSERT OR IGNORE INTO notification_reads (user_id, comment_id, read_at)
      SELECT ?, c.id, ? ${SOURCE} WHERE ${RECIPIENT} AND ${UNREAD} AND c.id <= ?`)
      .bind(user.id, Date.now(), ...scope(user.id), startedAt, through).run();
  } else return json({ error: '未知操作' }, { status: 400 });
  return json({ success: true, ...(await counts(db, user.id, startedAt)) });
}
