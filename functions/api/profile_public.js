export async function onRequestGet(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const targetUsername = url.searchParams.get('username');

  if (!targetUsername) return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404 });

  const user = await db.prepare(`
    SELECT id, username, nickname, avatar_variant, avatar_url, bio, role, xp, created_at
    FROM users
    WHERE username = ? OR nickname = ?
  `).bind(targetUsername, targetUsername).first();

  if (!user) return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404 });

  const postCount = await db.prepare('SELECT COUNT(*) as c FROM posts WHERE user_id = ?').bind(user.id).first();

  return new Response(JSON.stringify({
    ...user,
    post_count: postCount.c,
    followers_count: 0,
    following_count: 0
  }));
}
