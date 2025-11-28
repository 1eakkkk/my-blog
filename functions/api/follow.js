// --- functions/api/follow.js ---
export async function onRequestPost(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ error: '请先登录' }), { status: 401 });
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const me = await db.prepare('SELECT id, username, nickname FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
  if (!me) return new Response(JSON.stringify({ error: '无效会话' }), { status: 401 });

  const { target_id } = await context.request.json();
  if (me.id === target_id) return new Response(JSON.stringify({ error: '不能关注自己' }), { status: 400 });

  // 检查是否已关注
  const existing = await db.prepare('SELECT * FROM follows WHERE follower_id = ? AND following_id = ?').bind(me.id, target_id).first();

  if (existing) {
      // 取关
      await db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').bind(me.id, target_id).run();
      return new Response(JSON.stringify({ success: true, status: 'unfollowed', message: '已取消关注' }));
  } else {
      // 关注
      await db.prepare('INSERT INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)').bind(me.id, target_id, Date.now()).run();
      
      // 发通知
      const msg = `${me.nickname || me.username} 关注了你！`;
      await db.prepare('INSERT INTO notifications (user_id, type, message, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(target_id, 'system', msg, `#profile?u=${me.username}`, Date.now()).run();

      return new Response(JSON.stringify({ success: true, status: 'followed', message: '关注成功' }));
  }
}
