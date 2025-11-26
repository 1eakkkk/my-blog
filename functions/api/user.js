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

  // 检查封禁状态
  if (user.status === 'banned' && user.ban_expires_at < Date.now()) {
      await db.prepare("UPDATE users SET status = 'active', ban_expires_at = 0 WHERE id = ?").bind(user.id).run();
      user.status = 'active';
  }

  delete user.password;
  // 确保 recovery_key 只有在特定接口才返回，或者前端不显示，这里保留原样
  
  return new Response(JSON.stringify({ loggedIn: true, ...user }), { headers: { 'Content-Type': 'application/json' } });
}
