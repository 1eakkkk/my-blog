// --- functions/api/checkin.js ---

async function addXpWithCap(db, userId, amount, today) {
  const user = await db.prepare('SELECT daily_xp, last_xp_date FROM users WHERE id = ?').bind(userId).first();
  let currentDailyXp = (user.last_xp_date === today) ? (user.daily_xp || 0) : 0;
  
  if (currentDailyXp >= 120) {
      // 即使经验满了，也要更新日期，防止逻辑死循环
      await db.prepare('UPDATE users SET last_xp_date = ? WHERE id = ?').bind(today, userId).run();
      return { added: 0, msg: '今日经验已满' };
  }
  
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
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const user = await db.prepare(`SELECT * FROM users WHERE id = (SELECT user_id FROM sessions WHERE session_id = ?)`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, message: '会话无效' }), { status: 401 });

  if (user.status === 'banned' && user.ban_expires_at > Date.now()) {
      return new Response(JSON.stringify({ success: false, message: '账号封禁中' }));
  }

  // 时间计算 (UTC+8)
  const now = new Date();
  const utc8 = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const today = utc8.toISOString().split('T')[0];
  
  const yesterdayDate = new Date(now.getTime() + (8 * 60 * 60 * 1000) - 86400000);
  const yesterday = yesterdayDate.toISOString().split('T')[0];

  if (user.last_check_in === today) {
    return new Response(JSON.stringify({ success: false, message: '今日已签到' }));
  }

  // 连续签到逻辑
  let newConsecutive = 1;
  if (user.last_check_in === yesterday) {
      newConsecutive = (user.consecutive_days || 0) + 1;
  }

  // 奖励计算
  let baseReward = 10 + (newConsecutive - 1) * 5; // 每天递增5
  if (baseReward > 50) baseReward = 50; // 封顶50

  let coinAdd = baseReward;
  let xpAdd = baseReward;

  const isVip = user.vip_expires_at > Date.now();
  if (isVip) {
      xpAdd = Math.floor(xpAdd * 1.45);
  }

  try {
      // 1. 更新用户核心数据 (金币、最后签到日、连续天数) - 之前缺这个导致报错或数据不更新
      await db.prepare('UPDATE users SET coins = coins + ?, last_check_in = ?, consecutive_days = ? WHERE id = ?')
        .bind(coinAdd, today, newConsecutive, user.id).run();

      // 2. 更新任务进度 (user_tasks)
      await db.prepare(`UPDATE user_tasks SET progress = progress + 1 WHERE user_id = ? AND task_code = 'checkin' AND category = 'daily' AND status = 0 AND period_key = ?`)
        .bind(user.id, today).run();
      
      // 3. 增加经验
      const xpResult = await addXpWithCap(db, user.id, xpAdd, today);

      return new Response(JSON.stringify({ 
        success: true, 
        message: `签到成功! 连签${newConsecutive}天 (i币+${coinAdd}, ${xpResult.msg})`, 
        coins: user.coins + coinAdd 
      }));
  } catch (e) {
      return new Response(JSON.stringify({ success: false, message: '签到系统故障: ' + e.message }), { status: 500 });
  }
}
