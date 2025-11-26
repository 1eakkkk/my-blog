// --- functions/api/user.js ---
export async function onRequestGet(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie) return new Response(JSON.stringify({ loggedIn: false }));
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  if (!sessionId) return new Response(JSON.stringify({ loggedIn: false }));

  let user = await db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();

  if (!user) return new Response(JSON.stringify({ loggedIn: false }));

  if (user.status === 'banned' && user.ban_expires_at < Date.now()) {
      await db.prepare("UPDATE users SET status = 'active', ban_expires_at = 0 WHERE id = ?").bind(user.id).run();
      user.status = 'active';
  }

  // === 新增：更新最后活跃时间 (Debounce: 每5分钟更新一次即可，避免数据库压力) ===
  if (!user.last_seen || (Date.now() - user.last_seen > 300000)) {
      await db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(Date.now(), user.id).run();
  }

  delete user.password;
  return new Response(JSON.stringify({ loggedIn: true, ...user }), { headers: { 'Content-Type': 'application/json' } });
}
