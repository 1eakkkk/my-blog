export async function onRequestGet(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const postId = url.searchParams.get('post_id');

  const page = parseInt(url.searchParams.get('page')) || 1;
  const limit = parseInt(url.searchParams.get('limit')) || 20;
  const offset = (page - 1) * limit;

  const cookie = context.request.headers.get('Cookie');
  let currentUserId = 0;
  if (cookie && cookie.includes('session_id')) {
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const u = await db.prepare('SELECT user_id FROM sessions WHERE session_id = ?').bind(sessionId).first();
    if (u) currentUserId = u.user_id;
  }

  if (!postId) return new Response(JSON.stringify({ results: [] }), { headers: { 'Content-Type': 'application/json' } });

  const countRes = await db.prepare('SELECT COUNT(*) as total FROM comments WHERE post_id = ?').bind(postId).first();
  const total = countRes.total;

  const comments = await db.prepare(`
    SELECT comments.*,
           users.username, users.nickname, users.avatar_variant, users.avatar_url,
           users.role,
           reply_users.username as reply_to_username,
           reply_users.nickname as reply_to_nickname,
           (SELECT COUNT(*) FROM likes WHERE target_id = comments.id AND target_type = 'comment') as like_count,
           (SELECT COUNT(*) FROM likes WHERE target_id = comments.id AND target_type = 'comment' AND user_id = ?) as is_liked
    FROM comments
    JOIN users ON comments.user_id = users.id
    LEFT JOIN users AS reply_users ON comments.reply_to_uid = reply_users.id
    WHERE comments.post_id = ?
    ORDER BY comments.is_pinned DESC, comments.created_at ASC
    LIMIT ? OFFSET ?
  `).bind(currentUserId, postId, limit, offset).all();

  return new Response(JSON.stringify({
    total: total,
    page: page,
    limit: limit,
    results: comments.results
  }), { headers: { 'Content-Type': 'application/json' } });
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
  if (content.length > 500) return new Response(JSON.stringify({ success: false, error: '评论最多500字' }), { status: 400 });

  const postOwner = await db.prepare('SELECT user_id FROM posts WHERE id = ?').bind(post_id).first();
  if (!postOwner) return new Response(JSON.stringify({ success: false, error: '帖子不存在' }), { status: 404 });

  let finalParentId = null;
  let replyToUid = null;

  if (parent_id) {
    const targetComment = await db.prepare('SELECT id, parent_id, user_id FROM comments WHERE id = ?').bind(parent_id).first();
    if (!targetComment) return new Response(JSON.stringify({ success: false, error: '回复的评论不存在' }), { status: 404 });
    replyToUid = targetComment.user_id;
    if (targetComment.parent_id) finalParentId = targetComment.parent_id;
    else finalParentId = targetComment.id;
  }

  await db.prepare('INSERT INTO comments (post_id, user_id, content, parent_id, reply_to_uid, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(post_id, user.id, content, finalParentId, replyToUid, Date.now()).run();

  return new Response(JSON.stringify({ success: true, message: '评论成功' }));
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
    if (!comment) return new Response(JSON.stringify({ success: false, error: '评论不存在' }));
    if (comment.user_id !== user.id && user.role !== 'admin') return new Response(JSON.stringify({ success: false, error: '无权编辑' }), { status: 403 });
    await db.prepare('UPDATE comments SET content = ? WHERE id = ?').bind(content, id).run();
    return new Response(JSON.stringify({ success: true, message: '评论已更新' }));
  }

  if (action === 'pin') {
    const comment = await db.prepare('SELECT post_id, is_pinned FROM comments WHERE id = ?').bind(id).first();
    if (!comment) return new Response(JSON.stringify({ success: false, error: '评论不存在' }));
    const post = await db.prepare('SELECT user_id FROM posts WHERE id = ?').bind(comment.post_id).first();
    if (!post) return new Response(JSON.stringify({ success: false, error: '文章不存在' }));
    if (post.user_id !== user.id && user.role !== 'admin') return new Response(JSON.stringify({ success: false, error: '无权' }), { status: 403 });

    const newState = comment.is_pinned ? 0 : 1;
    if (newState === 1) await db.prepare('UPDATE comments SET is_pinned = 0 WHERE post_id = ?').bind(comment.post_id).run();
    await db.prepare('UPDATE comments SET is_pinned = ? WHERE id = ?').bind(newState, id).run();
    return new Response(JSON.stringify({ success: true, message: newState ? '评论已置顶' : '已取消置顶' }));
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
  const commentId = url.searchParams.get('id');

  let result;
  if (user.role === 'admin') {
    result = await db.prepare('DELETE FROM comments WHERE id = ? OR parent_id = ?').bind(commentId, commentId).run();
  } else {
    result = await db.prepare('DELETE FROM comments WHERE id = ? AND user_id = ?')
      .bind(commentId, user.id).run();
    if (result.meta.changes > 0) {
      await db.prepare('DELETE FROM comments WHERE parent_id = ?')
        .bind(commentId).run();
    }
  }

  if (result.meta.changes > 0) return new Response(JSON.stringify({ success: true, message: '评论已删除' }));
  else return new Response(JSON.stringify({ success: false, error: '删除失败' }), { status: 403 });
}
