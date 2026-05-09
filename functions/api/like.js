export async function onRequestPost(context) {
  const db = context.env.DB;

  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: false, error: '请先登录' }), { status: 401 });
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const user = await db.prepare(`SELECT id, username, nickname FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

  const { target_id, target_type } = await context.request.json();

  const existing = await db.prepare('SELECT id FROM likes WHERE user_id = ? AND target_id = ? AND target_type = ?')
    .bind(user.id, target_id, target_type).first();

  let action, change;
  if (existing) {
    await db.prepare('DELETE FROM likes WHERE id = ?').bind(existing.id).run();
    change = -1;
    action = 'unliked';
  } else {
    await db.prepare('INSERT INTO likes (user_id, target_id, target_type, created_at) VALUES (?, ?, ?, ?)')
      .bind(user.id, target_id, target_type, Date.now()).run();
    change = 1;
    action = 'liked';
  }

  const table = target_type === 'post' ? 'posts' : 'comments';
  await db.prepare(`UPDATE ${table} SET like_count = like_count + ? WHERE id = ?`).bind(change, target_id).run();

  const count = await db.prepare(`SELECT like_count FROM ${table} WHERE id = ?`).bind(target_id).first();

  return new Response(JSON.stringify({ success: true, action, like_count: count.like_count }));
}
