// --- functions/api/draw.js ---
export async function onRequestPost(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: false, error: '请先登录' }), { status: 401 });
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare(`SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

  if (user.status === 'banned' && user.ban_expires_at > Date.now()) return new Response(JSON.stringify({ success: false, error: '账号封禁中' }));

  // === UTC+8 日期 ===
  const now = new Date();
  const utc8 = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const today = utc8.toISOString().split('T')[0];

  if (user.last_draw === today) {
    return new Response(JSON.stringify({ success: false, error: '今日机会已用完' }));
  }

  let min = user.is_vip ? 30 : 1;
  let max = user.is_vip ? 150 : 100;
  const randomXP = Math.floor(Math.random() * (max - min + 1)) + min;

  await db.prepare('UPDATE users SET xp = xp + ?, last_draw = ? WHERE id = ?')
    .bind(randomXP, today, user.id)
    .run();

  return new Response(JSON.stringify({ success: true, message: `欧气爆发！获得 ${randomXP} 经验值！`, xpAdded: randomXP }));
}
