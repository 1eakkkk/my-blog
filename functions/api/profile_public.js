export async function onRequestGet(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const targetId = url.searchParams.get('id');
  const targetUsername = url.searchParams.get('username');

  if (!targetId && !targetUsername) {
    return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404 });
  }

  let user;
  if (targetId) {
    user = await db.prepare(`
      SELECT id, username, nickname, avatar_variant, avatar_url, bio, role, xp, created_at
      FROM users WHERE id = ?
    `).bind(parseInt(targetId)).first();
  }
  if (!user && targetId) {
    user = await db.prepare(`
      SELECT id, username, nickname, avatar_variant, avatar_url, bio, role, xp, created_at
      FROM users WHERE username = ? OR nickname = ?
    `).bind(targetId, targetId).first();
  }
  if (!user && targetUsername) {
    user = await db.prepare(`
      SELECT id, username, nickname, avatar_variant, avatar_url, bio, role, xp, created_at
      FROM users WHERE username = ? OR nickname = ?
    `).bind(targetUsername, targetUsername).first();
  }
  if (!user) return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404 });

  const postCount = await db.prepare('SELECT COUNT(*) as c FROM posts WHERE user_id = ?').bind(user.id).first();

  return new Response(JSON.stringify({
    ...user,
    post_count: postCount.c
  }));
}
