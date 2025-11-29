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
  
  // === 1. 自动清理过期置顶 (懒惰清理策略) ===
  // 每次有人拉取帖子列表时，顺手把过期的置顶取消掉
  const now = Date.now();
  await db.prepare('UPDATE posts SET is_pinned = 0, pinned_until = 0 WHERE is_pinned = 1 AND pinned_until > 0 AND pinned_until < ?').bind(now).run();
  // =======================================

  const sort = url.searchParams.get('sort') || 'latest'; 
  const search = url.searchParams.get('search') || '';
  
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
    posts.total_coins,
    users.username as author_username, 
    users.nickname as author_nickname, 
    users.is_vip as author_vip, 
    users.level as author_level, 
    users.xp as author_xp, 
    users.avatar_variant as author_avatar_variant,
    users.avatar_url as author_avatar_url,
    users.role as author_role,
    users.custom_title as author_title,
    users.custom_title_color as author_title_color,
    users.badge_preference as author_badge_preference,
    users.equipped_post_style as author_equipped_post_style,
    users.name_color as author_name_color, 
    (SELECT COUNT(*) FROM likes WHERE target_id = posts.id AND target_type = 'post' AND user_id = ${currentUserId || 0}) as is_liked,
    (SELECT COUNT(*) FROM comments WHERE post_id = posts.id) as comment_count
  `;

  try {
    if (id) {
      const post = await db.prepare(`SELECT ${fields} FROM posts JOIN users ON posts.user_id = users.id WHERE posts.id = ?`).bind(id).first();
      return new Response(JSON.stringify(post), { headers: { 'Content-Type': 'application/json' } });
    } else {
      let sql = `SELECT ${fields} FROM posts JOIN users ON posts.user_id = users.id`;
      const params = [];

      if (search) {
          const term = `%${search}%`;
          sql += ` WHERE (
              posts.title LIKE ? OR 
              posts.content LIKE ? OR 
              posts.category LIKE ? OR
              EXISTS (SELECT 1 FROM comments WHERE comments.post_id = posts.id AND comments.content LIKE ?)
          )`;
          params.push(term, term, term, term);
      }

      sql += ` ORDER BY (posts.category = '公告') DESC, posts.is_pinned DESC`; 
      
      if (sort === 'hot') {
          sql += `, posts.like_count DESC, posts.created_at DESC`;
      } else if (sort === 'comments') {
          sql += `, comment_count DESC, posts.created_at DESC`; 
      } else {
          sql += `, posts.created_at DESC`; 
      }

      sql += ` LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const posts = await db.prepare(sql).bind(...params).all();
      return new Response(JSON.stringify(posts.results), { headers: { 'Content-Type': 'application/json' } });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}

export async function onRequestPost(context) {
  // ... (POST 发帖逻辑保持不变，请直接复制你原有的 POST 代码，或者我下面给你简略版) ...
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: false, error: '请先登录' }), { status: 401 });
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });
  if (user.status === 'banned') return new Response(JSON.stringify({ success: false, error: '账号封禁' }), { status: 403 });

  let { title, content, category } = await context.request.json();
  
  if ((!title || !title.trim()) && (!content || !content.trim())) {
      return new Response(JSON.stringify({ success: false, error: '标题和内容不能同时为空' }), { status: 400 });
  }

  if (!title || !title.trim()) title = "无题 / Untitled";
  if (!content || !content.trim()) content = "（如题）";

  let finalCategory = category || '灌水';
  if (finalCategory === '公告' && user.role !== 'admin') return new Response(JSON.stringify({ success: false, error: '权限不足' }), { status: 403 });

  await db.prepare('INSERT INTO posts (user_id, author_name, title, content, category, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(user.id, user.nickname || user.username, title, content, finalCategory, Date.now()).run();

  const now = Date.now();
  const utc8 = new Date(now + (8 * 60 * 60 * 1000));
  const today = utc8.toISOString().split('T')[0];
  
  const isVip = user.vip_expires_at > now;
  let xpBase = 10; 
  if (isVip) xpBase = Math.floor(10 * 1.45); 
  
  const xpResult = await addXpWithCap(db, user.id, xpBase, today); 

  await db.batch([
      db.prepare(`UPDATE user_tasks SET progress = progress + 1 WHERE user_id = ? AND task_code LIKE 'post_%' AND status = 0`).bind(user.id)
  ]);

  return new Response(JSON.stringify({ success: true, message: `发布成功！${xpResult.msg}` }));
}

