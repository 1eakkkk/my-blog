// --- functions/api/comments.js ---

export async function onRequestGet(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const postId = url.searchParams.get('post_id');
  
  // 获取当前用户ID用于判断是否点赞
  const cookie = context.request.headers.get('Cookie');
  let currentUserId = 0;
  if (cookie && cookie.includes('session_id')) {
      const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
      const u = await db.prepare('SELECT user_id FROM sessions WHERE session_id = ?').bind(sessionId).first();
      if(u) currentUserId = u.user_id;
  }

  if (!postId) return new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } });

  // 联合查询增加了 parent_id, like_count, is_liked, badge_preference
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
    ORDER BY comments.created_at ASC
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

  // 新增 parent_id
  const { post_id, content, parent_id } = await context.request.json();
  if (!content) return new Response(JSON.stringify({ success: false, error: '内容为空' }), { status: 400 });

  // 验证 parent_id 是否有效（且不能是二级评论，防止无限套娃）
  let finalParentId = null;
  if (parent_id) {
      const parentComment = await db.prepare('SELECT id, parent_id, user_id FROM comments WHERE id = ?').bind(parent_id).first();
      if (!parentComment) return new Response(JSON.stringify({ success: false, error: '回复的评论不存在' }), { status: 404 });
      
      // 核心逻辑：如果回复的对象本身就是回复(parent_id不为空)，则强制归属到其父级，或者直接禁止
      // 需求是：缩进最多1次。所以所有回复都挂在根评论下。
      if (parentComment.parent_id) {
          finalParentId = parentComment.parent_id; // 挂到爷爷节点（根评论）
      } else {
          finalParentId = parentComment.id; // 挂到父节点
      }
  }

  // 插入评论
  await db.prepare('INSERT INTO comments (post_id, user_id, content, parent_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(post_id, user.id, content, finalParentId, Date.now())
    .run();

  // === 经验处理 (内联逻辑) ===
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
  } else {
      xpMsg = " (今日满)";
  }

  // === 通知逻辑 ===
  const senderName = user.nickname || user.username;
  
  // 1. 如果是回复，通知被回复的人
  if (finalParentId) {
      // 查找直接回复的目标用户（注意：这里稍微复杂，如果归并到根评论，我们其实想通知的是用户点回复的那个具体的层主）
      // 简化逻辑：这里通知根评论的主人，或者如果前端传了具体 target，可以优化。
      // 为简单起见，我们通知 finalParentId 的主人（根评论作者）
      const parentOwner = await db.prepare('SELECT user_id, content FROM comments WHERE id = ?').bind(finalParentId).first();
      if (parentOwner && parentOwner.user_id !== user.id) {
          const msg = `${senderName} 回复了你的评论: ${parentOwner.content.substring(0, 20)}...`;
          await db.prepare('INSERT INTO notifications (user_id, type, message, link, created_at) VALUES (?, ?, ?, ?, ?)')
            .bind(parentOwner.user_id, 'reply', msg, `#post?id=${post_id}`, Date.now()).run();
      }
  } else {
      // 2. 如果是根评论，通知文章作者
      const post = await db.prepare('SELECT user_id, title FROM posts WHERE id = ?').bind(post_id).first();
      if (post && post.user_id !== user.id) {
        const msg = `${senderName} 评论了你的文章: ${post.title}`;
        await db.prepare('INSERT INTO notifications (user_id, type, message, link, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(post.user_id, 'comment', msg, `#post?id=${post_id}`, Date.now()).run();
      }
  }

  // 任务进度
  await db.prepare(`UPDATE daily_tasks SET progress = progress + 1 WHERE user_id = ? AND task_type = 'comment' AND is_claimed = 0 AND last_update_date = ?`).bind(user.id, today).run();

  return new Response(JSON.stringify({ success: true, message: `发布成功${xpMsg}` }));
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

  // 删除评论及其子评论
  let result;
  if (user.role === 'admin') {
      result = await db.prepare('DELETE FROM comments WHERE id = ? OR parent_id = ?').bind(commentId, commentId).run();
  } else {
      // 普通用户只能删自己的
      result = await db.prepare('DELETE FROM comments WHERE id = ? AND user_id = ?').bind(commentId, user.id).run();
  }

  if (result.meta.changes > 0) return new Response(JSON.stringify({ success: true, message: '评论已删除' }));
  else return new Response(JSON.stringify({ success: false, error: '删除失败' }), { status: 403 });
}
