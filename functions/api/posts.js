import { json, getUser, readJson, isBanned } from './_lib.js';
import { recycleContent } from './_recycle.js';
import { literalSearch, addSearchMatches } from './_search.js';

const CATEGORIES = ['灌水', '技术', '生活', '提问', '公告'];
const validId = value => ['string', 'number'].includes(typeof value) && /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));
function pagination(value, fallback, max) {
  if (value === null) return fallback;
  return validId(value) && Number(value) <= max ? Number(value) : null;
}
function postInputError({ title, content, mood }) {
  if ((title !== undefined && title !== null && typeof title !== 'string') ||
      (content !== undefined && content !== null && typeof content !== 'string') ||
      (mood !== undefined && mood !== null && typeof mood !== 'string')) return '标题、内容和心情必须是文字';
  if (title && title.length > 100) return '标题最多100字';
  if (content && content.length > 50000) return '内容过长，最多50000字';
  if (mood && mood.length > 24) return '心情最多24字';
  if ((!title || !title.trim()) && (!content || !content.trim())) return '标题和内容不能同时为空';
  return '';
}

export async function onRequestGet(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');

  const now = Date.now();
  const sort = url.searchParams.get('sort') || 'latest';
  const search = url.searchParams.get('search') || '';
  const category = url.searchParams.get('category') || '';
  const page = pagination(url.searchParams.get('page'), 1, 100000);
  const limit = pagination(url.searchParams.get('limit'), 10, 100);
  const offset = (page - 1) * limit;
  const userId = url.searchParams.get('user_id');
  const date = url.searchParams.get('date');
  if ((id !== null && !validId(id)) || (userId !== null && !validId(userId))) return json({ error: '编号参数无效' }, { status: 400 });
  if (page === null || limit === null || search.length > 200 || (category && !CATEGORIES.includes(category)) ||
      !['latest', 'hot', 'comments'].includes(sort)) return json({ error: '筛选参数无效' }, { status: 400 });
  let dayStart;
  if (date !== null) {
    dayStart = Date.parse(`${date}T00:00:00+08:00`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(dayStart) ||
        new Date(dayStart + 8 * 3600000).toISOString().slice(0, 10) !== date) {
      return json({ error: '日期参数无效' }, { status: 400 });
    }
  }

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
    (SELECT COUNT(*) FROM active_comments WHERE post_id = posts.id) as comment_count
  `;

  try {
    // 日期统计和帖子列表共用搜索/分类/作者条件，当前日期只限制列表。
    const conditions = [];
    const filterParams = [];
    if (userId) { conditions.push('posts.user_id = ?'); filterParams.push(userId); }
    if (search) {
      const term = literalSearch(search);
      conditions.push("(posts.title LIKE ? ESCAPE '\\' OR posts.content LIKE ? ESCAPE '\\' OR posts.category LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM active_comments comments WHERE comments.post_id = posts.id AND comments.content LIKE ? ESCAPE '\\'))");
      filterParams.push(term, term, term, term);
    }
    if (category) { conditions.push('posts.category = ?'); filterParams.push(category); }
    if (url.searchParams.get('archive') === '1') {
      const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
      const days = await db.prepare(`SELECT strftime('%Y-%m-%d', posts.created_at / 1000, 'unixepoch', '+8 hours') AS date,
        COUNT(*) AS count FROM active_posts posts${where} GROUP BY date ORDER BY date DESC`).bind(...filterParams).all();
      return json({ days: days.results, time_zone: 'UTC+8' });
    }
    if (id) {
      const post = await db.prepare(`SELECT ${fields} FROM active_posts posts JOIN users ON posts.user_id = users.id WHERE posts.id = ?`).bind(now, currentUserId || 0, id).first();
      return json(post);
    } else {
      let sql = `SELECT ${fields} FROM active_posts posts JOIN users ON posts.user_id = users.id`;
      const params = [now, currentUserId || 0, ...filterParams];
      if (date !== null) {
        conditions.push('posts.created_at >= ? AND posts.created_at < ?');
        params.push(dayStart, dayStart + 86400000);
      }
      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      sql += userId ? ' ORDER BY' : ` ORDER BY (posts.category = '公告') DESC, posts.is_pinned DESC,`;

      if (sort === 'hot') {
        sql += ` posts.like_count DESC, posts.created_at DESC, posts.id DESC`;
      } else if (sort === 'comments') {
        sql += ` comment_count DESC, posts.created_at DESC, posts.id DESC`;
      } else {
        sql += ` posts.created_at DESC, posts.id DESC`;
      }

      sql += ` LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const posts = await db.prepare(sql).bind(...params).all();
      await addSearchMatches(db, posts.results, search);

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

      return json(posts.results);
    }
  } catch (e) {
    console.error('Posts query failed:', e);
    return json({ error: '帖子加载失败，请稍后重试' }, { status: 500 });
  }
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  const user = await getUser(context);
  if (!user) return json({ success: false, error: '请先登录' }, { status: 401 });
  if (isBanned(user)) return json({ success: false, error: '账号封禁' }, { status: 403 });

  const payload = await readJson(context.request);
  let { title, content, category, mood } = payload;
  const inputError = postInputError(payload);
  if (inputError) return json({ success: false, error: inputError }, { status: 400 });

  if (!title || !title.trim()) title = "无题 / Untitled";
  if (!content || !content.trim()) content = "（如题）";

  let finalCategory = CATEGORIES.includes(category) ? category : '灌水';
  if (finalCategory === '公告' && user.role !== 'admin') return new Response(JSON.stringify({ success: false, error: '权限不足' }), { status: 403 });

  const inserted = await db.prepare('INSERT INTO posts (user_id, author_name, title, content, category, mood, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(user.id, user.nickname || user.username, title, content, finalCategory, mood || null, Date.now()).run();

  return json({ success: true, message: '发布成功！', id: Number.isSafeInteger(Number(inserted.meta?.last_row_id)) && Number(inserted.meta.last_row_id) > 0 ? Number(inserted.meta.last_row_id) : undefined });
}

