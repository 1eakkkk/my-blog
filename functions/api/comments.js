// 只覆盖 onRequestGet，其他部分保持不变
export async function onRequestGet(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const postId = url.searchParams.get('post_id');

  if (!postId) return new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } });

  const comments = await db.prepare(`
    SELECT comments.*, users.username, users.nickname, users.avatar_variant, users.is_vip, users.level, users.xp,
           users.role, users.custom_title, users.custom_title_color
    FROM comments
    JOIN users ON comments.user_id = users.id
    WHERE comments.post_id = ?
    ORDER BY comments.created_at DESC
  `).bind(postId).all();

  return new Response(JSON.stringify(comments.results), { headers: { 'Content-Type': 'application/json' } });
}
// ... (保留原来的 onRequestPost 和 onRequestDelete) ...

export async function onRequestPost(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: false, error: '请先登录' }), { status: 401 });
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare(`SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

  const { post_id, content } = await context.request.json();
  if (!content) return new Response(JSON.stringify({ success: false, error: '内容为空' }), { status: 400 });

  await db.prepare('INSERT INTO comments (post_id, user_id, content, created_at) VALUES (?, ?, ?, ?)')
    .bind(post_id, user.id, content, Date.now())
    .run();

  // 评论增加 5 经验
  // 追加经验限制 
  const now = new Date();
  const utc8 = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const today = utc8.toISOString().split('T')[0];
  
  // 手动内联 addXpWithCap 逻辑
  const userData = await db.prepare('SELECT daily_xp, last_xp_date FROM users WHERE id = ?').bind(user.id).first();
  let currentDailyXp = (userData.last_xp_date === today) ? (userData.daily_xp || 0) : 0;
  
  let xpMsg = "";
  if (currentDailyXp < 120) {
      let add = 5;
      if (currentDailyXp + 5 > 120) add = 120 - currentDailyXp;
      await db.prepare('UPDATE users SET xp = xp + ?, daily_xp = ?, last_xp_date = ? WHERE id = ?')
        .bind(add, currentDailyXp + add, today, user.id)
        .run();
      xpMsg = ` +${add} XP`;
  } else {
      xpMsg = " (今日经验已满)";
  }

  // 发送通知逻辑 (保持不变)
  const post = await db.prepare('SELECT user_id, title FROM posts WHERE id = ?').bind(post_id).first();
  if (post && post.user_id !== user.id) {
    const msg = `${user.nickname || user.username} 评论了你的文章: ${post.title}`;
    await db.prepare('INSERT INTO notifications (user_id, type, message, link, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(post.user_id, 'comment', msg, `#post?id=${post_id}`, Date.now())
      .run();
  }

  return new Response(JSON.stringify({ success: true, message: `评论发布成功${xpMsg}` }));
}
// --- 追加删除评论功能 ---

export async function onRequestDelete(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie) return new Response(JSON.stringify({ success: false }), { status: 401 });
  
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const user = await db.prepare(`SELECT users.id, users.role FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

  const url = new URL(context.request.url);
  const commentId = url.searchParams.get('id');

  // 管理员可删所有，普通用户只能删自己
  let result;
  if (user.role === 'admin') {
      result = await db.prepare('DELETE FROM comments WHERE id = ?').bind(commentId).run();
  } else {
      result = await db.prepare('DELETE FROM comments WHERE id = ? AND user_id = ?').bind(commentId, user.id).run();
  }

  if (result.meta.changes > 0) {
    return new Response(JSON.stringify({ success: true, message: '评论已删除' }));
  } else {
    return new Response(JSON.stringify({ success: false, error: '删除失败' }), { status: 403 });
  }
}
