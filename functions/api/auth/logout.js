export async function onRequestPost(context) {
  const cookie = context.request.headers.get('Cookie');
  const db = context.env.DB;

  if (cookie && cookie.includes('session_id')) {
    const sessionId = cookie.split('session_id=')[1].split(';')[0];
    await db.prepare('DELETE FROM sessions WHERE session_id = ?').bind(sessionId).run();
  }

  const headers = new Headers();
  headers.append('Set-Cookie', `session_id=; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=0`);
  return new Response("Logged out", { headers });
}