export async function onRequestPut(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie) return new Response(JSON.stringify({ success: false }), { status: 401 });
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const user = await db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

  let { id, action, title, content, category } = await context.request.json();

  // 编辑帖子
  if (action === 'edit') {
      const post = await db.prepare('SELECT user_id FROM posts WHERE id = ?').bind(id).first();
      if (!post) return new Response(JSON.stringify({ success: false, error: '帖子不存在' }));
      if (post.user_id !== user.id && user.role !== 'admin') return new Response(JSON.stringify({ success: false, error: '无权编辑' }), { status: 403 });
      if (category === '公告' && user.role !== 'admin') return new Response(JSON.stringify({ success: false, error: '无权' }), { status: 403 });

      if ((!title || !title.trim()) && (!content || !content.trim())) {
          return new Response(JSON.stringify({ success: false, error: '不能全为空' }), { status: 400 });
      }
      if (!title || !title.trim()) title = "无题 / Untitled";
      if (!content || !content.trim()) content = "（如题）";

      await db.prepare('UPDATE posts SET title = ?, content = ?, category = ?, updated_at = ? WHERE id = ?')
          .bind(title, content, category, Date.now(), id).run();
      return new Response(JSON.stringify({ success: true, message: '文章已更新' }));
  }

  // === 核心修改：置顶逻辑 (消耗置顶卡) ===
  if (action === 'pin') {
      const post = await db.prepare('SELECT user_id, is_pinned FROM posts WHERE id = ?').bind(id).first();
      if (!post) return new Response(JSON.stringify({ success: false, error: '帖子不存在' }));

      // 如果是管理员，直接操作 (无限权限)
      if (user.role === 'admin') {
          const newState = post.is_pinned ? 0 : 1;
          // 管理员置顶不设过期时间，或者是永久
          await db.prepare('UPDATE posts SET is_pinned = ?, pinned_until = 0 WHERE id = ?').bind(newState, id).run();
          return new Response(JSON.stringify({ success: true, message: newState ? '管理员已置顶' : '管理员已取消置顶', is_pinned: newState }));
      } 
      
      // 如果是普通用户
      else {
          // 只能操作自己的帖子
          if (post.user_id !== user.id) return new Response(JSON.stringify({ success: false, error: '无权操作他人帖子' }), { status: 403 });

          // 如果已经置顶，允许取消 (不退卡)
          if (post.is_pinned) {
               await db.prepare('UPDATE posts SET is_pinned = 0, pinned_until = 0 WHERE id = ?').bind(id).run();
               return new Response(JSON.stringify({ success: true, message: '已取消置顶', is_pinned: 0 }));
          } 
          
          // 如果想置顶，检查背包
          const card = await db.prepare("SELECT id, quantity FROM user_items WHERE user_id = ? AND item_id = 'top_card' AND quantity > 0").bind(user.id).first();
          
          if (!card) {
              return new Response(JSON.stringify({ success: false, error: '您没有[置顶卡]，请前往商城购买' }), { status: 400 });
          }

          // 消耗卡片并置顶 24 小时
          const expireTime = Date.now() + (24 * 60 * 60 * 1000);
          await db.batch([
              db.prepare('UPDATE posts SET is_pinned = 1, pinned_until = ? WHERE id = ?').bind(expireTime, id),
              db.prepare('UPDATE user_items SET quantity = quantity - 1 WHERE id = ?').bind(card.id)
          ]);

          return new Response(JSON.stringify({ success: true, message: '消耗一张置顶卡，置顶 24 小时成功！', is_pinned: 1 }));
      }
  }
  return new Response(JSON.stringify({ success: false, error: '未知操作' }));
}

// onRequestDelete 保持不变，请自行保留
export async function onRequestDelete(context) {
    // ... (代码不变) ...
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

