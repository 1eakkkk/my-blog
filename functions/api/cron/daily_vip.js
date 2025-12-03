// --- START OF FILE functions/api/cron/daily_vip.js ---

// 这个接口用于每天触发一次，发放 VIP k币奖励
// 建议配置 Cloudflare Cron Trigger 或使用外部定时任务访问: https://你的域名/api/cron/daily_vip?key=你的密钥

export async function onRequest(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const key = url.searchParams.get('key');

  // 简单安全检查 (建议修改这个密钥)
  const SECRET_KEY = "admin_secret_key"; 
  if (key !== SECRET_KEY) {
    return new Response("Unauthorized", { status: 403 });
  }

  const now = Date.now();
  //以此格式记录日期，确保每天只发一次
  const todayStr = new Date().toISOString().split('T')[0]; 

  // 1. 获取所有 未过期的 VIP 用户，且 今天还没领过奖
  const vips = await db.prepare(`
    SELECT * FROM users 
    WHERE is_vip = 1 
    AND vip_expires_at > ? 
    AND (last_vip_reward_date IS NULL OR last_vip_reward_date != ?)
  `).bind(now, todayStr).all();

  if (!vips.results || vips.results.length === 0) {
    return new Response(JSON.stringify({ success: true, message: "今日无待发放用户" }), { headers: { 'Content-Type': 'application/json' } });
  }

  const batch = [];
  let successCount = 0;

  // 2. 遍历用户计算奖励
  for (const user of vips.results) {
    // 计算剩余天数
    const msLeft = user.vip_expires_at - now;
    const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));

    // 计算奖励 K币
    // 逻辑：基础 50 k + (剩余天数 * 10 k)
    // 举例：剩 30 天 = 350 k；剩 100 天 = 1050 k
    let rewardK = 50 + (daysLeft * 10);
    
    // 上限 1500
    if (rewardK > 1500) rewardK = 1500;

    // 3. 构建批量操作
    // A. 发钱 + 更新领取日期
    batch.push(
      db.prepare("UPDATE users SET k_coins = k_coins + ?, last_vip_reward_date = ? WHERE id = ?")
        .bind(rewardK, todayStr, user.id)
    );

    // B. 发送通知
    const notifyMsg = `VIP每日福利已到账：+${rewardK} k币 (剩余VIP: ${daysLeft}天)`;
    batch.push(
      db.prepare("INSERT INTO notifications (user_id, type, message, is_read, created_at) VALUES (?, 'system', ?, 0, ?)")
        .bind(user.id, notifyMsg, now)
    );

    successCount++;
  }

  // 4. 执行批量更新
  if (batch.length > 0) {
    // D1 的 batch 有大小限制，如果用户太多建议分片，这里假设微社区规模直接一次执行
    await db.batch(batch);
  }

  return new Response(JSON.stringify({ 
    success: true, 
    processed: successCount, 
    message: `成功为 ${successCount} 名 VIP 发放奖励` 
  }), { headers: { 'Content-Type': 'application/json' } });
}
