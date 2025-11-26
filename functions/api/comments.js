// --- functions/api/comments.js ---
export async function onRequestGet(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const postId = url.searchParams.get('post_id');
  const cookie = context.request.headers.get('Cookie');
  let currentUserId = 0;
  if (cookie && cookie.includes('session_id')) {
      const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
      const u = await db.prepare('SELECT user_id FROM sessions WHERE session_id = ?').bind(sessionId).first();
      if(u) currentUserId = u.user_id;
  }
  if (!postId) return new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } });

  // === 排序：置顶优先，然后按时间 ===
  const comments = await db.prepare(`
    SELECT comments.*, 
           users.username, users.nickname, users.avatar_variant, 
           users.is_vip, users.level, users.xp, users.role, 
           users.custom_title, users.custom_title_color, users.badge_preference,
           (SELECT COUNT(*) FROM likes WHERE target_id = comments.id AND target_type = 'comment') as like_count,
           (SELECT COUNT(*) FROM likes WHERE target_id = comments.id AND target_type = 'comment' AND user_id = ?) as is_liked
    FROM comments
    JOIN users ON comments.user_id = users.id
    WHERE comments.post_id = ?
    ORDER BY comments.is_pinned DESC, comments.created_at ASC
  `).bind(currentUserId, postId).all();

  return new Response(JSON.stringify(comments.results), { headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost(context) {
  // ... (保留原有的发布逻辑)
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: false, error: '请先登录' }), { status: 401 });
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare(`SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });
  if (user.status === 'banned') return new Response(JSON.stringify({ success: false, error: '账号封禁中' }), { status: 403 });

  const { post_id, content, parent_id } = await context.request.json();
  if (!content) return new Response(JSON.stringify({ success: false, error: '内容为空' }), { status: 400 });

  let finalParentId = null;
  if (parent_id) {
      const parentComment = await db.prepare('SELECT id, parent_id, user_id FROM comments WHERE id = ?').bind(parent_id).first();
      if (!parentComment) return new Response(JSON.stringify({ success: false, error: '回复的评论不存在' }), { status: 404 });
      if (parentComment.parent_id) finalParentId = parentComment.parent_id;
      else finalParentId = parentComment.id;
  }

  await db.prepare('INSERT INTO comments (post_id, user_id, content, parent_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(post_id, user.id, content, finalParentId, Date.now()).run();

  const now = new Date();
  const utc8 = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const today = utc8.toISOString().split('T')[0];
  const userData = await db.prepare('SELECT daily_xp, last_xp_date FROM users WHERE id = ?').bind(user.id).first();
  let currentDailyXp = (userData.last_xp_date === today) ? (userData.daily_xp || 0) : 0;
  let xpMsg = "";
  if (currentDailyXp < 120) {
      let add = 5;
      if (currentDailyXp + 5 > 120) add = 120 - currentDailyXp;
      await db.prepare('UPDATE users SET xp = xp + ?, daily_xp = ?, last_xp_date = ? WHERE id = ?')
        .bind(add, currentDailyXp + add, today, user.id).run();
      xpMsg = ` +${add} XP`;
  } else { xpMsg = " (今日满)"; }

  const senderName = user.nickname || user.username;
  if (finalParentId) {
      const parentOwner = await db.prepare('SELECT user_id, content FROM comments WHERE id = ?').bind(finalParentId).first();
      if (parentOwner && parentOwner.user_id !== user.id) {
          const msg = `${senderName} 回复了你的评论: ${parentOwner.content.substring(0, 20)}...`;
          await db.prepare('INSERT INTO notifications (user_id, type, message, link, created_at) VALUES (?, ?, ?, ?, ?)')
            .bind(parentOwner.user_id, 'reply', msg, `#post?id=${post_id}`, Date.now()).run();
      }
  } else {
      const post = await db.prepare('SELECT user_id, title FROM posts WHERE id = ?').bind(post_id).first();
      if (post && post.user_id !== user.id) {
        const msg = `${senderName} 评论了你的文章: ${post.title}`;
        await db.prepare('INSERT INTO notifications (user_id, type, message, link, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(post.user_id, 'comment', msg, `#post?id=${post_id}`, Date.now()).run();
      }
  }
  await db.prepare(`UPDATE daily_tasks SET progress = progress + 1 WHERE user_id = ? AND task_type = 'comment' AND is_claimed = 0 AND last_update_date = ?`).bind(user.id, today).run();
  return new Response(JSON.stringify({ success: true, message: `发布成功${xpMsg}` }));
}

