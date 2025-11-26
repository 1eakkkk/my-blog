// --- functions/api/posts.js ---

// 辅助函数：处理经验上限
async function addXpWithCap(db, userId, amount, today) {
  // 1. 获取当前状态
  const user = await db.prepare('SELECT daily_xp, last_xp_date, xp FROM users WHERE id = ?').bind(userId).first();
  
  // 2. 判断是否跨天，重置 daily_xp
  let currentDailyXp = user.daily_xp || 0;
  if (user.last_xp_date !== today) {
    currentDailyXp = 0;
  }

  // 3. 计算实际能加多少 (上限 120)
  if (currentDailyXp >= 120) {
    // 只有更新日期，不加经验
    await db.prepare('UPDATE users SET last_xp_date = ? WHERE id = ?').bind(today, userId).run();
    return { added: 0, msg: '今日经验已达上限(120)' };
  }

  let actualAdd = amount;
  if (currentDailyXp + amount > 120) {
    actualAdd = 120 - currentDailyXp; // 只加剩余部分
  }

  // 4. 执行更新
  await db.prepare('UPDATE users SET xp = xp + ?, daily_xp = ?, last_xp_date = ? WHERE id = ?')
    .bind(actualAdd, currentDailyXp + actualAdd, today, userId)
    .run();

  if (actualAdd < amount) {
    return { added: actualAdd, msg: `经验已达上限，实际获得 +${actualAdd}` };
  }
  return { added: actualAdd, msg: `经验 +${actualAdd}` };
}

export async function onRequestGet(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');

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
        SELECT ${fields} FROM posts JOIN users ON posts.user_id = users.id WHERE posts.id = ?
      `).bind(id).first();
      return new Response(JSON.stringify(post), { headers: { 'Content-Type': 'application/json' } });
    } else {
      // === 核心修改：公告置顶 ===
      // ORDER BY (category = '公告') DESC: 如果是公告，值为1，排前面；否则为0
      // 然后再按时间倒序
      const posts = await db.prepare(`
        SELECT ${fields} 
        FROM posts 
        JOIN users ON posts.user_id = users.id 
        ORDER BY (posts.category = '公告') DESC, posts.created_at DESC
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
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: false, error: '请先登录' }), { status: 401 });
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

  if (user.status === 'banned') return new Response(JSON.stringify({ success: false, error: '账号已封禁' }), { status: 403 });

  const { title, content, category } = await context.request.json();
  if (!title || !content) return new Response(JSON.stringify({ success: false, error: '内容不能为空' }), { status: 400 });

  let finalCategory = category || '灌水';
  if (finalCategory === '公告' && user.role !== 'admin') {
      return new Response(JSON.stringify({ success: false, error: '权限不足' }), { status: 403 });
  }

  await db.prepare('INSERT INTO posts (user_id, author_name, title, content, category, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(user.id, user.nickname || user.username, title, content, finalCategory, Date.now())
    .run();

  // === 经验限制逻辑 ===
  // UTC+8 时间
  const now = new Date();
  const utc8 = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const today = utc8.toISOString().split('T')[0];

  const xpBase = user.is_vip ? 100 : 50;
  const xpResult = await addXpWithCap(db, user.id, xpBase, today);

  return new Response(JSON.stringify({ success: true, message: `发布成功！${xpResult.msg}` }), { headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestDelete(context) {
  // ... (Delete 逻辑保持不变，篇幅原因省略，请保留原有的 Delete 代码) ...
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
