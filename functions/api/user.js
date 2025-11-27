export async function onRequestGet(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie) return new Response(JSON.stringify({ loggedIn: false }));
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  if (!sessionId) return new Response(JSON.stringify({ loggedIn: false }));

  let user = await db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();

  if (!user) return new Response(JSON.stringify({ loggedIn: false }));

  // === 修改部分开始：自动解封并通知 ===
  if (user.status === 'banned' && user.ban_expires_at < Date.now()) {
      // 1. 更新状态
      await db.prepare("UPDATE users SET status = 'active', ban_expires_at = 0, ban_reason = NULL WHERE id = ?").bind(user.id).run();
      
      // 2. 插入解封通知 (新增)
      const msg = "您的账号封禁已过期，欢迎回来。请遵守社区规范。";
      await db.prepare('INSERT INTO notifications (user_id, type, message, link, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(user.id, 'system', msg, '#home', Date.now()).run();

      // 更新内存中的对象，让本次请求立即生效
      user.status = 'active';
  }
  // === 修改部分结束 ===

  // ... (其余代码保持不变) ...
  if (!user.last_seen || (Date.now() - user.last_seen > 300000)) {
      await db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(Date.now(), user.id).run();
  }

  delete user.password;
  return new Response(JSON.stringify({ loggedIn: true, ...user }), { headers: { 'Content-Type': 'application/json' } });
}