export async function onRequestPut(context) {
  const db = context.env.DB;
  const user = await getUser(context);
  if (!user) return json({ success: false, error: '请先登录' }, { status: 401 });
  if (isBanned(user)) return json({ success: false, error: '账号封禁' }, { status: 403 });
  const payload = await readJson(context.request);
  let { id, action, title, content, category, mood } = payload;
  if (!validId(id)) return json({ success: false, error: '帖子编号无效' }, { status: 400 });

  if (action === 'edit') {
    const inputError = postInputError(payload);
    if (inputError) return json({ success: false, error: inputError }, { status: 400 });
    const post = await db.prepare('SELECT user_id FROM active_posts WHERE id = ?').bind(id).first();
    if (!post) return new Response(JSON.stringify({ success: false, error: '帖子不存在' }));
    if (post.user_id !== user.id && user.role !== 'admin') return new Response(JSON.stringify({ success: false, error: '无权编辑' }), { status: 403 });
    if (category === '公告' && user.role !== 'admin') return new Response(JSON.stringify({ success: false, error: '无权' }), { status: 403 });
    category = CATEGORIES.includes(category) ? category : '灌水';
    if (!title || !title.trim()) title = "无题 / Untitled";
    if (!content || !content.trim()) content = "（如题）";

    const changed = await db.prepare('UPDATE posts SET title = ?, content = ?, category = ?, mood = ?, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM active_posts visible WHERE visible.id=posts.id)')
      .bind(title, content, category, mood || null, Date.now(), id).run();
    if (!changed.meta.changes) return json({ success: false, error: '帖子已移入回收站或不存在' }, { status: 404 });
    return new Response(JSON.stringify({ success: true, message: '文章已更新' }));
  }

  if (action === 'pin') {
    const post = await db.prepare('SELECT user_id, is_pinned FROM active_posts WHERE id = ?').bind(id).first();
    if (!post) return new Response(JSON.stringify({ success: false, error: '帖子不存在' }));
    if (user.role !== 'admin') return new Response(JSON.stringify({ success: false, error: '仅管理员可置顶' }), { status: 403 });
    const newState = post.is_pinned ? 0 : 1;
    const changed = await db.prepare('UPDATE posts SET is_pinned = ?, pinned_until = 0 WHERE id = ? AND EXISTS (SELECT 1 FROM active_posts visible WHERE visible.id=posts.id)').bind(newState, id).run();
    if (!changed.meta.changes) return json({ success: false, error: '帖子已移入回收站或不存在' }, { status: 404 });
    return new Response(JSON.stringify({ success: true, message: newState ? '已置顶' : '已取消置顶', is_pinned: newState }));
  }

  return new Response(JSON.stringify({ success: false, error: '未知操作' }));
}

export async function onRequestDelete(context) {
  const db = context.env.DB;
  const user = await getUser(context);
  if (!user) return json({ success: false, error: '请先登录' }, { status: 401 });
  if (isBanned(user)) return json({ success: false, error: '账号封禁' }, { status: 403 });
  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');
  if (!validId(id)) return json({ success: false, error: '帖子编号无效' }, { status: 400 });
  return recycleContent(db, user, 'post', id);
}
