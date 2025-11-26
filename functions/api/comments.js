// --- functions/api/comments.js ---
export async function onRequestGet(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const postId = url.searchParams.get('post_id');

  if (!postId) return new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } });

  // 获取评论列表，连表查询评论者的信息
  const comments = await db.prepare(`
    SELECT comments.*, users.username, users.nickname, users.avatar_variant, users.is_vip, users.level
    FROM comments
    JOIN users ON comments.user_id = users.id
    WHERE comments.post_id = ?
    ORDER BY comments.created_at DESC
  `).bind(postId).all();

  return new Response(JSON.stringify(comments.results), { headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  
  // 1. 鉴权
  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: false, error: '请先登录' }), { status: 401 });
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare(`SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

  const { post_id, content } = await context.request.json();
  if (!content) return new Response(JSON.stringify({ success: false, error: '内容为空' }), { status: 400 });

  // 2. 插入评论
  await db.prepare('INSERT INTO comments (post_id, user_id, content, created_at) VALUES (?, ?, ?, ?)')
    .bind(post_id, user.id, content, Date.now())
    .run();

  // 3. 增加经验 (评论 +5 XP)
  await db.prepare('UPDATE users SET xp = xp + 5 WHERE id = ?').bind(user.id).run();

  // 4. 给文章作者发通知 (如果不是自己评自己)
  const post = await db.prepare('SELECT user_id, title FROM posts WHERE id = ?').bind(post_id).first();
  if (post && post.user_id !== user.id) {
    const msg = `${user.nickname || user.username} 评论了你的文章: ${post.title}`;
    await db.prepare('INSERT INTO notifications (user_id, type, message, link, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(post.user_id, 'comment', msg, `#post?id=${post_id}`, Date.now())
      .run();
  }

  return new Response(JSON.stringify({ success: true, message: '评论发布成功 +5 XP' }));
}
