import { json, getUser } from './_lib.js';

export async function onRequestPost(context) {
  const db = context.env.DB;
  const user = await getUser(context);
  if (!user) return json({ success: false, error: '请先登录' }, { status: 401 });

  const { target_id, target_type } = await context.request.json();
  if (!target_id || !['post', 'comment'].includes(target_type)) {
    return json({ success: false, error: '参数无效' }, { status: 400 });
  }

  const table = target_type === 'post' ? 'posts' : 'comments';
  const existing = await db.prepare('SELECT id FROM likes WHERE user_id = ? AND target_id = ? AND target_type = ?')
    .bind(user.id, target_id, target_type).first();

  // 写点赞记录 + 重算计数放进同一个 batch（D1 的 batch 是原子事务）
  // like_count 直接按 COUNT(*) 重算而非 ±1：并发安全，且历史漂移会被自动纠正
  const writeStmt = existing
    ? db.prepare('DELETE FROM likes WHERE id = ?').bind(existing.id)
    : db.prepare('INSERT OR IGNORE INTO likes (user_id, target_id, target_type, created_at) VALUES (?, ?, ?, ?)')
        .bind(user.id, target_id, target_type, Date.now());

  await db.batch([
    writeStmt,
    db.prepare(`UPDATE ${table} SET like_count = (SELECT COUNT(*) FROM likes WHERE target_id = ? AND target_type = ?) WHERE id = ?`)
      .bind(target_id, target_type, target_id)
  ]);

  const row = await db.prepare(`SELECT like_count FROM ${table} WHERE id = ?`).bind(target_id).first();

  return json({
    success: true,
    action: existing ? 'unliked' : 'liked',
    like_count: row ? row.like_count : 0
  });
}
