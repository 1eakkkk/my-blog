import { json, getUser, readJson, positiveId, isBanned } from './_lib.js';

export async function onRequestGet(context) {
  const user = await getUser(context);
  if (!user) return json({ success: false, error: '请先登录' }, { status: 401 });
  if (isBanned(user)) return json({ success: false, error: '账号封禁中' }, { status: 403 });
  const url = new URL(context.request.url);
  const page = url.searchParams.has('page') ? positiveId(url.searchParams.get('page')) : 1;
  if (!page || page > 100000) return json({ success: false, error: '页码无效' }, { status: 400 });
  const db = context.env.DB;
  const limit = 20;
  const rows = await db.prepare(`SELECT r.kind,r.target_id,r.owner_id,r.deleted_by,r.deleted_at,
      CASE WHEN r.kind='post' THEN p.id ELSE c.post_id END AS post_id,
      CASE WHEN r.kind='post' THEN p.title ELSE cp.title END AS title,
      CASE WHEN r.kind='post' THEN substr(p.content,1,180) ELSE c.content END AS preview,
      CASE WHEN r.kind='post' THEN (SELECT COUNT(*) FROM comments child WHERE child.post_id=p.id)
        ELSE (SELECT COUNT(*) FROM comments child WHERE child.parent_id=c.id AND child.post_id=c.post_id) END AS child_count,
      CASE WHEN r.kind='comment' AND (NOT EXISTS (SELECT 1 FROM active_posts ap WHERE ap.id=c.post_id)
        OR (c.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM active_comments ac WHERE ac.id=c.parent_id))) THEN 1 ELSE 0 END AS parent_deleted
    FROM content_recycle r
    LEFT JOIN posts p ON r.kind='post' AND p.id=r.target_id
    LEFT JOIN comments c ON r.kind='comment' AND c.id=r.target_id
    LEFT JOIN posts cp ON cp.id=c.post_id
    WHERE (?=1 OR r.owner_id=?) AND (p.id IS NOT NULL OR c.id IS NOT NULL)
    ORDER BY r.deleted_at DESC,r.kind,r.target_id DESC LIMIT ? OFFSET ?`)
    .bind(user.role === 'admin' ? 1 : 0, user.id, limit + 1, (page - 1) * limit).all();
  const hasMore = rows.results.length > limit;
  const items = rows.results.slice(0, limit).map(item => ({ ...item,
    restore_allowed: !item.parent_deleted && (user.role === 'admin' || (item.owner_id === user.id && item.deleted_by === user.id))
  }));
  return json({ success: true, items, page, has_more: hasMore });
}

export async function onRequestPost(context) {
  const user = await getUser(context);
  if (!user) return json({ success: false, error: '请先登录' }, { status: 401 });
  if (isBanned(user)) return json({ success: false, error: '账号封禁中' }, { status: 403 });
  const { action, kind, id } = await readJson(context.request);
  if (action !== 'restore' || !['post', 'comment'].includes(kind) || !positiveId(id)) return json({ success: false, error: '恢复参数无效' }, { status: 400 });
  const db = context.env.DB;
  const item = await db.prepare('SELECT * FROM content_recycle WHERE kind=? AND target_id=?').bind(kind, id).first();
  if (!item) return json({ success: false, error: '内容已经恢复或不存在' }, { status: 404 });
  if (user.role !== 'admin' && (item.owner_id !== user.id || item.deleted_by !== user.id)) return json({ success: false, error: '只有删除者本人或管理员可以恢复此内容' }, { status: 403 });
  if (kind === 'comment') {
    const parent = await db.prepare('SELECT post_id,parent_id FROM comments WHERE id=?').bind(id).first();
    if (!parent || !await db.prepare('SELECT id FROM active_posts WHERE id=?').bind(parent.post_id).first() ||
        (parent.parent_id !== null && !await db.prepare('SELECT id FROM active_comments WHERE id=? AND post_id=?').bind(parent.parent_id, parent.post_id).first())) {
      return json({ success: false, error: '请先恢复所属帖子或主评论' }, { status: 409 });
    }
  }
  // Compare the original deletion record so a concurrent newer deletion cannot be undone.
  const result = await db.prepare(`DELETE FROM content_recycle WHERE kind=? AND target_id=? AND deletion_id=? AND deleted_by=?
    AND (?=1 OR (owner_id=? AND deleted_by=?))
    AND ((?='post' AND EXISTS (SELECT 1 FROM posts p WHERE p.id=?)) OR (?='comment' AND EXISTS (SELECT 1 FROM comments c JOIN active_posts p ON p.id=c.post_id
      WHERE c.id=? AND (c.parent_id IS NULL OR EXISTS (SELECT 1 FROM active_comments root WHERE root.id=c.parent_id AND root.post_id=c.post_id)))) )`)
    .bind(kind, id, item.deletion_id, item.deleted_by, user.role === 'admin' ? 1 : 0, user.id, user.id, kind, id, kind, id).run();
  if (!result.meta.changes) return json({ success: false, error: '内容状态已变化，请刷新后重试' }, { status: 409 });
  return json({ success: true, message: '已恢复，原来的时间、评论和点赞均保留', post_id: kind === 'post' ? Number(id) : (await db.prepare('SELECT post_id FROM comments WHERE id=?').bind(id).first())?.post_id });
}
