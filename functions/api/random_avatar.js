import { json, getUser } from './_lib.js';

export async function onRequestPost(context) {
  const user = await getUser(context);
  if (!user) return json({ success: false, error: '请先登录' }, { status: 401 });

  const newVariant = Math.floor(Math.random() * 999999);
  await context.env.DB.prepare('UPDATE users SET avatar_variant = ? WHERE id = ?')
    .bind(newVariant, user.id).run();

  return json({ success: true, message: '头像基因已重组', variant: newVariant });
}
