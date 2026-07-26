import { json, getUser } from './_lib.js';

const CATEGORIES = ['灌水', '技术', '生活', '提问', '公告'];

export async function onRequestGet(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');

  const now = Date.now();
  const sort = url.searchParams.get('sort') || 'latest';
  const search = url.searchParams.get('search') || '';
  const category = url.searchParams.get('category') || '';
  const page = parseInt(url.searchParams.get('page')) || 1;
  const limit = parseInt(url.searchParams.get('limit')) || 10;
  const offset = (page - 1) * limit;

  const viewer = await getUser(context);
  const currentUserId = viewer ? viewer.id : null;

  const fields = `
    posts.*,
    (posts.is_pinned = 1 AND (posts.pinned_until IS NULL OR posts.pinned_until <= 0 OR posts.pinned_until > ?)) as is_pinned,
    users.username as author_username,
    users.nickname as author_nickname,
    users.avatar_variant as author_avatar_variant,
    users.avatar_url as author_avatar_url,
    users.role as author_role,
    (SELECT COUNT(*) FROM likes WHERE target_id = posts.id AND target_type = 'post' AND user_id = ?) as is_liked,
    (SELECT COUNT(*) FROM comments WHERE post_id = posts.id) as comment_count
  `;

  try {
    if (id) {
      const post = await db.prepare(`SELECT ${fields} FROM posts JOIN users ON posts.user_id = users.id WHERE posts.id = ?`).bind(now, currentUserId || 0, id).first();
      return new Response(JSON.stringify(post), { headers: { 'Content-Type': 'application/json' } });
    } else {
      let sql = `SELECT ${fields} FROM posts JOIN users ON posts.user_id = users.id`;
      const params = [now, currentUserId || 0];
      const conditions = [];

      if (search) {
        const term = `%${search}%`;
        conditions.push(`(posts.title LIKE ? OR posts.content LIKE ? OR posts.category LIKE ? OR EXISTS (SELECT 1 FROM comments WHERE comments.post_id = posts.id AND comments.content LIKE ?))`);
        params.push(term, term, term, term);
      }
      if (category) {
        conditions.push('posts.category = ?');
        params.push(category);
      }
      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
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

      // 列表模式不传全文：缩略图、纯文本字数在服务端算好，正文只保留摘要所需的前 600 字符
      const IMG_RE = /!\[.*?\]\((https?:\/\/[^)]+)\)/g;
      for (const p of posts.results) {
        const full = p.content || '';
        const thumbs = [];
        let m;
        IMG_RE.lastIndex = 0;
        while ((m = IMG_RE.exec(full)) !== null && thumbs.length < 3) thumbs.push(m[1]);
        p.thumb_urls = thumbs;
        p.content_length = full.replace(/<[^>]*>/g, '').replace(/\s+/g, '').length; // 与前端阅读时间估算口径一致
        p.content = full.slice(0, 600);
      }

      return new Response(JSON.stringify(posts.results), { headers: { 'Content-Type': 'application/json' } });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  const user = await getUser(context);
  if (!user) return json({ success: false, error: '请先登录' }, { status: 401 });
  if (user.status === 'banned') return json({ success: false, error: '账号封禁' }, { status: 403 });

  let { title, content, category, mood } = await context.request.json();

  if (title && title.length > 100) return json({ success: false, error: '标题最多100字' }, { status: 400 });
  if (content && content.length > 50000) return new Response(JSON.stringify({ success: false, error: '内容过长，最多50000字' }), { status: 400 });
  if ((!title || !title.trim()) && (!content || !content.trim())) {
    return new Response(JSON.stringify({ success: false, error: '标题和内容不能同时为空' }), { status: 400 });
  }

  if (!title || !title.trim()) title = "无题 / Untitled";
  if (!content || !content.trim()) content = "（如题）";

  let finalCategory = CATEGORIES.includes(category) ? category : '灌水';
  if (finalCategory === '公告' && user.role !== 'admin') return new Response(JSON.stringify({ success: false, error: '权限不足' }), { status: 403 });

  await db.prepare('INSERT INTO posts (user_id, author_name, title, content, category, mood, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(user.id, user.nickname || user.username, title, content, finalCategory, mood || null, Date.now()).run();

  return new Response(JSON.stringify({ success: true, message: '发布成功！' }));
}

export async function onRequestPut(context) {
  const db = context.env.DB;
  const user = await getUser(context);
  if (!user) return json({ success: false, error: '请先登录' }, { status: 401 });

  let { id, action, title, content, category, mood } = await context.request.json();

  if (action === 'edit') {
    const post = await db.prepare('SELECT user_id FROM posts WHERE id = ?').bind(id).first();
    if (!post) return new Response(JSON.stringify({ success: false, error: '帖子不存在' }));
    if (post.user_id !== user.id && user.role !== 'admin') return new Response(JSON.stringify({ success: false, error: '无权编辑' }), { status: 403 });
    if (category === '公告' && user.role !== 'admin') return new Response(JSON.stringify({ success: false, error: '无权' }), { status: 403 });
    if (title && title.length > 100) return json({ success: false, error: '标题最多100字' }, { status: 400 });
    category = CATEGORIES.includes(category) ? category : '灌水';

    if (content && content.length > 50000) return new Response(JSON.stringify({ success: false, error: '内容过长，最多50000字' }), { status: 400 });
    if ((!title || !title.trim()) && (!content || !content.trim())) {
      return new Response(JSON.stringify({ success: false, error: '不能全为空' }), { status: 400 });
    }
    if (!title || !title.trim()) title = "无题 / Untitled";
    if (!content || !content.trim()) content = "（如题）";

    await db.prepare('UPDATE posts SET title = ?, content = ?, category = ?, mood = ?, updated_at = ? WHERE id = ?')
      .bind(title, content, category, mood || null, Date.now(), id).run();
    return new Response(JSON.stringify({ success: true, message: '文章已更新' }));
  }

  if (action === 'pin') {
    const post = await db.prepare('SELECT user_id, is_pinned FROM posts WHERE id = ?').bind(id).first();
    if (!post) return new Response(JSON.stringify({ success: false, error: '帖子不存在' }));
    if (user.role !== 'admin') return new Response(JSON.stringify({ success: false, error: '仅管理员可置顶' }), { status: 403 });
    const newState = post.is_pinned ? 0 : 1;
    await db.prepare('UPDATE posts SET is_pinned = ?, pinned_until = 0 WHERE id = ?').bind(newState, id).run();
    return new Response(JSON.stringify({ success: true, message: newState ? '已置顶' : '已取消置顶', is_pinned: newState }));
  }

  return new Response(JSON.stringify({ success: false, error: '未知操作' }));
}

export async function onRequestDelete(context) {
  const db = context.env.DB;
  const user = await getUser(context);
  if (!user) return json({ success: false, error: '请先登录' }, { status: 401 });
  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');
  let result;
  if (user.role === 'admin') result = await db.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
  else result = await db.prepare('DELETE FROM posts WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  if (result.meta.changes > 0) return new Response(JSON.stringify({ success: true, message: '删除成功' }));
  else return new Response(JSON.stringify({ success: false, error: '无法删除' }), { status: 403 });
}
