// --- functions/api/checkin.js ---
export async function onRequestPost(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: false, message: '请先登录' }), { status: 401 });
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare(`SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, message: '会话无效' }), { status: 401 });

  // 检查封禁
  if (user.status === 'banned') {
      if (user.ban_expires_at > Date.now()) {
          const date = new Date(user.ban_expires_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
          return new Response(JSON.stringify({ success: false, message: `账号封禁中，解封时间: ${date}` }));
      }
  }

  // === 获取 UTC+8 的日期字符串 (YYYY-MM-DD) ===
  // Cloudflare 服务器默认是 UTC，我们需要手动偏移 +8 小时
  const now = new Date();
  const utc8 = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const today = utc8.toISOString().split('T')[0]; // 得到 2023-10-27 格式

  if (user.last_check_in === today) {
    return new Response(JSON.stringify({ success: false, message: '今日已签到' }));
  }

  const coinAdd = user.is_vip ? 20 : 10;
  const xpAdd = user.is_vip ? 40 : 20;

  await db.prepare('UPDATE users SET coins = coins + ?, xp = xp + ?, last_check_in = ? WHERE id = ?')
    .bind(coinAdd, xpAdd, today, user.id)
    .run();

  return new Response(JSON.stringify({ 
    success: true, 
    message: `签到成功! i币+${coinAdd}, 经验+${xpAdd}`, 
    coins: user.coins + coinAdd 
  }));
}
