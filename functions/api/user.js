export async function onRequestGet(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');

  if (!cookie) return new Response(JSON.stringify({ loggedIn: false }), { headers: { 'Content-Type': 'application/json' } });

  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  if (!sessionId) return new Response(JSON.stringify({ loggedIn: false }), { headers: { 'Content-Type': 'application/json' } });

  let user = await db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ loggedIn: false }), { headers: { 'Content-Type': 'application/json' } });

  const now = Date.now();

  if (user.status === 'banned' && user.ban_expires_at < now) {
    await db.prepare("UPDATE users SET status = 'active', ban_expires_at = 0, ban_reason = NULL WHERE id = ?").bind(user.id).run();
    user.status = 'active';
  }

  if (!user.last_seen || (now - user.last_seen > 60000)) {
    try { await db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(now, user.id).run(); } catch (e) { }
  }

  delete user.password;

  return new Response(JSON.stringify({
    loggedIn: true,
    ...user
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
    }
  });
}
