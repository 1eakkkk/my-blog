// --- functions/api/user.js ---
export async function onRequestGet(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie) return new Response(JSON.stringify({ loggedIn: false }));
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  if (!sessionId) return new Response(JSON.stringify({ loggedIn: false }));

  let user = await db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();

  if (!user) return new Response(JSON.stringify({ loggedIn: false }));

  // === 核心逻辑：VIP 状态校验 ===
  const now = Date.now();
  let isVip = false;
  
  if (user.vip_expires_at > now) {
      isVip = true;
  } else if (user.is_vip === 1 && user.vip_expires_at === 0) {
      // 兼容旧数据：如果是旧的永久VIP且没设置过过期时间，暂时算作VIP，或者在这里强制让它过期
      // 为了系统转型，建议视作过期，或者在数据库迁移时已处理
      isVip = false; 
  }

  // 封禁自动解封逻辑
  if (user.status === 'banned' && user.ban_expires_at < now) {
      await db.prepare("UPDATE users SET status = 'active', ban_expires_at = 0, ban_reason = NULL WHERE id = ?").bind(user.id).run();
      user.status = 'active';
  }

  // 更新最后活跃
  if (!user.last_seen || (now - user.last_seen > 300000)) {
      await db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(now, user.id).run();
  }

  delete user.password;
  
  // 返回给前端的数据，覆盖数据库里的 is_vip 字段，以时间判断为准
  return new Response(JSON.stringify({ 
      loggedIn: true, 
      ...user, 
      is_vip: isVip // 覆盖为动态计算结果
  }), { headers: { 'Content-Type': 'application/json' } });
}
