// --- functions/api/random_avatar.js ---
export async function onRequestPost(context) {
  const db = context.env.DB;
  
  // 鉴权
  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: false, error: '请先登录' }), { status: 401 });
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare(`SELECT users.id FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

  // 生成一个随机数作为新变数
  const newVariant = Math.floor(Math.random() * 100000);

  // 更新数据库
  await db.prepare('UPDATE users SET avatar_variant = ? WHERE id = ?')
    .bind(newVariant, user.id)
    .run();

  return new Response(JSON.stringify({ success: true, message: '头像基因重组完成', variant: newVariant }), { headers: { 'Content-Type': 'application/json' } });
}
