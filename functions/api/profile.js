// --- functions/api/profile.js ---
export async function onRequestPost(context) {
  const db = context.env.DB;
  const reqBody = await context.request.json();
  const { nickname, badge_preference } = reqBody;

  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: false, error: '请先登录' }), { status: 401 });
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

  // === 修改昵称逻辑 ===
  if (nickname !== undefined) {
      if (!nickname || nickname.length > 12) return new Response(JSON.stringify({ success: false, error: '昵称无效' }), { status: 400 });
      
      const count = user.nickname_change_count || 0;
      let cost = 0;
      if (count === 1) cost = 10;
      else if (count > 1) cost = 50;

      if (user.coins < cost) {
          return new Response(JSON.stringify({ success: false, error: `余额不足，本次改名需要 ${cost} i币` }), { status: 400 });
      }

      await db.batch([
          db.prepare('UPDATE users SET nickname = ?, nickname_change_count = nickname_change_count + 1, coins = coins - ? WHERE id = ?')
            .bind(nickname, cost, user.id)
      ]);
      return new Response(JSON.stringify({ success: true, message: `修改成功，扣除 ${cost} i币` }));
  }

  // === 修改头衔佩戴偏好逻辑 (新增) ===
  if (badge_preference !== undefined) {
      if (badge_preference !== 'number' && badge_preference !== 'title') {
          return new Response(JSON.stringify({ success: false, error: '参数错误' }), { status: 400 });
      }
      await db.prepare('UPDATE users SET badge_preference = ? WHERE id = ?').bind(badge_preference, user.id).run();
      return new Response(JSON.stringify({ success: true, message: '佩戴偏好已保存' }));
  }

  return new Response(JSON.stringify({ success: false, error: '无操作' }));
}
