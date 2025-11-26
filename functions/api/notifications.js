// --- functions/api/notifications.js ---
export async function onRequestGet(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie) return new Response(JSON.stringify({ count: 0, list: [] }));
  
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  if (!sessionId) return new Response(JSON.stringify({ count: 0, list: [] }));

  const user = await db.prepare(`SELECT users.id FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ count: 0, list: [] }));

  // 获取未读消息数量
  const countResult = await db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0').bind(user.id).first();
  
  // 获取消息列表 (最近20条)
  const listResult = await db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').bind(user.id).all();

  return new Response(JSON.stringify({ count: countResult.count, list: listResult.results }), { headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const user = await db.prepare(`SELECT users.id FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  
  if (user) {
    // 读取请求体，查看是否有特定的 ID
    let body = {};
    try { body = await context.request.json(); } catch(e) {}

    if (body.id) {
        // 标记单条已读
        await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').bind(body.id, user.id).run();
    } else {
        // 标记全部已读
        await db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').bind(user.id).run();
    }
  }
  return new Response(JSON.stringify({ success: true }));
}
