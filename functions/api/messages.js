// --- functions/api/messages.js ---
export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;
  // ... (鉴权代码同上，务必加上) ...
  const cookie = request.headers.get('Cookie');
  const sessionId = cookie?.match(/session_id=([^;]+)/)?.[1];
  const me = await db.prepare('SELECT id, username FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
  if(!me) return new Response(JSON.stringify({error:'Login'}),{status:401});

  // GET: 获取对话列表 或 具体消息
  if (request.method === 'GET') {
      const url = new URL(request.url);
      const targetId = url.searchParams.get('target_id');

      if (targetId) {
          // 获取与某人的详细聊天记录
          // 同时标记已读
          await db.prepare('UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?').bind(targetId, me.id).run();
          
          const msgs = await db.prepare(`
              SELECT * FROM messages 
              WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
              ORDER BY created_at ASC LIMIT 50
          `).bind(me.id, targetId, targetId, me.id).all();
          return new Response(JSON.stringify({ success: true, list: msgs.results }));
      } else {
          // 获取最近对话列表 (比较复杂的SQL，找最近联系人)
          // 这里简化：查所有发过消息或收过消息的人，并去重
          const conversations = await db.prepare(`
             SELECT 
                DISTINCT CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END as uid,
                MAX(created_at) as last_time,
                (SELECT nickname FROM users WHERE id = (CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END)) as nickname,
                (SELECT username FROM users WHERE id = (CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END)) as username,
                (SELECT avatar_url FROM users WHERE id = (CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END)) as avatar_url,
                (SELECT avatar_variant FROM users WHERE id = (CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END)) as avatar_variant
             FROM messages 
             WHERE sender_id = ? OR receiver_id = ?
             GROUP BY uid
             ORDER BY last_time DESC
          `).bind(me.id, me.id, me.id, me.id, me.id, me.id, me.id).all();
          
          return new Response(JSON.stringify({ success: true, list: conversations.results }));
      }
  }

  // POST: 发送消息
  if (request.method === 'POST') {
      const { target_id, content } = await context.request.json();
      if(!content) return new Response(JSON.stringify({error:'空消息'}));

      // 检查黑名单
      const blocked = await db.prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)').bind(target_id, me.id, me.id, target_id).first();
      if (blocked) return new Response(JSON.stringify({ success: false, error: '消息无法发送（黑名单限制）' }));

      await db.prepare('INSERT INTO messages (sender_id, receiver_id, content, created_at) VALUES (?, ?, ?, ?)').bind(me.id, target_id, content, Date.now()).run();
      return new Response(JSON.stringify({ success: true }));
  }
}
