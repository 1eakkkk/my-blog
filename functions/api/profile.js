export async function onRequestPost(context) {
  const db = context.env.DB;
  const { nickname } = await context.request.json();

  if (!nickname || nickname.length > 12) return new Response(JSON.stringify({ success: false, error: '昵称无效' }), { status: 400 });

  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: false, error: '请先登录' }), { status: 401 });
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

  // === 计费逻辑 ===
  const count = user.nickname_change_count || 0;
  let cost = 0;
  if (count === 0) cost = 0;
  else if (count === 1) cost = 10;
  else cost = 50;

  if (user.coins < cost) {
      return new Response(JSON.stringify({ success: false, error: `余额不足，第${count+1}次改名需要 ${cost} i币` }), { status: 400 });
  }

  await db.batch([
      db.prepare('UPDATE users SET nickname = ?, nickname_change_count = nickname_change_count + 1, coins = coins - ? WHERE id = ?')
        .bind(nickname, cost, user.id)
  ]);

  return new Response(JSON.stringify({ success: true, message: `修改成功，扣除 ${cost} i币`, nickname }), { headers: { 'Content-Type': 'application/json' } });
}
