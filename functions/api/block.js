// --- functions/api/block.js ---
export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;
  
  // 鉴权
  const cookie = request.headers.get('Cookie');
  const sessionId = cookie?.match(/session_id=([^;]+)/)?.[1];
  if (!sessionId) return new Response(JSON.stringify({error:'Login'}),{status:401});
  const me = await db.prepare('SELECT id FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
  if(!me) return new Response(JSON.stringify({error:'Invalid'}),{status:401});

  // === GET: 获取我的黑名单列表 ===
  if (request.method === 'GET') {
      const list = await db.prepare(`
          SELECT u.id, u.username, u.nickname, u.avatar_variant, u.avatar_url, b.created_at
          FROM blocks b
          JOIN users u ON b.blocked_id = u.id
          WHERE b.blocker_id = ?
          ORDER BY b.created_at DESC
      `).bind(me.id).all();
      
      return new Response(JSON.stringify({ success: true, list: list.results }));
  }

  // === POST: 拉黑/解除 ===
  if (request.method === 'POST') {
      const { action, target_id } = await request.json();

      if (action === 'block') {
          await db.batch([
              // 加入黑名单
              db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').bind(me.id, target_id, Date.now()),
              // 自动解除好友关系
              db.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').bind(me.id, target_id, target_id, me.id)
          ]);
          return new Response(JSON.stringify({ success: true, message: '已拉黑' }));
      }

      if (action === 'unblock') {
          await db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').bind(me.id, target_id).run();
          return new Response(JSON.stringify({ success: true, message: '已解除拉黑' }));
      }
  }
  
  return new Response(JSON.stringify({ error: 'Method not allowed' }));
}
