export async function onRequestPost(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');

  // 1. 验证登录
  if (!cookie || !cookie.includes('session_id')) {
    return new Response(JSON.stringify({ success: false, message: '请先登录' }), { status: 401 });
  }
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare(`
    SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?
  `).bind(sessionId).first();

  if (!user) return new Response(JSON.stringify({ success: false, message: '会话无效' }), { status: 401 });

  // 2. 签到逻辑
  const today = new Date().toDateString();
  if (user.last_check_in === today) {
    return new Response(JSON.stringify({ success: false, message: '今日已签到', coins: user.coins }));
  }

  const newCoins = user.coins + 10;
  await db.prepare('UPDATE users SET coins = ?, last_check_in = ? WHERE id = ?')
    .bind(newCoins, today, user.id)
    .run();

  return new Response(JSON.stringify({ success: true, message: '签到成功 +10', coins: newCoins }));
}