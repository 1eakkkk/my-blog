// --- functions/api/checkin.js ---

// 辅助函数：处理经验上限 (复用逻辑)
async function addXpWithCap(db, userId, amount, today) {
  const user = await db.prepare('SELECT daily_xp, last_xp_date FROM users WHERE id = ?').bind(userId).first();
  let currentDailyXp = (user.last_xp_date === today) ? (user.daily_xp || 0) : 0;

  if (currentDailyXp >= 120) return { added: 0, msg: '今日经验已满(120)' };

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
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: false, message: '请先登录' }), { status: 401 });
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare(`SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, message: '会话无效' }), { status: 401 });

  // 检查封禁
  if (user.status === 'banned') {
      if (user.ban_expires_at > Date.now()) {
          return new Response(JSON.stringify({ success: false, message: `账号封禁中` }));
      }
  }

  // === UTC+8 时间计算 ===
  const now = new Date();
  const utc8 = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const today = utc8.toISOString().split('T')[0];

  if (user.last_check_in === today) {
    return new Response(JSON.stringify({ success: false, message: '今日已签到' }));
  }

  const coinAdd = user.is_vip ? 20 : 10;
  const xpBase = user.is_vip ? 40 : 20;

  // 1. 加钱 (不受限)
  await db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(coinAdd, user.id).run();
  
  // 2. 加经验 (受限)
  const xpResult = await addXpWithCap(db, user.id, xpBase, today);

  // 3. 更新签到日期
  await db.prepare('UPDATE users SET last_check_in = ? WHERE id = ?').bind(today, user.id).run();

  // === 4. [新增] 任务钩子：更新任务进度 ===
  // 如果用户领了签到任务，且没完成，进度+1
  await db.prepare(`
    UPDATE daily_tasks 
    SET progress = progress + 1 
    WHERE user_id = ? AND task_type = 'checkin' AND is_claimed = 0 AND last_update_date = ?
  `).bind(user.id, today).run();

  return new Response(JSON.stringify({ 
    success: true, 
    message: `签到成功! i币+${coinAdd}, ${xpResult.msg}`, 
    coins: user.coins + coinAdd 
  }));
}
