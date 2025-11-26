// 只展示修改后的 Get，请合并到你的文件中
export async function onRequestGet(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');

  if (id) {
    const post = await db.prepare(`
      SELECT posts.*, users.username as author_username, users.nickname as author_nickname, users.is_vip as author_vip, users.level as author_level, users.avatar_variant as author_avatar_variant
      FROM posts 
      JOIN users ON posts.user_id = users.id 
      WHERE posts.id = ?
    `).bind(id).first();
    return new Response(JSON.stringify(post), { headers: { 'Content-Type': 'application/json' } });
  } else {
    const posts = await db.prepare(`
      SELECT posts.*, users.nickname as author_nickname, users.username as author_username, users.is_vip as author_vip, users.level as author_level, users.avatar_variant as author_avatar_variant
      FROM posts 
      JOIN users ON posts.user_id = users.id 
      ORDER BY posts.created_at DESC
    `).all();
    return new Response(JSON.stringify(posts.results), { headers: { 'Content-Type': 'application/json' } });
  }
}
// ... Post 和 Delete 函数保持不变 ...
export async function onRequestPost(context) {
  const db = context.env.DB;
  
  // 1. 鉴权
  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) {
    return new Response(JSON.stringify({ success: false, error: '请先登录' }), { status: 401 });
  }
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

  const { title, content } = await context.request.json();
  if (!title || !content) return new Response(JSON.stringify({ success: false, error: '内容不能为空' }), { status: 400 });

  // 2. 插入文章
  await db.prepare('INSERT INTO posts (user_id, author_name, title, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(user.id, user.nickname || user.username, title, content, Date.now())
    .run();

  // 3. 发帖奖励 (VIP翻倍)
  const xpAdd = user.is_vip ? 100 : 50;
  await db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').bind(xpAdd, user.id).run();

  return new Response(JSON.stringify({ success: true, message: `发布成功！经验+${xpAdd}` }), { headers: { 'Content-Type': 'application/json' } });
}

// delete
export async function onRequestDelete(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie) return new Response(JSON.stringify({ success: false }), { status: 401 });
  
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  // 获取用户时，同时获取 role
  const user = await db.prepare(`SELECT users.id, users.role FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');

  // === 核心修改：如果是管理员，不需要匹配 user_id ===
  let result;
  if (user.role === 'admin') {
      result = await db.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
  } else {
      result = await db.prepare('DELETE FROM posts WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  }

  if (result.meta.changes > 0) {
    return new Response(JSON.stringify({ success: true, message: '删除成功' }));
  } else {
    return new Response(JSON.stringify({ success: false, error: '无法删除：无权操作或文章不存在' }), { status: 403 });
  }
}
