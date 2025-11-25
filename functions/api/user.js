// --- functions/api/user.js ---

export async function onRequestGet(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');

  // 1. 如果完全没有 Cookie，直接返回未登录
  if (!cookie) {
    return new Response(JSON.stringify({ loggedIn: false }), { headers: { 'Content-Type': 'application/json' } });
  }

  // 2. 使用正则提取 session_id (关键修复：比 split 更稳定)
  const match = cookie.match(/session_id=([^;]+)/);
  const sessionId = match ? match[1] : null;

  if (!sessionId) {
    return new Response(JSON.stringify({ loggedIn: false }), { headers: { 'Content-Type': 'application/json' } });
  }

  // 3. 通过 Session 查用户
  const result = await db.prepare(`
    SELECT users.username, users.coins, users.id 
    FROM sessions 
    JOIN users ON sessions.user_id = users.id 
    WHERE sessions.session_id = ?
  `).bind(sessionId).first();

  if (!result) {
    return new Response(JSON.stringify({ loggedIn: false }), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ loggedIn: true, username: result.username, coins: result.coins }), { headers: { 'Content-Type': 'application/json' } });
}
