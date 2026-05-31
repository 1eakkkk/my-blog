function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
}

async function ensureSecurityColumns(db) {
  try { await db.exec('ALTER TABLE users ADD COLUMN login_fails INTEGER DEFAULT 0'); } catch (e) { }
  try { await db.exec('ALTER TABLE users ADD COLUMN login_locked_until INTEGER DEFAULT 0'); } catch (e) { }
}

export async function onRequestGet(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie) return json({ error: '未登录' }, { status: 401 });
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const user = await db.prepare('SELECT users.role FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
  if (!user || user.role !== 'admin') return json({ error: '无权限' }, { status: 403 });

  await ensureSecurityColumns(db);

  const url = new URL(context.request.url);
  const action = url.searchParams.get('action') || 'stats';

  if (action === 'stats') {
    const now = Date.now();
    const fiveMinAgo = now - 5 * 60 * 1000;
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    const totalUsers = await db.prepare('SELECT COUNT(*) as c FROM users').first();
    const onlineUsers = await db.prepare('SELECT COUNT(*) as c FROM users WHERE last_seen > ?').bind(fiveMinAgo).first();
    const todayActive = await db.prepare('SELECT COUNT(*) as c FROM users WHERE last_seen > ?').bind(dayAgo).first();
    const totalPosts = await db.prepare('SELECT COUNT(*) as c FROM posts').first();
    const totalComments = await db.prepare('SELECT COUNT(*) as c FROM comments').first();
    const totalSessions = await db.prepare('SELECT COUNT(*) as c FROM sessions').first();
    const activeSessions = await db.prepare('SELECT COUNT(*) as c FROM sessions WHERE created_at > ?').bind(sevenDaysAgo).first();
    const lockedUsers = await db.prepare('SELECT COUNT(*) as c FROM users WHERE login_locked_until > ?').bind(now).first();
    const usersWithFails = await db.prepare('SELECT COUNT(*) as c FROM users WHERE login_fails > 0').first();
    const loginFailSum = await db.prepare('SELECT COALESCE(SUM(login_fails), 0) as c FROM users WHERE login_fails > 0').first();

    const tsSetting = await db.prepare("SELECT value FROM system_settings WHERE key = 'turnstile_enabled'").first();
    const turnstileEnabled = tsSetting ? tsSetting.value === 'true' : true;

    const onlineList = await db.prepare('SELECT id, username, nickname, last_seen FROM users WHERE last_seen > ? ORDER BY last_seen DESC LIMIT 20').bind(fiveMinAgo).all();
    const latestComments = await db.prepare(`
      SELECT comments.id, comments.post_id, comments.content, comments.created_at,
             users.username, users.nickname, posts.title as post_title
      FROM comments
      JOIN users ON comments.user_id = users.id
      LEFT JOIN posts ON comments.post_id = posts.id
      ORDER BY comments.created_at DESC
      LIMIT 5
    `).all();

    return json({
      stats: {
        totalUsers: totalUsers.c, online5min: onlineUsers.c, todayActive: todayActive.c,
        totalPosts: totalPosts.c, totalComments: totalComments.c, turnstileEnabled,
        totalSessions: totalSessions.c, activeSessions: activeSessions.c,
        lockedUsers: lockedUsers.c, usersWithFails: usersWithFails.c,
        loginFailSum: loginFailSum.c
      },
      onlineUsers: onlineList.results,
      latestComments: latestComments.results
    });
  }

  // 详情查询
  if (action === 'user_list') {
    const users = await db.prepare('SELECT id, username, nickname, created_at, last_seen FROM users ORDER BY created_at DESC LIMIT 20').all();
    return json({ users: users.results });
  }
  if (action === 'post_list') {
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const limit = 20;
    const posts = await db.prepare('SELECT id, title, category, created_at, author_name FROM posts ORDER BY created_at DESC LIMIT ? OFFSET ?').bind(limit + 1, offset).all();
    const results = posts.results;
    const hasMore = results.length > limit;
    return json({ posts: hasMore ? results.slice(0, limit) : results, hasMore });
  }
  if (action === 'comment_list') {
    const comments = await db.prepare(`
      SELECT comments.id, comments.post_id, comments.content, comments.created_at,
             users.username, users.nickname, posts.title as post_title
      FROM comments
      JOIN users ON comments.user_id = users.id
      LEFT JOIN posts ON comments.post_id = posts.id
      ORDER BY comments.created_at DESC
      LIMIT 30
    `).all();
    return json({ comments: comments.results });
  }
  if (action === 'security_list') {
    const now = Date.now();
    const users = await db.prepare(`
      SELECT id, username, nickname, login_fails, login_locked_until, last_seen
      FROM users
      WHERE login_fails > 0 OR login_locked_until > ?
      ORDER BY login_locked_until DESC, login_fails DESC, last_seen DESC
      LIMIT 30
    `).bind(now).all();
    return json({ users: users.results, now });
  }
  if (action === 'online_list') {
    const online = await db.prepare('SELECT id, username, nickname, last_seen FROM users WHERE last_seen > ? ORDER BY last_seen DESC').bind(Date.now() - 5 * 60 * 1000).all();
    return json({ users: online.results });
  }

  return json({ error: '未知操作' }, { status: 400 });
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie) return json({ error: '未登录' }, { status: 401 });
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const user = await db.prepare('SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
  if (!user || user.role !== 'admin') return json({ error: '无权限' }, { status: 403 });

  await ensureSecurityColumns(db);

  const body = await context.request.json();
  const { action } = body;

  if (action === 'toggle_turnstile') {
    const current = await db.prepare("SELECT value FROM system_settings WHERE key = 'turnstile_enabled'").first();
    const currentValue = current ? current.value : 'true';
    const newValue = currentValue === 'true' ? 'false' : 'true';
    await db.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('turnstile_enabled', ?)").bind(newValue).run();
    return json({ success: true, turnstileEnabled: newValue === 'true' });
  }

  if (action === 'cleanup_sessions') {
    const expireTime = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const result = await db.prepare('DELETE FROM sessions WHERE created_at < ?').bind(expireTime).run();
    return json({ success: true, deleted: result.meta?.changes || 0 });
  }

  if (action === 'post_announce') {
    const { title, content } = body;
    if (!title || !content) return json({ success: false, error: '信息不完整' }, { status: 400 });
    await db.prepare('INSERT INTO posts (user_id, author_name, title, content, category, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(user.id, user.nickname || user.username, title, content, '公告', Date.now()).run();
    return json({ success: true, message: '公告已发布' });
  }

  return json({ error: '未知操作' }, { status: 400 });
}