// === 新增：PUT 用于编辑和置顶评论 ===
export async function onRequestPut(context) {
    const db = context.env.DB;
    const cookie = context.request.headers.get('Cookie');
    if (!cookie) return new Response(JSON.stringify({ success: false }), { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
    if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

    const { id, action, content } = await context.request.json();

    // 1. 编辑评论
    if (action === 'edit') {
        const comment = await db.prepare('SELECT user_id FROM comments WHERE id = ?').bind(id).first();
        if(!comment) return new Response(JSON.stringify({ success: false, error: '评论不存在' }));
        if(comment.user_id !== user.id && user.role !== 'admin') {
            return new Response(JSON.stringify({ success: false, error: '无权编辑' }), { status: 403 });
        }
        await db.prepare('UPDATE comments SET content = ? WHERE id = ?').bind(content, id).run();
        return new Response(JSON.stringify({ success: true, message: '评论已更新' }));
    }

    // 2. 置顶评论 (文章作者 或 管理员 可以置顶)
    if (action === 'pin') {
        // 先查这篇文章是谁写的
        const comment = await db.prepare('SELECT post_id, is_pinned FROM comments WHERE id = ?').bind(id).first();
        if(!comment) return new Response(JSON.stringify({ success: false, error: '评论不存在' }));
        
        const post = await db.prepare('SELECT user_id FROM posts WHERE id = ?').bind(comment.post_id).first();
        if (!post) return new Response(JSON.stringify({ success: false, error: '文章不存在' }));

        // 鉴权：是文章作者 或者是 管理员
        if (post.user_id !== user.id && user.role !== 'admin') {
            return new Response(JSON.stringify({ success: false, error: '无权置顶此评论' }), { status: 403 });
        }

        const newState = comment.is_pinned ? 0 : 1;
        // 如果是置顶，先把该文章下其他置顶取消（可选逻辑，这里假设只能置顶一个）
        // 如果允许置顶多个，则不需要这行。通常评论区只置顶一个。
        if (newState === 1) {
            await db.prepare('UPDATE comments SET is_pinned = 0 WHERE post_id = ?').bind(comment.post_id).run();
        }

        await db.prepare('UPDATE comments SET is_pinned = ? WHERE id = ?').bind(newState, id).run();
        return new Response(JSON.stringify({ success: true, message: newState ? '评论已置顶' : '已取消置顶' }));
    }
}

export async function onRequestDelete(context) {
    // ... (保留原有的删除逻辑)
    const db = context.env.DB;
    const cookie = context.request.headers.get('Cookie');
    if (!cookie) return new Response(JSON.stringify({ success: false }), { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare(`SELECT users.id, users.role FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
    if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

    const url = new URL(context.request.url);
    const commentId = url.searchParams.get('id');

    let result;
    if (user.role === 'admin') {
        result = await db.prepare('DELETE FROM comments WHERE id = ? OR parent_id = ?').bind(commentId, commentId).run();
    } else {
        result = await db.prepare('DELETE FROM comments WHERE id = ? AND user_id = ?').bind(commentId, user.id).run();
    }

    if (result.meta.changes > 0) return new Response(JSON.stringify({ success: true, message: '评论已删除' }));
    else return new Response(JSON.stringify({ success: false, error: '删除失败' }), { status: 403 });
}
