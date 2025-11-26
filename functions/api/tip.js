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

  // 1. 扣除打赏者金币，增加经验 (1币=5经验)
  const senderXpAdd = payAmount * 5;
  
  // 2. 增加接收者金币，增加经验 (5币=1经验)
  const receiverXpAdd = Math.floor(payAmount / 5); 

  try {
    await db.batch([
      // 扣款
      db.prepare('UPDATE users SET coins = coins - ?, xp = xp + ? WHERE id = ?').bind(payAmount, senderXpAdd, sender.id),
      // 入账
      db.prepare('UPDATE users SET coins = coins + ?, xp = xp + ? WHERE id = ?').bind(payAmount, receiverXpAdd, target_user_id),
      // 发通知
      db.prepare('INSERT INTO notifications (user_id, type, message, link, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(target_user_id, 'tip', `${sender.nickname||sender.username} 打赏了你 ${payAmount} i币`, '#home', Date.now())
    ]);
    return new Response(JSON.stringify({ success: true, message: `打赏成功！你获得了 ${senderXpAdd} 经验` }));
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: '交易失败' }), { status: 500 });
  }
}
