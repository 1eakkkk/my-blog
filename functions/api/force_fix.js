// --- functions/api/force_fix.js ---
export async function onRequest(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  
  if (!cookie) return new Response("请先在网页登录", {status: 401});
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const user = await db.prepare(`SELECT id, username FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response("无效用户", {status: 401});

  const itemId = 'color_fire'; // 强制补发火焰昵称
  const category = 'name_color';
  const now = Date.now();
  const expire = now + (30 * 86400 * 1000); // 30天

  try {
      // 1. 删除旧的记录（防止重复）
      await db.prepare("DELETE FROM user_items WHERE user_id = ? AND item_id = ?").bind(user.id, itemId).run();
      
      // 2. 插入新记录 (强制设置为已装备 is_equipped = 1)
      await db.prepare("INSERT INTO user_items (user_id, item_id, category, quantity, is_equipped, expires_at, created_at) VALUES (?, ?, ?, 1, 1, ?, ?)")
        .bind(user.id, itemId, category, expire, now).run();

      // 3. 强制更新 users 表字段
      await db.prepare("UPDATE users SET name_color = ? WHERE id = ?").bind(itemId, user.id).run();

      return new Response(`修复成功！\n用户: ${user.username}\n物品: ${itemId}\n状态: 已强制补发并装备。\n\n请刷新首页查看效果。`);
  } catch (e) {
      return new Response("修复出错: " + e.message);
  }
}
