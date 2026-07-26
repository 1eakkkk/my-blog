import { json, getUser } from './_lib.js';

export async function onRequestPost(context) {
  const user = await getUser(context);
  if (user) {
    await context.env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?')
      .bind(Date.now(), user.id).run();
  }
  return json({ success: true });
}
