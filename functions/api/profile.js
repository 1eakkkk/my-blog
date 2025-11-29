// --- functions/api/profile.js ---
export async function onRequestPost(context) {
  const db = context.env.DB;
  const reqBody = await context.request.json();
  // === 新增 bio ===
  const { nickname, badge_preference, bio } = reqBody; 

  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: false, error: '请先登录' }), { status: 401 });
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

  // 1. 修改昵称
  if (nickname !== undefined) {
      if (!nickname || nickname.length > 12) return new Response(JSON.stringify({ success: false, error: '昵称无效' }), { status: 400 });
      const count = user.nickname_change_count || 0;
      let cost = 0;
      if (count === 1) cost = 10; else if (count > 1) cost = 50;
      if (user.coins < cost) return new Response(JSON.stringify({ success: false, error: `余额不足，需 ${cost} i币` }), { status: 400 });

      await db.batch([
          db.prepare('UPDATE users SET nickname = ?, nickname_change_count = nickname_change_count + 1, coins = coins - ? WHERE id = ?').bind(nickname, cost, user.id)
      ]);
      return new Response(JSON.stringify({ success: true, message: `修改成功，扣除 ${cost} i币` }));
  }

  const { avatar_url } = reqBody;
  if (avatar_url !== undefined) {
      await db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(avatar_url, user.id).run();
      return new Response(JSON.stringify({ success: true, message: '头像已更新' }));
  }

  // 2. 修改偏好
  if (badge_preference !== undefined) {
      await db.prepare('UPDATE users SET badge_preference = ? WHERE id = ?').bind(badge_preference, user.id).run();
      return new Response(JSON.stringify({ success: true, message: '佩戴偏好已保存' }));
  }

  // === 3. 新增：修改个性签名 ===
  if (bio !== undefined) {
      if (bio.length > 50) return new Response(JSON.stringify({ success: false, error: '签名太长了 (限50字)' }), { status: 400 });
      await db.prepare('UPDATE users SET bio = ? WHERE id = ?').bind(bio, user.id).run();
      return new Response(JSON.stringify({ success: true, message: '个性签名已更新' }));
  }

  return new Response(JSON.stringify({ success: false, error: '无操作' }));
}
