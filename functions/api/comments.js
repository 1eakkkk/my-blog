import { json, getUser, readJson, positiveId, isBanned } from './_lib.js';

const COMMENT_FIELDS = `comments.*, users.username, users.nickname, users.avatar_variant, users.avatar_url,
  users.role, reply_users.username AS reply_to_username, reply_users.nickname AS reply_to_nickname,
  (SELECT COUNT(*) FROM likes WHERE target_id = comments.id AND target_type = 'comment') AS like_count,
  (SELECT COUNT(*) FROM likes WHERE target_id = comments.id AND target_type = 'comment' AND user_id = ?) AS is_liked`;
const COMMENT_JOINS = `JOIN users ON comments.user_id = users.id
  LEFT JOIN users AS reply_users ON comments.reply_to_uid = reply_users.id`;
const REPLY_LIMIT = 20;

export async function onRequestGet(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const rawPostId = url.searchParams.get('post_id');
  const postId = positiveId(rawPostId);

  const page = url.searchParams.has('page') ? positiveId(url.searchParams.get('page')) : 1;
  const limit = url.searchParams.has('limit') ? positiveId(url.searchParams.get('limit')) : 20;
  const rootId = url.searchParams.has('root_id') ? positiveId(url.searchParams.get('root_id')) : null;
  const locateId = url.searchParams.has('locate_id') ? positiveId(url.searchParams.get('locate_id')) : null;
  if ((rawPostId && !postId) || !page || page > 100000 || !limit || limit > 100 ||
      (url.searchParams.has('root_id') && !rootId) || (url.searchParams.has('locate_id') && !locateId) ||
      (rootId && locateId)) return json({ success: false, error: '参数无效' }, { status: 400 });
  const offset = (page - 1) * limit;

  const viewer = await getUser(context);
  const currentUserId = viewer ? viewer.id : 0;

  if (!postId) return new Response(JSON.stringify({ results: [] }), { headers: { 'Content-Type': 'application/json' } });

  if (rootId) {
    const root = await db.prepare('SELECT id FROM comments WHERE id = ? AND post_id = ? AND parent_id IS NULL').bind(rootId, postId).first();
    if (!root) return json({ error: '讨论不存在' }, { status: 404 });
    const { total } = await db.prepare('SELECT COUNT(*) AS total FROM comments WHERE parent_id = ? AND post_id = ?').bind(rootId, postId).first();
    const replies = await db.prepare(`SELECT ${COMMENT_FIELDS} FROM comments ${COMMENT_JOINS}
      WHERE comments.parent_id = ? AND comments.post_id = ?
      ORDER BY comments.is_pinned DESC, comments.created_at ASC, comments.id ASC LIMIT ? OFFSET ?`)
      .bind(currentUserId, rootId, postId, limit, offset).all();
    return json({ root_id: rootId, total, page, limit, has_more: offset + replies.results.length < total, results: replies.results });
  }

  let focusRootId = null;
  let replyPage = 1;
  if (locateId) {
    const target = await db.prepare('SELECT id, parent_id FROM comments WHERE id = ? AND post_id = ?').bind(locateId, postId).first();
    if (!target) return json({ error: '该评论已删除或不存在' }, { status: 404 });
    focusRootId = target.parent_id || target.id;
    if (target.parent_id) {
      const ranked = await db.prepare(`SELECT position FROM (
        SELECT id, ROW_NUMBER() OVER (ORDER BY is_pinned DESC, created_at ASC, id ASC) AS position
        FROM comments WHERE parent_id = ? AND post_id = ?) WHERE id = ?`).bind(focusRootId, postId, locateId).first();
      replyPage = Math.ceil(ranked.position / REPLY_LIMIT);
    }
  }
  const counts = await db.prepare(`SELECT COUNT(*) AS total,
    COALESCE(SUM(parent_id IS NULL), 0) AS root_total FROM comments WHERE post_id = ?`).bind(postId).first();
  // 楼层按主评论发布时间稳定编号，置顶只影响展示顺序。置顶回复带动所属讨论提前。
  const roots = await db.prepare(`WITH ranked_roots AS (
      SELECT *, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS floor
      FROM comments WHERE post_id = ? AND parent_id IS NULL)
    SELECT ${COMMENT_FIELDS},
      (SELECT COUNT(*) FROM comments child WHERE child.parent_id = comments.id AND child.post_id = comments.post_id) AS reply_total,
      CASE WHEN comments.is_pinned = 1 OR EXISTS (SELECT 1 FROM comments child
        WHERE child.parent_id = comments.id AND child.post_id = comments.post_id AND child.is_pinned = 1) THEN 1 ELSE 0 END AS thread_pinned
    FROM ranked_roots comments ${COMMENT_JOINS}
    ${focusRootId ? 'WHERE comments.id = ?' : ''}
    ORDER BY thread_pinned DESC, comments.created_at ASC, comments.id ASC LIMIT ? OFFSET ?`)
    .bind(postId, currentUserId, ...(focusRootId ? [focusRootId] : []), limit, focusRootId ? 0 : offset).all();
  if (focusRootId && !roots.results.length) return json({ error: '讨论不存在' }, { status: 404 });
  let replies = [];
  if (roots.results.length) {
    const rootIds = roots.results.map(root => root.id);
    // D1 每条查询最多 100 个绑定参数，给其他条件保留余量。
    for (let start = 0; start < rootIds.length; start += 90) {
      const ids = rootIds.slice(start, start + 90);
      // 每个讨论首批最多 20 条回复；避免一次返回某个长讨论的全部内容。
      const result = await db.prepare(`WITH ranked_replies AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY parent_id ORDER BY is_pinned DESC, created_at ASC, id ASC) AS reply_position
        FROM comments WHERE post_id = ? AND parent_id IN (${ids.map(() => '?').join(',')}))
      SELECT ${COMMENT_FIELDS} FROM ranked_replies comments ${COMMENT_JOINS}
      WHERE reply_position > ? AND reply_position <= ? ORDER BY parent_id, reply_position`)
        .bind(postId, ...ids, currentUserId, (replyPage - 1) * REPLY_LIMIT, replyPage * REPLY_LIMIT).all();
      replies.push(...result.results);
    }
  }
  for (const root of roots.results) {
    root.reply_page = replyPage;
    root.reply_has_more = root.reply_total > replyPage * REPLY_LIMIT;
  }
  return json({ ...counts, page, limit, focused: Boolean(focusRootId),
    has_more: !focusRootId && offset + roots.results.length < counts.root_total,
    results: [...roots.results, ...replies] });
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  const user = await getUser(context);
  if (!user) return json({ success: false, error: '请先登录' }, { status: 401 });
  if (isBanned(user)) return json({ success: false, error: '账号封禁中' }, { status: 403 });

  const { post_id, content, parent_id } = await readJson(context.request);
  if (!positiveId(post_id) || (parent_id != null && !positiveId(parent_id))) return json({ success: false, error: '参数无效' }, { status: 400 });
  if (typeof content !== 'string' || !content.trim()) return json({ success: false, error: '内容为空' }, { status: 400 });
  if (content.length > 500) return new Response(JSON.stringify({ success: false, error: '评论最多500字' }), { status: 400 });

  const postOwner = await db.prepare('SELECT user_id FROM posts WHERE id = ?').bind(post_id).first();
  if (!postOwner) return new Response(JSON.stringify({ success: false, error: '帖子不存在' }), { status: 404 });

  let finalParentId = null;
  let replyToUid = null;

  if (parent_id) {
    const targetComment = await db.prepare('SELECT id, parent_id, user_id FROM comments WHERE id = ? AND post_id = ?').bind(parent_id, post_id).first();
    if (!targetComment) return new Response(JSON.stringify({ success: false, error: '回复的评论不存在' }), { status: 404 });
    replyToUid = targetComment.user_id;
    if (targetComment.parent_id) {
      const root = await db.prepare('SELECT id FROM comments WHERE id = ? AND post_id = ? AND parent_id IS NULL').bind(targetComment.parent_id, post_id).first();
      if (!root) return json({ success: false, error: '回复的评论不存在' }, { status: 404 });
      finalParentId = root.id;
    }
    else finalParentId = targetComment.id;
  }

  const inserted = await db.prepare('INSERT INTO comments (post_id, user_id, content, parent_id, reply_to_uid, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(post_id, user.id, content, finalParentId, replyToUid, Date.now()).first();

  return json({ success: true, message: '评论成功', id: inserted.id });
}

export async function onRequestPut(context) {
  const db = context.env.DB;
  const user = await getUser(context);
  if (!user) return json({ success: false, error: '请先登录' }, { status: 401 });
  if (isBanned(user)) return json({ success: false, error: '账号封禁中' }, { status: 403 });

  const { id, action, content } = await readJson(context.request);
  if (!positiveId(id)) return json({ success: false, error: '参数无效' }, { status: 400 });

  if (action === 'edit') {
    const comment = await db.prepare('SELECT user_id FROM comments WHERE id = ?').bind(id).first();
    if (!comment) return new Response(JSON.stringify({ success: false, error: '评论不存在' }));
    if (comment.user_id !== user.id && user.role !== 'admin') return new Response(JSON.stringify({ success: false, error: '无权编辑' }), { status: 403 });
    if (typeof content !== 'string' || !content.trim()) return json({ success: false, error: '内容为空' }, { status: 400 });
    if (content.length > 500) return json({ success: false, error: '评论最多500字' }, { status: 400 });
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
    await db.prepare('UPDATE comments SET is_pinned = ? WHERE id = ?').bind(newState, id).run();
    return new Response(JSON.stringify({ success: true, message: newState ? '评论已置顶' : '已取消置顶' }));
  }

  return new Response(JSON.stringify({ success: false, error: '未知操作' }));
}

export async function onRequestDelete(context) {
  const db = context.env.DB;
  const user = await getUser(context);
  if (!user) return json({ success: false, error: '请先登录' }, { status: 401 });
  if (isBanned(user)) return json({ success: false, error: '账号封禁中' }, { status: 403 });

  const url = new URL(context.request.url);
  const commentId = url.searchParams.get('id');
  if (!positiveId(commentId)) return json({ success: false, error: '参数无效' }, { status: 400 });

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
