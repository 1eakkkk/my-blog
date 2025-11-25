export async function onRequestGet(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');

  if (id) {
    // 获取单篇文章
    const post = await db.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first();
    return new Response(JSON.stringify(post), { headers: { 'Content-Type': 'application/json' } });
  } else {
    // 获取文章列表 (最新的在前)
    const posts = await db.prepare('SELECT * FROM posts ORDER BY created_at DESC').all();
    return new Response(JSON.stringify(posts.results), { headers: { 'Content-Type': 'application/json' } });
  }
}

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

  // 2. 插入文章
  const { title, content } = await context.request.json();
  if (!title || !content) return new Response(JSON.stringify({ success: false, error: '内容不能为空' }), { status: 400 });

  await db.prepare('INSERT INTO posts (user_id, author_name, title, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(user.id, user.username, title, content, Date.now())
    .run();

  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
}

// === 新增：删除功能 ===
export async function onRequestDelete(context) {
  const db = context.env.DB;
  
  // 1. 鉴权 (必须登录)
  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) {
    return new Response(JSON.stringify({ success: false, error: '请先登录' }), { status: 401 });
  }
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

  // 2. 获取文章ID
  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');
  if (!id) return new Response(JSON.stringify({ success: false, error: '缺少参数' }), { status: 400 });

  // 3. 执行删除 (安全核心：WHERE id = ? AND user_id = ?)
  // 只有当文章ID存在，且这篇文章的作者ID等于当前登录用户ID时，才会删除。
  const result = await db.prepare('DELETE FROM posts WHERE id = ? AND user_id = ?')
    .bind(id, user.id)
    .run();

  if (result.meta.changes > 0) {
    return new Response(JSON.stringify({ success: true, message: '删除成功' }), { headers: { 'Content-Type': 'application/json' } });
  } else {
    // 如果影响行数为0，说明文章不存在，或者你不是作者
    return new Response(JSON.stringify({ success: false, error: '删除失败：无权操作或文章不存在' }), { status: 403 });
  }
}
