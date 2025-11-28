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

  // === 修复逻辑：区分扣款金额和经验获取 ===
  
  // 1. 基础经验 (1币 = 5经验)
  let senderXpBase = payAmount * 5;
  
  // 2. 如果是 VIP，经验获取翻倍 (扣款金额不变)
  if (sender.is_vip) {
      senderXpBase = senderXpBase * 2;
  }
  
  // 3. 接收者获得的经验 (保持不变，5币=1经验)
  const receiverXpAdd = Math.floor(payAmount / 5); 

  const now = new Date();
  const utc8 = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const today = utc8.toISOString().split('T')[0];

  const receiverData = await db.prepare('SELECT daily_xp, last_xp_date FROM users WHERE id = ?').bind(target_user_id).first();
  let receiverDailyXp = (receiverData.last_xp_date === today) ? (receiverData.daily_xp || 0) : 0;
  let actualReceiverAdd = 0;

  if (receiverDailyXp < 120) {
      actualReceiverAdd = receiverXpAdd;
      if (receiverDailyXp + receiverXpAdd > 120) actualReceiverAdd = 120 - receiverDailyXp;
  }

  try {
    await db.batch([
      // 打赏者：扣除原始金额(payAmount)，增加计算后的经验(senderXpBase)
      db.prepare('UPDATE users SET coins = coins - ?, xp = xp + ? WHERE id = ?').bind(payAmount, senderXpBase, sender.id),
      
      // 接收者：增加原始金额(payAmount)，增加受限经验
      db.prepare('UPDATE users SET coins = coins + ?, xp = xp + ?, daily_xp = daily_xp + ?, last_xp_date = ? WHERE id = ?')
        .bind(payAmount, actualReceiverAdd, actualReceiverAdd, today, target_user_id),
      
      // 发通知
      db.prepare('INSERT INTO notifications (user_id, type, message, link, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(target_user_id, 'tip', `${sender.nickname||sender.username} 打赏了你 ${payAmount} i币`, '#home', Date.now())
    ]);
    
    return new Response(JSON.stringify({ success: true, message: `打赏成功！消耗 ${payAmount} i币，获得 ${senderXpBase} 经验` }));
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: '交易失败: ' + e.message }), { status: 500 });
  }
}
