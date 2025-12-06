// --- START OF FILE functions/api/user.js ---

export async function onRequestGet(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  
  if (!cookie) return new Response(JSON.stringify({ loggedIn: false }), { headers: { 'Content-Type': 'application/json' } });
  
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  if (!sessionId) return new Response(JSON.stringify({ loggedIn: false }), { headers: { 'Content-Type': 'application/json' } });

  // 1. 查询用户 (保留您的 users.* 写法，这样兼容性最好)
  let user = await db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();

  if (!user) return new Response(JSON.stringify({ loggedIn: false }), { headers: { 'Content-Type': 'application/json' } });

  // === 核心逻辑：VIP 状态校验 (保留您的原逻辑) ===
  const now = Date.now();
  let isVip = false;
  
  if (user.vip_expires_at > now) {
      isVip = true;
  } else if (user.is_vip === 1 && user.vip_expires_at === 0) {
      isVip = false; 
  }

  // 封禁自动解封逻辑
  if (user.status === 'banned' && user.ban_expires_at < now) {
      await db.prepare("UPDATE users SET status = 'active', ban_expires_at = 0, ban_reason = NULL WHERE id = ?").bind(user.id).run();
      user.status = 'active';
  }

  // 更新最后活跃
  if (!user.last_seen || (now - user.last_seen > 300000)) {
      // 这里的 try-catch 是为了防止数据库繁忙时阻塞主流程
      try {
          await db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(now, user.id).run();
      } catch(e) {}
  }

  // === 🚨 核心修复：确保新字段不为 NULL ===
  // 如果数据库里这列是 NULL（老用户常态），前端 JSON.parse(null) 会报错或变成 0
  // 这里强制给它兜底成字符串 '{}'
  if (!user.forge_levels) user.forge_levels = '{}';
  if (!user.tech_levels) user.tech_levels = '{}';

  // 删除敏感信息
  delete user.password;
  
  // 返回数据
  return new Response(JSON.stringify({ 
      loggedIn: true, 
      ...user, 
      is_vip: isVip 
  }), { 
      headers: { 
          'Content-Type': 'application/json',
          // 禁止缓存，确保每次升级后刷新页面能拿到最新数据
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
      } 
  });
}
