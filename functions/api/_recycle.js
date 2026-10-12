import { json } from './_lib.js';

// A tombstone hides the content without destroying its descendants or likes.
export async function recycleContent(db, user, kind, id) {
  const source = kind === 'post' ? 'active_posts' : 'active_comments';
  const row = await db.prepare(`SELECT user_id FROM ${source} WHERE id = ?`).bind(id).first();
  if (!row) return json({ success: false, error: '内容已移入回收站或不存在' }, { status: 404 });
  if (row.user_id !== user.id && user.role !== 'admin') return json({ success: false, error: '无权删除此内容' }, { status: 403 });
  const result = await db.prepare(`INSERT OR IGNORE INTO content_recycle (kind,target_id,owner_id,deleted_by,deleted_at,deletion_id)
    SELECT ?,id,user_id,?,?,? FROM ${source} WHERE id = ? AND (user_id = ? OR ? = 1)`)
    .bind(kind, user.id, Date.now(), crypto.randomUUID(), id, user.id, user.role === 'admin' ? 1 : 0).run();
  if (!result.meta.changes) return json({ success: false, error: '内容已移入回收站或不存在' }, { status: 409 });
  return json({ success: true, message: kind === 'post' ? '帖子已移入回收站，可在个人设置中恢复' : '评论已移入回收站，可在个人设置中恢复' });
}
