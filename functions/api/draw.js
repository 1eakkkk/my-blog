// --- functions/api/draw.js ---
export async function onRequestPost(context) {
  const db = context.env.DB;
  
  // 1. 鉴权
  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) {
    return new Response(JSON.stringify({ success: false, error: '请先登录' }), { status: 401 });
  }
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

  // 2. 检查今天是否抽过
  const today = new Date().toDateString();
  if (user.last_draw === today) {
    return new Response(JSON.stringify({ success: false, error: '今日机会已用完，明天再来吧！' }));
  }

  // 3. 随机逻辑 (1 - 100 经验)
  // 如果是 VIP，运气更好 (30 - 150 经验)
  let min = user.is_vip ? 30 : 1;
  let max = user.is_vip ? 150 : 100;
  const randomXP = Math.floor(Math.random() * (max - min + 1)) + min;

  // 4. 更新数据库
  await db.prepare('UPDATE users SET xp = xp + ?, last_draw = ? WHERE id = ?')
    .bind(randomXP, today, user.id)
    .run();

  return new Response(JSON.stringify({ 
    success: true, 
    message: `欧气爆发！获得 ${randomXP} 经验值！`, 
    xpAdded: randomXP 
  }));
}
