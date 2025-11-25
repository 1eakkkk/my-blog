// --- functions/api/checkin.js ---
export async function onRequestPost(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');

  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: false, message: '请先登录' }), { status: 401 });
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, message: '会话无效' }), { status: 401 });

  const today = new Date().toDateString();
  if (user.last_check_in === today) {
    return new Response(JSON.stringify({ success: false, message: '今日已签到' }));
  }

  // === 核心数值逻辑 ===
  // 普通: +10 i币, +20 XP
  // VIP : +20 i币, +40 XP
  const coinAdd = user.is_vip ? 20 : 10;
  const xpAdd = user.is_vip ? 40 : 20;

  await db.prepare('UPDATE users SET coins = coins + ?, xp = xp + ?, last_check_in = ? WHERE id = ?')
    .bind(coinAdd, xpAdd, today, user.id)
    .run();

  return new Response(JSON.stringify({ 
    success: true, 
    message: `签到成功! i币+${coinAdd}, 经验+${xpAdd}` + (user.is_vip ? " (VIP加成)" : ""), 
    coins: user.coins + coinAdd 
  }));
}
