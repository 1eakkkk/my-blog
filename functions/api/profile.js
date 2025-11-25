// --- functions/api/profile.js ---
export async function onRequestPost(context) {
  const db = context.env.DB;
  const { nickname } = await context.request.json();

  if (!nickname || nickname.length > 12) {
    return new Response(JSON.stringify({ success: false, error: '昵称无效 (1-12字符)' }), { status: 400 });
  }

  // 鉴权
  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: false, error: '请先登录' }), { status: 401 });
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

  // 更新昵称
  await db.prepare('UPDATE users SET nickname = ? WHERE id = ?').bind(nickname, user.id).run();

  return new Response(JSON.stringify({ success: true, message: '身份识别码(昵称)已更新', nickname }), { headers: { 'Content-Type': 'application/json' } });
}
