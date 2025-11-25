// --- functions/api/vip.js ---
export async function onRequestPost(context) {
  const db = context.env.DB;
  
  // 鉴权
  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: false, error: '请先登录' }), { status: 401 });
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

  if (user.is_vip) {
    return new Response(JSON.stringify({ success: false, error: '您已经是尊贵的 VIP 用户了' }), { status: 400 });
  }

  if (user.coins < 50) {
    return new Response(JSON.stringify({ success: false, error: '余额不足，需要 50 i币' }), { status: 400 });
  }

  // 扣费并升级
  await db.batch([
    db.prepare('UPDATE users SET coins = coins - 50, is_vip = 1 WHERE id = ?').bind(user.id),
    // 购买VIP直接赠送 100 经验
    db.prepare('UPDATE users SET xp = xp + 100 WHERE id = ?').bind(user.id)
  ]);

  return new Response(JSON.stringify({ success: true, message: 'VIP 开通成功！经验值 +100', is_vip: true, coins: user.coins - 50 }), { headers: { 'Content-Type': 'application/json' } });
}
