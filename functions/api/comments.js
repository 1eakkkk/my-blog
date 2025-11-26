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

  // === 修改：关联查询获取被回复者的信息 ===
  const comments = await db.prepare(`
    SELECT comments.*, 
           users.username, users.nickname, users.avatar_variant, 
           users.is_vip, users.level, users.xp, users.role, 
           users.custom_title, users.custom_title_color, users.badge_preference,
           reply_users.username as reply_to_username,
           reply_users.nickname as reply_to_nickname,
           (SELECT COUNT(*) FROM likes WHERE target_id = comments.id AND target_type = 'comment') as like_count,
           (SELECT COUNT(*) FROM likes WHERE target_id = comments.id AND target_type = 'comment' AND user_id = ?) as is_liked
    FROM comments
    JOIN users ON comments.user_id = users.id
    LEFT JOIN users AS reply_users ON comments.reply_to_uid = reply_users.id
    WHERE comments.post_id = ?
    ORDER BY comments.is_pinned DESC, comments.created_at ASC
  `).bind(currentUserId, postId).all();

  return new Response(JSON.stringify(comments.results), { headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: false, error: '请先登录' }), { status: 401 });
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare(`SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });
  if (user.status === 'banned') return new Response(JSON.stringify({ success: false, error: '账号封禁中' }), { status: 403 });

  const { post_id, content, parent_id } = await context.request.json();
  if (!content) return new Response(JSON.stringify({ success: false, error: '内容为空' }), { status: 400 });

  let finalParentId = null; // 数据库存储的父ID（永远指向根评论）
  let replyToUid = null;    // 实际回复的目标用户ID

  // === 修改：处理回复逻辑 ===
  if (parent_id) {
      // 查找用户点击的那条评论
      const targetComment = await db.prepare('SELECT id, parent_id, user_id, content FROM comments WHERE id = ?').bind(parent_id).first();
      if (!targetComment) return new Response(JSON.stringify({ success: false, error: '回复的评论不存在' }), { status: 404 });
      
      // 记录实际回复的人
      replyToUid = targetComment.user_id;

      // 计算根评论ID (视觉缩进用)
      if (targetComment.parent_id) {
          finalParentId = targetComment.parent_id; // 如果回复的是子评论，挂到爷爷(根)下面
      } else {
          finalParentId = targetComment.id; // 如果回复的是根评论，挂到它下面
      }
  }

  // 插入评论
  await db.prepare('INSERT INTO comments (post_id, user_id, content, parent_id, reply_to_uid, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(post_id, user.id, content, finalParentId, replyToUid, Date.now()).run();

  // 经验逻辑
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
  
  // === 修改：精准通知逻辑 ===
  // 只有当有明确回复目标(replyToUid)，且不是自己回复自己时，才发回复通知
  if (replyToUid && replyToUid !== user.id) {
       // 为了通知内容更友好，我们再次查询目标评论内容（可选，其实targetComment还在上面）
       // 这里简单处理：通知内容显示“回复了你的评论”
       const targetContent = await db.prepare('SELECT content FROM comments WHERE id = ?').bind(parent_id).first(); // 获取直接点击的那条
       const snippet = targetContent ? targetContent.content.substring(0, 20) : "";
       const msg = `${senderName} 回复了你的评论: ${snippet}...`;
       
       await db.prepare('INSERT INTO notifications (user_id, type, message, link, created_at) VALUES (?, ?, ?, ?, ?)')
         .bind(replyToUid, 'reply', msg, `#post?id=${post_id}`, Date.now()).run();
  } 
  // 如果是直接评论文章（没有 replyToUid），则通知文章作者
  else if (!replyToUid) {
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

export async function onRequestPut(context) {
    const db = context.env.DB;
    const cookie = context.request.headers.get('Cookie');
    if (!cookie) return new Response(JSON.stringify({ success: false }), { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
    if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

    const { id, action, content } = await context.request.json();

    if (action === 'edit') {
        const comment = await db.prepare('SELECT user_id FROM comments WHERE id = ?').bind(id).first();
        if(!comment) return new Response(JSON.stringify({ success: false, error: '评论不存在' }));
        if(comment.user_id !== user.id && user.role !== 'admin') {
            return new Response(JSON.stringify({ success: false, error: '无权编辑' }), { status: 403 });
        }
        await db.prepare('UPDATE comments SET content = ? WHERE id = ?').bind(content, id).run();
        return new Response(JSON.stringify({ success: true, message: '评论已更新' }));
    }

    if (action === 'pin') {
        const comment = await db.prepare('SELECT post_id, is_pinned FROM comments WHERE id = ?').bind(id).first();
        if(!comment) return new Response(JSON.stringify({ success: false, error: '评论不存在' }));
        const post = await db.prepare('SELECT user_id FROM posts WHERE id = ?').bind(comment.post_id).first();
        if (!post) return new Response(JSON.stringify({ success: false, error: '文章不存在' }));
        if (post.user_id !== user.id && user.role !== 'admin') {
            return new Response(JSON.stringify({ success: false, error: '无权置顶此评论' }), { status: 403 });
        }
        const newState = comment.is_pinned ? 0 : 1;
        if (newState === 1) {
            await db.prepare('UPDATE comments SET is_pinned = 0 WHERE post_id = ?').bind(comment.post_id).run();
        }
        await db.prepare('UPDATE comments SET is_pinned = ? WHERE id = ?').bind(newState, id).run();
        return new Response(JSON.stringify({ success: true, message: newState ? '评论已置顶' : '已取消置顶' }));
    }
}

export async function onRequestDelete(context) {
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
