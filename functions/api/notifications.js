// --- functions/api/notifications.js ---
export async function onRequestGet(context) {
  // ... (保留原有的 GET 逻辑)
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie) return new Response(JSON.stringify({ count: 0, list: [] }));
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  if (!sessionId) return new Response(JSON.stringify({ count: 0, list: [] }));
  const user = await db.prepare(`SELECT users.id FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ count: 0, list: [] }));
  const countResult = await db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0').bind(user.id).first();
  const listResult = await db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').bind(user.id).all();
  return new Response(JSON.stringify({ count: countResult.count, list: listResult.results }), { headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost(context) {
  // ... (保留原有的 POST 标记已读逻辑)
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const user = await db.prepare(`SELECT users.id FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (user) {
    let body = {};
    try { body = await context.request.json(); } catch(e) {}
    if (body.id) {
        await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').bind(body.id, user.id).run();
    } else {
        await db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').bind(user.id).run();
    }
  }
  return new Response(JSON.stringify({ success: true }));
}

// === 新增：DELETE 用于删除通知 ===
export async function onRequestDelete(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const user = await db.prepare(`SELECT users.id FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  
  if (!user) return new Response(JSON.stringify({ success: false, error: 'Login' }), { status: 401 });

  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');
  const all = url.searchParams.get('all');

  if (all === 'true') {
      // 一键清空
      await db.prepare('DELETE FROM notifications WHERE user_id = ?').bind(user.id).run();
      return new Response(JSON.stringify({ success: true, message: 'All Cleared' }));
  } else if (id) {
      // 删除单条
      await db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').bind(id, user.id).run();
      return new Response(JSON.stringify({ success: true, message: 'Deleted' }));
  }

  return new Response(JSON.stringify({ success: false }));
}
