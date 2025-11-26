// --- functions/api/user.js ---
export async function onRequestGet(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie) return new Response(JSON.stringify({ loggedIn: false }), { headers: { 'Content-Type': 'application/json' } });

  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  if (!sessionId) return new Response(JSON.stringify({ loggedIn: false }), { headers: { 'Content-Type': 'application/json' } });

  let user = await db.prepare(`
    SELECT users.* 
    FROM sessions 
    JOIN users ON sessions.user_id = users.id 
    WHERE sessions.session_id = ?
  `).bind(sessionId).first();

  if (!user) return new Response(JSON.stringify({ loggedIn: false }), { headers: { 'Content-Type': 'application/json' } });

  // === 核心：检查封禁是否过期 ===
  if (user.status === 'banned' && user.ban_expires_at < Date.now()) {
      // 封禁过期，自动解封
      await db.prepare("UPDATE users SET status = 'active', ban_expires_at = 0 WHERE id = ?").bind(user.id).run();
      user.status = 'active'; // 更新内存中的状态
  }

  // 为了安全，过滤掉 password 字段后再返回
  delete user.password;

  return new Response(JSON.stringify({ loggedIn: true, ...user }), { headers: { 'Content-Type': 'application/json' } });
}
