export async function onRequestPost(context) {
  const db = context.env.DB;
  const reqBody = await context.request.json();
  const { nickname, badge_preference, bio, avatar_url } = reqBody;

  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: false, error: '请先登录' }), { status: 401 });
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

  if (nickname !== undefined) {
    if (!nickname || nickname.length > 12) return new Response(JSON.stringify({ success: false, error: '昵称无效' }), { status: 400 });
    await db.prepare('UPDATE users SET nickname = ? WHERE id = ?').bind(nickname, user.id).run();
    return new Response(JSON.stringify({ success: true, message: '昵称已更新' }));
  }

  if (avatar_url !== undefined) {
    await db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(avatar_url, user.id).run();
    return new Response(JSON.stringify({ success: true, message: '头像已更新' }));
  }

  if (badge_preference !== undefined) {
    await db.prepare('UPDATE users SET badge_preference = ? WHERE id = ?').bind(badge_preference, user.id).run();
    return new Response(JSON.stringify({ success: true, message: '偏好已保存' }));
  }

  if (bio !== undefined) {
    if (bio.length > 50) return new Response(JSON.stringify({ success: false, error: '签名太长了 (限50字)' }), { status: 400 });
    await db.prepare('UPDATE users SET bio = ? WHERE id = ?').bind(bio, user.id).run();
    return new Response(JSON.stringify({ success: true, message: '签名已更新' }));
  }

  return new Response(JSON.stringify({ success: false, error: '无操作' }));
}
