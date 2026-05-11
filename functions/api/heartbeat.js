export async function onRequestPost(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });

  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  if (!sessionId) return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });

  const session = await db.prepare('SELECT user_id FROM sessions WHERE session_id = ?').bind(sessionId).first();
  if (session) {
    await db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(Date.now(), session.user_id).run();
  }

  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
}
