// --- functions/api/tip.js ---
export async function onRequestPost(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: false, error: '请先登录' }), { status: 401 });
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const sender = await db.prepare(`SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  
  if (!sender) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });
  if (sender.status === 'banned') return new Response(JSON.stringify({ success: false, error: '账号已封禁' }), { status: 403 });

  const { target_user_id, amount } = await context.request.json();
  const payAmount = parseInt(amount);

  if (isNaN(payAmount) || payAmount <= 0) return new Response(JSON.stringify({ success: false, error: '金额无效' }), { status: 400 });
  if (sender.id === target_user_id) return new Response(JSON.stringify({ success: false, error: '不能给自己打赏' }), { status: 400 });
  if (sender.coins < payAmount) return new Response(JSON.stringify({ success: false, error: '余额不足' }), { status: 400 });


  // === 1.计算系统抽成 ===
  let tax = Math.floor(payAmount * 0.10); // 10%
  if (tax < 1) tax = 1; // 不足 1 币按 1 币算
  const actualReceived = payAmount - tax; // 接收者实际到手
  // === 2. 计算发送者经验 (VIP 1.45x) ===
  const now = Date.now();
  const isVip = sender.vip_expires_at > now; // 严格校验时间
  
  let senderXpBase = payAmount * 5; // 基础经验：1币=5XP
  if (isVip) {
      // 1.45 倍加成 (向下取整)
      senderXpBase = Math.floor(senderXpBase * 1.45);
  }
  
  // === 3. 计算接收者经验 (5币=1XP，受每日上限限制) ===
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
    // === 核心修复：在一个 batch 里同时做所有事 ===
    await db.batch([
      // 打赏者：扣全款，加加成后的经验
      db.prepare('UPDATE users SET coins = coins - ?, xp = xp + ?, tips_sent = tips_sent + ? WHERE id = ?')
        .bind(payAmount, senderXpBase, payAmount, sender.id),
      
      // 接收者：加(全款-税)，加受限经验
      db.prepare('UPDATE users SET coins = coins + ?, xp = xp + ?, daily_xp = daily_xp + ?, last_xp_date = ?, tips_received = tips_received + ? WHERE id = ?')
        .bind(actualReceived, actualReceiverXp, actualReceiverXp, today, actualReceived, target_user_id),
      
      // 发通知 (明确告知扣税)
      db.prepare('INSERT INTO notifications (user_id, type, message, link, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(target_user_id, 'tip', `${sender.nickname||sender.username} 打赏了你 ${payAmount} i币 (税后 ${actualReceived})`, '#home', now),

      // 4. 更新打赏者的任务 (次数任务 tip_1)
      db.prepare(`UPDATE user_tasks SET progress = progress + 1 WHERE user_id = ? AND task_code LIKE 'tip_%' AND task_code NOT LIKE 'tip_total_%' AND status = 0`).bind(sender.id),
      
      // 5. 更新打赏者的任务 (金额任务 tip_total_50)
      db.prepare(`UPDATE user_tasks SET progress = progress + ? WHERE user_id = ? AND task_code LIKE 'tip_total_%' AND status = 0`).bind(payAmount, sender.id)
    ]);
    
    return new Response(JSON.stringify({ success: true, message: `打赏成功！消耗 ${payAmount}，对方收到 ${actualReceived} (系统抽成 ${tax})，你获得 ${senderXpBase} XP` }));
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: '交易失败: ' + e.message }), { status: 500 });
  }
}
