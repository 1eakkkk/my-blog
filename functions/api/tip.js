// --- functions/api/tip.js ---
export async function onRequestPost(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: false, error: '请先登录' }), { status: 401 });
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const sender = await db.prepare(`SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  
  if (!sender) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });
  if (sender.status === 'banned') return new Response(JSON.stringify({ success: false, error: '账号已封禁' }), { status: 403 });

  // === 1. 获取 post_id ===
  const { target_user_id, amount, post_id } = await context.request.json();
  const payAmount = parseInt(amount);

  if (isNaN(payAmount) || payAmount <= 0) return new Response(JSON.stringify({ success: false, error: '金额无效' }), { status: 400 });
  if (sender.id === target_user_id) return new Response(JSON.stringify({ success: false, error: '不能给自己打赏' }), { status: 400 });
  if (sender.coins < payAmount) return new Response(JSON.stringify({ success: false, error: '余额不足' }));

  // 2. 计算抽成和经验
  let tax = Math.floor(payAmount * 0.10); 
  if (tax < 1) tax = 1; 
  const actualReceived = payAmount - tax; 

  const now = Date.now();
  const isVip = sender.vip_expires_at > now;
  
  let senderXpBase = payAmount * 5; 
  if (isVip) senderXpBase = Math.floor(senderXpBase * 1.45);

  const receiverXpAdd = Math.floor(payAmount / 5); 
  const utc8 = new Date(now + (8 * 60 * 60 * 1000));
  const today = utc8.toISOString().split('T')[0];

  const receiverData = await db.prepare('SELECT daily_xp, last_xp_date FROM users WHERE id = ?').bind(target_user_id).first();
  let receiverDailyXp = (receiverData.last_xp_date === today) ? (receiverData.daily_xp || 0) : 0;
  let actualReceiverXp = 0;
  if (receiverDailyXp < 120) {
      actualReceiverXp = receiverXpAdd;
      if (receiverDailyXp + receiverXpAdd > 120) actualReceiverXp = 120 - receiverDailyXp;
  }

  try {
    // === 3. 构建事务语句数组 ===
    const batchStmts = [
      // 打赏者扣款
      db.prepare('UPDATE users SET coins = coins - ?, xp = xp + ?, tips_sent = tips_sent + ? WHERE id = ?')
        .bind(payAmount, senderXpBase, payAmount, sender.id),
      
      // 接收者入账
      db.prepare('UPDATE users SET coins = coins + ?, xp = xp + ?, daily_xp = daily_xp + ?, last_xp_date = ?, tips_received = tips_received + ? WHERE id = ?')
        .bind(actualReceived, actualReceiverXp, actualReceiverXp, today, actualReceived, target_user_id),
      
      // 通知
      db.prepare('INSERT INTO notifications (user_id, type, message, link, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(target_user_id, 'tip', `${sender.nickname||sender.username} 打赏了你 ${payAmount} i币 (税后 ${actualReceived})`, '#home', now),

      // 任务更新
      db.prepare(`UPDATE user_tasks SET progress = progress + 1 WHERE user_id = ? AND task_code LIKE 'tip_%' AND task_code NOT LIKE 'tip_total_%' AND status = 0`).bind(sender.id),
      db.prepare(`UPDATE user_tasks SET progress = progress + ? WHERE user_id = ? AND task_code LIKE 'tip_total_%' AND status = 0`).bind(payAmount, sender.id)
    ];

    // === 4. 如果有 post_id，额外增加更新帖子打赏额的语句 ===
    if (post_id) {
        // 累加帖子打赏总额 (计入 payAmount 即打赏原价，显示起来更好看)
        batchStmts.push(
            db.prepare('UPDATE posts SET total_coins = total_coins + ? WHERE id = ?').bind(payAmount, post_id)
        );
    }

    // 执行事务
    await db.batch(batchStmts);
    
    return new Response(JSON.stringify({ success: true, message: `打赏成功！消耗 ${payAmount}，对方收到 ${actualReceived}` }));
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: '交易失败' }), { status: 500 });
  }
}
