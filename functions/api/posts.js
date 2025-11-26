// --- functions/api/posts.js ---

async function addXpWithCap(db, userId, amount, today) {
  const user = await db.prepare('SELECT daily_xp, last_xp_date FROM users WHERE id = ?').bind(userId).first();
  let currentDailyXp = (user.last_xp_date === today) ? (user.daily_xp || 0) : 0;
  if (currentDailyXp >= 120) { await db.prepare('UPDATE users SET last_xp_date = ? WHERE id = ?').bind(today, userId).run(); return { added: 0, msg: '今日经验已满' }; }
  let actualAdd = amount;
  if (currentDailyXp + amount > 120) actualAdd = 120 - currentDailyXp;
  await db.prepare('UPDATE users SET xp = xp + ?, daily_xp = ?, last_xp_date = ? WHERE id = ?').bind(actualAdd, currentDailyXp + actualAdd, today, userId).run();
  return { added: actualAdd, msg: `经验 +${actualAdd}` };
}

export async function onRequestGet(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');
  
  const page = parseInt(url.searchParams.get('page')) || 1;
  const limit = parseInt(url.searchParams.get('limit')) || 10; 
  const offset = (page - 1) * limit;

  const cookie = context.request.headers.get('Cookie');
  let currentUserId = null;
  if (cookie && cookie.includes('session_id')) {
      const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
      const u = await db.prepare('SELECT user_id FROM sessions WHERE session_id = ?').bind(sessionId).first();
      if(u) currentUserId = u.user_id;
  }

  const fields = `
    posts.*, 
    users.username as author_username, 
    users.nickname as author_nickname, 
    users.is_vip as author_vip, 
    users.level as author_level, 
    users.xp as author_xp, 
    users.avatar_variant as author_avatar_variant,
    users.role as author_role,
    users.custom_title as author_title,
    users.custom_title_color as author_title_color,
    users.badge_preference as author_badge_preference,
    (SELECT COUNT(*) FROM likes WHERE target_id = posts.id AND target_type = 'post' AND user_id = ${currentUserId || 0}) as is_liked
  `;

  try {
    if (id) {
      const post = await db.prepare(`SELECT ${fields} FROM posts JOIN users ON posts.user_id = users.id WHERE posts.id = ?`).bind(id).first();
      return new Response(JSON.stringify(post), { headers: { 'Content-Type': 'application/json' } });
    } else {
      const posts = await db.prepare(`
        SELECT ${fields} 
        FROM posts 
        JOIN users ON posts.user_id = users.id 
        ORDER BY 
            (posts.category = '公告') DESC, 
            posts.is_pinned DESC, 
            posts.created_at DESC
        LIMIT ? OFFSET ?
      `).bind(limit, offset).all();
      
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
  if (user.status === 'banned') return new Response(JSON.stringify({ success: false, error: '账号封禁' }), { status: 403 });

  const { title, content, category } = await context.request.json();
  if (!title || !content) return new Response(JSON.stringify({ success: false, error: '内容为空' }), { status: 400 });

  let finalCategory = category || '灌水';
  if (finalCategory === '公告' && user.role !== 'admin') return new Response(JSON.stringify({ success: false, error: '权限不足' }), { status: 403 });

  await db.prepare('INSERT INTO posts (user_id, author_name, title, content, category, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(user.id, user.nickname || user.username, title, content, finalCategory, Date.now()).run();

  const now = new Date();
  const utc8 = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const today = utc8.toISOString().split('T')[0];
  const xpBase = user.is_vip ? 20 : 10;
  const xpResult = await addXpWithCap(db, user.id, xpBase, today); 

  await db.prepare(`UPDATE daily_tasks SET progress = progress + 1 WHERE user_id = ? AND task_type = 'post' AND is_claimed = 0 AND last_update_date = ?`).bind(user.id, today).run();
  return new Response(JSON.stringify({ success: true, message: `发布成功！${xpResult.msg}` }));
}

export async function onRequestPut(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie) return new Response(JSON.stringify({ success: false }), { status: 401 });
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const user = await db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

  const { id, action, title, content, category } = await context.request.json();

  // 1. 编辑帖子
  if (action === 'edit') {
      const post = await db.prepare('SELECT user_id FROM posts WHERE id = ?').bind(id).first();
      if (!post) return new Response(JSON.stringify({ success: false, error: '帖子不存在' }));
      if (post.user_id !== user.id && user.role !== 'admin') {
          return new Response(JSON.stringify({ success: false, error: '无权编辑他人文章' }), { status: 403 });
      }

      let finalCat = category;
      if (finalCat === '公告' && user.role !== 'admin') {
          return new Response(JSON.stringify({ success: false, error: '无权发布公告' }), { status: 403 });
      }

      // === 修改：更新 updated_at ===
      await db.prepare('UPDATE posts SET title = ?, content = ?, category = ?, updated_at = ? WHERE id = ?')
          .bind(title, content, finalCat, Date.now(), id).run();
      return new Response(JSON.stringify({ success: true, message: '文章已更新' }));
  }

  // 2. 置顶操作
  if (action === 'pin') {
      if (user.role !== 'admin') return new Response(JSON.stringify({ success: false, error: '权限不足' }), { status: 403 });
      const current = await db.prepare('SELECT is_pinned FROM posts WHERE id = ?').bind(id).first();
      const newState = current.is_pinned ? 0 : 1;
      await db.prepare('UPDATE posts SET is_pinned = ? WHERE id = ?').bind(newState, id).run();
      return new Response(JSON.stringify({ success: true, message: newState ? '已置顶' : '已取消置顶', is_pinned: newState }));
  }

  return new Response(JSON.stringify({ success: false, error: '未知操作' }));
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
    if (user.role === 'admin') result = await db.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
    else result = await db.prepare('DELETE FROM posts WHERE id = ? AND user_id = ?').bind(id, user.id).run();
    if (result.meta.changes > 0) return new Response(JSON.stringify({ success: true, message: '删除成功' }));
    else return new Response(JSON.stringify({ success: false, error: '无法删除' }), { status: 403 });
}
