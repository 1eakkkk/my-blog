// --- functions/api/draw.js ---

async function addXpWithCap(db, userId, amount, today) {
  const user = await db.prepare('SELECT daily_xp, last_xp_date FROM users WHERE id = ?').bind(userId).first();
  let currentDailyXp = (user.last_xp_date === today) ? (user.daily_xp || 0) : 0;
  if (currentDailyXp >= 120) return { added: 0, msg: '今日经验已满' };
  let actualAdd = amount;
  if (currentDailyXp + amount > 120) actualAdd = 120 - currentDailyXp;
  await db.prepare('UPDATE users SET xp = xp + ?, daily_xp = ?, last_xp_date = ? WHERE id = ?')
    .bind(actualAdd, currentDailyXp + actualAdd, today, userId)
    .run();
  return { added: actualAdd, msg: `经验 +${actualAdd}` };
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie) return new Response(JSON.stringify({ success: false }), { status: 401 });
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const user = await db.prepare(`SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效' }));

  if (user.status === 'banned' && user.ban_expires_at > Date.now()) return new Response(JSON.stringify({ success: false, error: '账号封禁中' }));

  const now = new Date();
  const utc8 = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const today = utc8.toISOString().split('T')[0];

  if (user.last_draw === today) {
    return new Response(JSON.stringify({ success: false, error: '今日机会已用完' }));
  }

  let min = user.is_vip ? 30 : 1;
  let max = user.is_vip ? 150 : 100;
  const randomXP = Math.floor(Math.random() * (max - min + 1)) + min;

  // 加经验 (受限)
  const xpResult = await addXpWithCap(db, user.id, randomXP, today);

  // 更新抽奖日期
  await db.prepare('UPDATE users SET last_draw = ? WHERE id = ?').bind(today, user.id).run();

  return new Response(JSON.stringify({ 
      success: true, 
      message: `运气不错！${xpResult.msg} (原始:${randomXP})` 
  }));
}
