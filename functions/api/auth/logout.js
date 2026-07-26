import { json, getSessionId } from '../_lib.js';

export async function onRequestPost(context) {
  const sessionId = getSessionId(context.request);
  if (sessionId) {
    await context.env.DB.prepare('DELETE FROM sessions WHERE session_id = ?').bind(sessionId).run();
  }

  return json({ success: true }, {
    headers: { 'Set-Cookie': 'session_id=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0' }
  });
}
