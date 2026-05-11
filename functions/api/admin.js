export async function onRequestGet(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const user = await db.prepare('SELECT users.role FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
  if (!user || user.role !== 'admin') return new Response(JSON.stringify({ error: '无权限' }), { status: 403 });

  const url = new URL(context.request.url);
  const action = url.searchParams.get('action') || 'stats';

  if (action === 'stats') {
    const now = Date.now();
    const fiveMinAgo = now - 5 * 60 * 1000;
    const dayAgo = now - 24 * 60 * 60 * 1000;

    const totalUsers = await db.prepare('SELECT COUNT(*) as c FROM users').first();
    const onlineUsers = await db.prepare('SELECT COUNT(*) as c FROM users WHERE last_seen > ?').bind(fiveMinAgo).first();
    const todayActive = await db.prepare('SELECT COUNT(*) as c FROM users WHERE last_seen > ?').bind(dayAgo).first();
    const totalPosts = await db.prepare('SELECT COUNT(*) as c FROM posts').first();
    const totalComments = await db.prepare('SELECT COUNT(*) as c FROM comments').first();

    // Turnstile 状态
    const tsSetting = await db.prepare("SELECT value FROM system_settings WHERE key = 'turnstile_enabled'").first();
    const turnstileEnabled = tsSetting ? tsSetting.value === 'true' : true;

    // 在线用户列表
    const onlineList = await db.prepare('SELECT username, nickname, last_seen FROM users WHERE last_seen > ? ORDER BY last_seen DESC LIMIT 20').bind(fiveMinAgo).all();

    return new Response(JSON.stringify({
      stats: {
        totalUsers: totalUsers.c,
        online5min: onlineUsers.c,
        todayActive: todayActive.c,
        totalPosts: totalPosts.c,
        totalComments: totalComments.c,
        turnstileEnabled
      },
      onlineUsers: onlineList.results
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: '未知操作' }), { status: 400 });
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const user = await db.prepare('SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
  if (!user || user.role !== 'admin') return new Response(JSON.stringify({ error: '无权限' }), { status: 403 });

  const body = await context.request.json();
  const { action } = body;

  if (action === 'toggle_turnstile') {
    const current = await db.prepare("SELECT value FROM system_settings WHERE key = 'turnstile_enabled'").first();
    const newValue = current && current.value === 'true' ? 'false' : 'true';
    await db.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('turnstile_enabled', ?)").bind(newValue).run();
    return new Response(JSON.stringify({ success: true, turnstileEnabled: newValue === 'true' }));
  }

  if (action === 'post_announce') {
    const { title, content } = body;
    if (!title || !content) return new Response(JSON.stringify({ success: false, error: '信息不完整' }), { status: 400 });
    await db.prepare('INSERT INTO posts (user_id, author_name, title, content, category, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(user.id, user.nickname || user.username, title, content, '公告', Date.now()).run();
    return new Response(JSON.stringify({ success: true, message: '公告已发布' }));
  }

  return new Response(JSON.stringify({ error: '未知操作' }), { status: 400 });
}
