// --- functions/api/like.js ---
export async function onRequestPost(context) {
  const db = context.env.DB;
  
  // 鉴权
  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: false, error: '请先登录' }), { status: 401 });
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const user = await db.prepare(`SELECT id FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

  const { target_id, target_type } = await context.request.json(); // type: 'post' or 'comment'

  // 1. 检查是否已经点赞
  const existing = await db.prepare('SELECT id FROM likes WHERE user_id = ? AND target_id = ? AND target_type = ?')
    .bind(user.id, target_id, target_type).first();

  let isLiked = false;
  let change = 0;

  if (existing) {
    // 取消点赞
    await db.prepare('DELETE FROM likes WHERE id = ?').bind(existing.id).run();
    change = -1;
    isLiked = false;
  } else {
    // 点赞
    await db.prepare('INSERT INTO likes (user_id, target_id, target_type, created_at) VALUES (?, ?, ?, ?)')
      .bind(user.id, target_id, target_type, Date.now()).run();
    change = 1;
    isLiked = true;
  }

  // 更新计数表
  const table = target_type === 'post' ? 'posts' : 'comments';
  await db.prepare(`UPDATE ${table} SET like_count = like_count + ? WHERE id = ?`).bind(change, target_id).run();

  // 获取最新数量
  const count = await db.prepare(`SELECT like_count FROM ${table} WHERE id = ?`).bind(target_id).first();

  return new Response(JSON.stringify({ success: true, isLiked, count: count.like_count }));
}
