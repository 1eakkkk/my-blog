// --- functions/api/posts.js ---

// (保留辅助函数 addXpWithCap)
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
  
  // 获取当前查看的用户ID (用于判断是否点赞过)
  const cookie = context.request.headers.get('Cookie');
  let currentUserId = null;
  if (cookie && cookie.includes('session_id')) {
      const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
      const u = await db.prepare('SELECT user_id FROM sessions WHERE session_id = ?').bind(sessionId).first();
      if(u) currentUserId = u.user_id;
  }

  // 核心修复：加入了 users.xp as author_xp
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
        ORDER BY (posts.category = '公告') DESC, posts.created_at DESC
      `).all();
      return new Response(JSON.stringify(posts.results), { headers: { 'Content-Type': 'application/json' } });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}

// 仅修改 onRequestPost
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
  if (finalCategory === '公告' && user.role !== 'admin') return new Response(JSON.stringify({ success: false, error: '权限不足' }), { status: 403 });

  await db.prepare('INSERT INTO posts (user_id, author_name, title, content, category, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(user.id, user.nickname || user.username, title, content, finalCategory, Date.now()).run();

  // === UTC+8 日期 ===
  const now = new Date();
  const utc8 = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const today = utc8.toISOString().split('T')[0];

  // === 经验调整：改为 +10 (VIP +20) ===
  const xpBase = user.is_vip ? 20 : 10;
  // 注意：这里需要你把之前的 addXpWithCap 函数定义也放在 posts.js 里
  const xpResult = await addXpWithCap(db, user.id, xpBase, today); 

  // === 任务钩子：如果今天是“发帖”任务，进度+1 ===
  await db.prepare(`UPDATE daily_tasks SET progress = progress + 1 
                    WHERE user_id = ? AND task_type = 'post' AND is_claimed = 0 AND last_update_date = ?`)
          .bind(user.id, today).run();

  return new Response(JSON.stringify({ success: true, message: `发布成功！${xpResult.msg}` }), { headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestDelete(context) {
    // (删除逻辑保持不变，请保留)
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


