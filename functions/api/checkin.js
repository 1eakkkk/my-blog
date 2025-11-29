// --- functions/api/checkin.js ---

async function addXpWithCap(db, userId, amount, today) {
  const user = await db.prepare('SELECT daily_xp, last_xp_date FROM users WHERE id = ?').bind(userId).first();
  let currentDailyXp = (user.last_xp_date === today) ? (user.daily_xp || 0) : 0;
  if (currentDailyXp >= 120) return { added: 0, msg: '今日经验已满(120)' };
  let actualAdd = amount;
  if (currentDailyXp + amount > 120) actualAdd = 120 - currentDailyXp;
  await db.prepare('UPDATE users SET xp = xp + ?, daily_xp = ?, last_xp_date = ? WHERE id = ?')
    .bind(actualAdd, currentDailyXp + actualAdd, today, userId).run();
  return { added: actualAdd, msg: `经验 +${actualAdd}` };
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: false, message: '请先登录' }), { status: 401 });
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare(`SELECT * FROM users WHERE id = (SELECT user_id FROM sessions WHERE session_id = ?)`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, message: '会话无效' }), { status: 401 });

  if (user.status === 'banned') {
      if (user.ban_expires_at > Date.now()) return new Response(JSON.stringify({ success: false, message: `账号封禁中` }));
  }

  const now = new Date();
  // UTC+8
  const utc8 = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const today = utc8.toISOString().split('T')[0];
  
  // 计算昨天日期
  const yesterdayDate = new Date(now.getTime() + (8 * 60 * 60 * 1000) - 86400000);
  const yesterday = yesterdayDate.toISOString().split('T')[0];

  if (user.last_check_in === today) {
    return new Response(JSON.stringify({ success: false, message: '今日已签到' }));
  }

  // === 核心：连续签到逻辑 ===
  let newConsecutive = 1;
  if (user.last_check_in === yesterday) {
      newConsecutive = (user.consecutive_days || 0) + 1;
  } else {
      newConsecutive = 1; // 断签重置
  }

  // 计算奖励：基础10，每天增加10，封顶50
  let baseReward = 10 + (newConsecutive - 1) * 10;
  if (baseReward > 50) baseReward = 50;

  let coinAdd = baseReward;
  let xpAdd = baseReward;

  // === VIP 加成 (1.45倍) ===
  const isVip = user.vip_expires_at > Date.now();
  if (isVip) {
      xpAdd = Math.floor(xpAdd * 1.45);
      // 金币通常不加成，或者根据你需求。按题目要求只说经验加成。
  }

  // 执行更新
  await db.prepare(`UPDATE user_tasks SET progress = progress + 1 WHERE user_id = ? AND task_code = 'checkin' AND category = 'daily' AND status = 0 AND period_key = ?`)
    .bind(user.id, today).run();
  
  const xpResult = await addXpWithCap(db, user.id, xpAdd, today);

  // 任务钩子
  await db.prepare(`UPDATE daily_tasks SET progress = progress + 1 WHERE user_id = ? AND task_type = 'checkin' AND is_claimed = 0 AND last_update_date = ?`).bind(user.id, today).run();

  return new Response(JSON.stringify({ 
    success: true, 
    message: `签到成功! 第${newConsecutive}天连签 (i币+${coinAdd}, ${xpResult.msg})`, 
    coins: user.coins + coinAdd 
  }));
}


