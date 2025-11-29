// --- functions/api/shop.js ---
export async function onRequestPost(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ error: 'Login required' }), { status: 401 });
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const user = await db.prepare(`SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401 });

  const { action, itemId } = await context.request.json();

  // === 购买 VIP 逻辑 ===
  if (action === 'buy_vip') {
      let days = 0;
      let cost = 0;

      // 定义商品列表
      if (itemId === 'vip_7') { days = 7; cost = 70; }
      else if (itemId === 'vip_14') { days = 14; cost = 120; }
      else if (itemId === 'vip_30') { days = 30; cost = 210; }
      else {
          return new Response(JSON.stringify({ success: false, error: '商品不存在' }));
      }

      if (user.coins < cost) {
          return new Response(JSON.stringify({ success: false, error: '余额不足' }));
      }

      const now = Date.now();
      let newExpire = now;

      // 如果当前已经是 VIP 且没过期，从原过期时间续费
      if (user.vip_expires_at > now) {
          newExpire = user.vip_expires_at + (days * 86400 * 1000);
      } else {
          // 否则从现在开始算
          newExpire = now + (days * 86400 * 1000);
      }

      try {
          await db.batch([
              // 扣费并更新时间，同时将 is_vip 标记为 1 (作为数据库冗余标记)
              db.prepare('UPDATE users SET coins = coins - ?, vip_expires_at = ?, is_vip = 1 WHERE id = ?').bind(cost, newExpire, user.id),
              
              // 记录交易日志 (可选，如果不存日志表就忽略)
              // db.prepare('INSERT INTO transactions ...') 
          ]);
          
          return new Response(JSON.stringify({ success: true, message: `购买成功！VIP 有效期延长 ${days} 天` }));
      } catch (e) {
          return new Response(JSON.stringify({ success: false, error: '购买失败' }));
      }
  }

  // === 预留：后续购买头像框/装饰的接口 ===
  // if (action === 'buy_prop') { ... }

  return new Response(JSON.stringify({ success: false, error: '未知操作' }));
}
