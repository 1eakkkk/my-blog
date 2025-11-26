export async function onRequestGet(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');

  // 增加 posts.category
  const fields = `
    posts.*, 
    users.username as author_username, 
    users.nickname as author_nickname, 
    users.is_vip as author_vip, 
    users.level as author_level, 
    users.avatar_variant as author_avatar_variant,
    users.role as author_role,
    users.custom_title as author_title,
    users.custom_title_color as author_title_color
  `;

  try {
    if (id) {
      const post = await db.prepare(`
        SELECT ${fields}
        FROM posts 
        JOIN users ON posts.user_id = users.id 
        WHERE posts.id = ?
      `).bind(id).first();
      return new Response(JSON.stringify(post), { headers: { 'Content-Type': 'application/json' } });
    } else {
      const posts = await db.prepare(`
        SELECT ${fields}
        FROM posts 
        JOIN users ON posts.user_id = users.id 
        ORDER BY posts.created_at DESC
      `).all();
      return new Response(JSON.stringify(posts.results), { headers: { 'Content-Type': 'application/json' } });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  
  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) {
    return new Response(JSON.stringify({ success: false, error: '请先登录' }), { status: 401 });
  }
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  // 获取用户角色
  const user = await db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

  if (user.status === 'banned') return new Response(JSON.stringify({ success: false, error: '账号已封禁' }), { status: 403 });

  // 获取 category
  const { title, content, category } = await context.request.json();
  if (!title || !content) return new Response(JSON.stringify({ success: false, error: '内容不能为空' }), { status: 400 });

  // === 权限检查核心 ===
  let finalCategory = category || '灌水'; // 默认灌水
  
  // 如果想发公告，必须是管理员
  if (finalCategory === '公告' && user.role !== 'admin') {
      return new Response(JSON.stringify({ success: false, error: '权限不足：只有管理员可以发布公告' }), { status: 403 });
  }

  await db.prepare('INSERT INTO posts (user_id, author_name, title, content, category, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(user.id, user.nickname || user.username, title, content, finalCategory, Date.now())
    .run();

  const xpAdd = user.is_vip ? 100 : 50;
  await db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').bind(xpAdd, user.id).run();

  return new Response(JSON.stringify({ success: true, message: `发布成功！(${finalCategory}) 经验+${xpAdd}` }), { headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestDelete(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie) return new Response(JSON.stringify({ success: false }), { status: 401 });
  
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const user = await db.prepare(`SELECT users.id, users.role FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');

  let result;
  if (user.role === 'admin') {
      result = await db.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
  } else {
      result = await db.prepare('DELETE FROM posts WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  }

  if (result.meta.changes > 0) {
    return new Response(JSON.stringify({ success: true, message: '删除成功' }));
  } else {
    return new Response(JSON.stringify({ success: false, error: '无法删除' }), { status: 403 });
  }
}
