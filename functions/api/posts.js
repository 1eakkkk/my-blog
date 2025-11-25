// --- functions/api/posts.js ---
export async function onRequestGet(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');

  if (id) {
    // 单篇查询：增加 users.avatar_variant
    const post = await db.prepare(`
      SELECT posts.*, users.username as author_username, users.nickname as author_nickname, users.is_vip as author_vip, users.level as author_level, users.avatar_variant as author_avatar_variant
      FROM posts 
      JOIN users ON posts.user_id = users.id 
      WHERE posts.id = ?
    `).bind(id).first();
    return new Response(JSON.stringify(post), { headers: { 'Content-Type': 'application/json' } });
  } else {
    // 列表查询：增加 users.avatar_variant
    const posts = await db.prepare(`
      SELECT posts.*, users.nickname as author_nickname, users.username as author_username, users.is_vip as author_vip, users.level as author_level, users.avatar_variant as author_avatar_variant
      FROM posts 
      JOIN users ON posts.user_id = users.id 
      ORDER BY posts.created_at DESC
    `).all();
    return new Response(JSON.stringify(posts.results), { headers: { 'Content-Type': 'application/json' } });
  }

export async function onRequestPost(context) {
  const db = context.env.DB;
  
  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: false, error: '请先登录' }), { status: 401 });
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

  const { title, content } = await context.request.json();
  if (!title || !content) return new Response(JSON.stringify({ success: false, error: '内容不能为空' }), { status: 400 });

  // 插入文章
  await db.prepare('INSERT INTO posts (user_id, author_name, title, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(user.id, user.nickname || user.username, title, content, Date.now()) // 注意这里存的是当时的昵称，或者你可以改存ID，展示时读最新昵称
    .run();

  // === 发帖奖励 ===
  // 普通: +50 XP
  // VIP : +100 XP
  const xpAdd = user.is_vip ? 100 : 50;
  await db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').bind(xpAdd, user.id).run();

  return new Response(JSON.stringify({ success: true, message: `发布成功！经验+${xpAdd}` }), { headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestDelete(context) {
  // ... (保持之前的删除逻辑不变)
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: false, error: '请先登录' }), { status: 401 });
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');
  if (!id) return new Response(JSON.stringify({ success: false, error: '缺少参数' }), { status: 400 });

  const result = await db.prepare('DELETE FROM posts WHERE id = ? AND user_id = ?').bind(id, user.id).run();

  if (result.meta.changes > 0) {
    return new Response(JSON.stringify({ success: true, message: '删除成功' }), { headers: { 'Content-Type': 'application/json' } });
  } else {
    return new Response(JSON.stringify({ success: false, error: '删除失败' }), { status: 403 });
  }
}
