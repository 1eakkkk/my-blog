// --- functions/api/friends.js ---
export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;

  // 鉴权
  const cookie = request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ error: 'Login' }), { status: 401 });
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const me = await db.prepare('SELECT id, username FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
  if (!me) return new Response(JSON.stringify({ error: 'Invalid' }), { status: 401 });

  // GET: 获取好友列表 & 申请列表
  if (request.method === 'GET') {
      // 查好友 (status=1)
      const friends = await db.prepare(`
          SELECT u.id, u.username, u.nickname, u.avatar_variant, u.avatar_url 
          FROM friends f JOIN users u ON f.friend_id = u.id 
          WHERE f.user_id = ? AND f.status = 1
          UNION 
          SELECT u.id, u.username, u.nickname, u.avatar_variant, u.avatar_url 
          FROM friends f JOIN users u ON f.user_id = u.id 
          WHERE f.friend_id = ? AND f.status = 1
      `).bind(me.id, me.id).all();

      // 查待处理申请 (别人加我，且我没同意)
      const requests = await db.prepare(`
          SELECT u.id, u.username, u.nickname, u.avatar_variant, u.avatar_url, f.created_at
          FROM friends f JOIN users u ON f.user_id = u.id
          WHERE f.friend_id = ? AND f.status = 0
      `).bind(me.id).all();

      return new Response(JSON.stringify({ success: true, friends: friends.results, requests: requests.results }));
  }

  // POST: 添加/接受/删除
  if (request.method === 'POST') {
      const { action, target_id } = await request.json();
      
      if (action === 'add') {
          // 检查是否被对方屏蔽
          const blocked = await db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').bind(target_id, me.id).first();
          if (blocked) return new Response(JSON.stringify({ success: false, error: '对方拒绝了你的请求' }));
          
          const existing = await db.prepare('SELECT status FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').bind(me.id, target_id, target_id, me.id).first();
          
          if (existing) {
              if (existing.status === 1) return new Response(JSON.stringify({ success: false, error: '你们已经是好友了' }));
              return new Response(JSON.stringify({ success: false, error: '请求已发送，请勿重复操作' }));
          }

          // 插入申请
          await db.prepare('INSERT INTO friends (user_id, friend_id, status, created_at) VALUES (?, ?, 0, ?)').bind(me.id, target_id, Date.now()).run();
          
          // 发通知 (修改链接为 #chat，确保点击跳转正确)
          await db.prepare('INSERT INTO notifications (user_id, type, message, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(target_id, 'system', `${me.username} 请求添加好友`, '#chat', Date.now()).run();
          
          return new Response(JSON.stringify({ success: true, message: '已发送好友申请' }));
      }
          
      if (action === 'accept') {
          await db.prepare('UPDATE friends SET status = 1 WHERE user_id = ? AND friend_id = ?').bind(target_id, me.id).run();
          return new Response(JSON.stringify({ success: true, message: '已同意' }));
      }

      if (action === 'delete') {
          await db.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').bind(me.id, target_id, target_id, me.id).run();
          return new Response(JSON.stringify({ success: true, message: '已删除好友' }));
      }
  }
  return new Response(JSON.stringify({ error: 'Method error' }));
}
