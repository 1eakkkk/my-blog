// --- functions/api/block.js ---
export async function onRequestPost(context) {
  const db = context.env.DB;
  // ... (鉴权代码同上，为节省篇幅省略，请务必加上 user 校验) ...
  const cookie = context.request.headers.get('Cookie');
  const sessionId = cookie?.match(/session_id=([^;]+)/)?.[1];
  if (!sessionId) return new Response(JSON.stringify({error:'Login'}),{status:401});
  const me = await db.prepare('SELECT id FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
  if(!me) return new Response(JSON.stringify({error:'Invalid'}),{status:401});

  const { action, target_id } = await context.request.json();

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
      return new Response(JSON.stringify({ success: true, message: '已取消拉黑' }));
  }
}
