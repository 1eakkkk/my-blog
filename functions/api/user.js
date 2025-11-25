export async function onRequestGet(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');

  if (!cookie || !cookie.includes('session_id')) {
    return new Response(JSON.stringify({ loggedIn: false }), { headers: { 'Content-Type': 'application/json' } });
  }

  const sessionId = cookie.split('session_id=')[1].split(';')[0];

  // 通过 Session 查用户
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