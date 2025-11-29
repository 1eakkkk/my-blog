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
      
      // === 修改：检查是否有改名卡 ===
      const card = await db.prepare("SELECT id, quantity FROM user_items WHERE user_id = ? AND item_id = 'rename_card' AND quantity > 0").bind(user.id).first();
      
      if (!card) {
          return new Response(JSON.stringify({ success: false, error: '未找到改名卡，请先去商城购买' }), { status: 400 });
      }

      await db.batch([
          // 修改名字
          db.prepare('UPDATE users SET nickname = ?, nickname_change_count = nickname_change_count + 1 WHERE id = ?').bind(nickname, user.id),
          // 扣除改名卡
          db.prepare('UPDATE user_items SET quantity = quantity - 1 WHERE id = ?').bind(card.id)
      ]);
      
      // 清理数量为0的卡 (可选)
      // await db.prepare('DELETE FROM user_items WHERE quantity <= 0').run();

      return new Response(JSON.stringify({ success: true, message: '改名成功，消耗 1 张改名卡' }));
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
