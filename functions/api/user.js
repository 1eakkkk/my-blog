// --- functions/api/user.js ---
export async function onRequestGet(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie) return new Response(JSON.stringify({ loggedIn: false }), { headers: { 'Content-Type': 'application/json' } });

  const match = cookie.match(/session_id=([^;]+)/);
  const sessionId = match ? match[1] : null;

  if (!sessionId) return new Response(JSON.stringify({ loggedIn: false }), { headers: { 'Content-Type': 'application/json' } });

  // 获取更多字段：nickname, xp, level, is_vip, username(用于生成头像)
  const result = await db.prepare(`
    SELECT users.username, users.nickname, users.coins, users.id, users.xp, users.level, users.is_vip
    FROM sessions 
    JOIN users ON sessions.user_id = users.id 
    WHERE sessions.session_id = ?
  `).bind(sessionId).first();

  if (!result) return new Response(JSON.stringify({ loggedIn: false }), { headers: { 'Content-Type': 'application/json' } });

  return new Response(JSON.stringify({ 
    loggedIn: true, 
    ...result // 展开所有字段返回前端
  }), { headers: { 'Content-Type': 'application/json' } });
}
