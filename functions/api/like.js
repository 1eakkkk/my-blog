import { json, getUser, readJson, positiveId, isBanned } from './_lib.js';

export async function onRequestPost(context) {
  const db = context.env.DB;
  const user = await getUser(context);
  if (!user) return json({ success: false, error: '请先登录' }, { status: 401 });
  if (isBanned(user)) return json({ success: false, error: '账号封禁中' }, { status: 403 });

  const { target_id, target_type } = await readJson(context.request);
  if (!positiveId(target_id) || !['post', 'comment'].includes(target_type)) {
    return json({ success: false, error: '参数无效' }, { status: 400 });
  }

  const table = target_type === 'post' ? 'posts' : 'comments';
  const visibleTable = target_type === 'post' ? 'active_posts' : 'active_comments';
  const target = await db.prepare(`SELECT id FROM ${visibleTable} WHERE id = ?`).bind(target_id).first();
  if (!target) return json({ success: false, error: '内容不存在' }, { status: 404 });
  const existing = await db.prepare('SELECT id FROM likes WHERE user_id = ? AND target_id = ? AND target_type = ?')
    .bind(user.id, target_id, target_type).first();

  // 写点赞记录 + 重算计数放进同一个 batch（D1 的 batch 是原子事务）
  // like_count 直接按 COUNT(*) 重算而非 ±1：并发安全，且历史漂移会被自动纠正
  const writeStmt = existing
    ? db.prepare(`DELETE FROM likes WHERE id = ? AND EXISTS (SELECT 1 FROM ${visibleTable} WHERE id = ?)`)
        .bind(existing.id, target_id)
    : db.prepare(`INSERT OR IGNORE INTO likes (user_id, target_id, target_type, created_at)
        SELECT ?,?,?,? FROM ${visibleTable} WHERE id=?`)
        .bind(user.id, target_id, target_type, Date.now(), target_id);

  await db.batch([
    writeStmt,
    db.prepare(`UPDATE ${table} SET like_count = (SELECT COUNT(*) FROM likes WHERE target_id = ? AND target_type = ?)
      WHERE id = ? AND EXISTS (SELECT 1 FROM ${visibleTable} WHERE id = ?)`)
      .bind(target_id, target_type, target_id, target_id)
  ]);

  const row = await db.prepare(`SELECT like_count FROM ${visibleTable} WHERE id = ?`).bind(target_id).first();
  if (!row) return json({ success: false, error: '内容已移入回收站或不存在' }, { status: 404 });

  return json({
    success: true,
    action: existing ? 'unliked' : 'liked',
    like_count: row ? row.like_count : 0
  });
}
