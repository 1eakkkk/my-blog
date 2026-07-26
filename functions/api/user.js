import { json, getUser } from './_lib.js';

export async function onRequestGet(context) {
  const db = context.env.DB;
  const user = await getUser(context);
  if (!user) return json({ loggedIn: false });

  const now = Date.now();

  // 封禁到期自动解封
  if (user.status === 'banned' && user.ban_expires_at < now) {
    await db.prepare("UPDATE users SET status = 'active', ban_expires_at = 0, ban_reason = NULL WHERE id = ?").bind(user.id).run();
    user.status = 'active';
  }

  // 最多每 60 秒更新一次 last_seen
  if (!user.last_seen || (now - user.last_seen > 60000)) {
    try { await db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(now, user.id).run(); } catch (e) { }
  }

  // 异步清理 7 天前的过期 session（数据库瘦身；有效性校验已在 _lib.js 的 SQL 里完成）
  const expireTime = now - 7 * 24 * 60 * 60 * 1000;
  context.waitUntil(
    db.prepare('DELETE FROM sessions WHERE created_at < ?').bind(expireTime).run()
  );

  return json({ loggedIn: true, ...user }, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate' }
  });
}
