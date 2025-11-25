export async function onRequestGet(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie) return new Response(JSON.stringify({ loggedIn: false }), { headers: { 'Content-Type': 'application/json' } });

  const match = cookie.match(/session_id=([^;]+)/);
  const sessionId = match ? match[1] : null;

  if (!sessionId) return new Response(JSON.stringify({ loggedIn: false }), { headers: { 'Content-Type': 'application/json' } });

  // 增加 avatar_variant 字段
  const result = await db.prepare(`
    SELECT users.username, users.nickname, users.coins, users.id, users.xp, users.level, users.is_vip, users.avatar_variant
    FROM sessions 
    JOIN users ON sessions.user_id = users.id 
    WHERE sessions.session_id = ?
  `).bind(sessionId).first();

  if (!result) return new Response(JSON.stringify({ loggedIn: false }), { headers: { 'Content-Type': 'application/json' } });

  return new Response(JSON.stringify({ loggedIn: true, ...result }), { headers: { 'Content-Type': 'application/json' } });
}
