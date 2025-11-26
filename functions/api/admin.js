export async function onRequestPost(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie) return new Response(JSON.stringify({ error: '无权操作' }), { status: 401 });
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const admin = await db.prepare(`SELECT users.role FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  
  if (!admin || admin.role !== 'admin') return new Response(JSON.stringify({ success: false, error: '权限不足' }), { status: 403 });

  const { action, target_user_id, target_username, days, title, color, content, amount } = await context.request.json();

  if (action === 'ban_user') {
    const banDays = parseInt(days);
    const now = Date.now();
    const expireTime = now + (banDays * 24 * 60 * 60 * 1000);
    await db.prepare("UPDATE users SET status = 'banned', ban_expires_at = ? WHERE id = ?").bind(expireTime, target_user_id).run();
    return new Response(JSON.stringify({ success: true, message: `用户已封禁 ${banDays} 天` }));
  }

  if (action === 'post_announce') {
      // ... (保持之前的公告逻辑)
      const adminUser = await db.prepare(`SELECT users.id, users.username, users.nickname FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
      await db.prepare('INSERT INTO posts (user_id, author_name, title, content, category, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(adminUser.id, adminUser.nickname || adminUser.username, title, content, '公告', Date.now()).run();
      return new Response(JSON.stringify({ success: true, message: '公告发布成功' }));
  }
  
  if (action === 'gen_key') {
    // ... (保持之前的密钥逻辑)
    const target = await db.prepare("SELECT id, recovery_key FROM users WHERE username = ?").bind(target_username).first();
    if (!target) return new Response(JSON.stringify({ success: false, error: '用户不存在' }));
    let key = target.recovery_key;
    if (!key) {
        const generateKey = () => Math.random().toString(36).substring(2, 6).toUpperCase();
        key = `KEY-${generateKey()}-${generateKey()}-${generateKey()}`;
        await db.prepare("UPDATE users SET recovery_key = ? WHERE id = ?").bind(key, target.id).run();
    }
    return new Response(JSON.stringify({ success: true, message: '密钥获取成功', key: key }));
  }

  if (action === 'grant_title') {
    if(title && (title.length < 2 || title.length > 6)) return new Response(JSON.stringify({ success: false, error: '头衔长度限制 2-6 字符' }));
    await db.prepare("UPDATE users SET custom_title = ?, custom_title_color = ? WHERE username = ?").bind(title, color, target_username).run();
    return new Response(JSON.stringify({ success: true, message: '头衔设置成功' }));
  }

  // === 优化：批量生成邀请码 ===
  if (action === 'gen_invite') {
      let count = parseInt(amount) || 1;
      if (count > 15) count = 15;
      
      const codes = [];
      const now = Date.now();
      const expire = now + (3 * 24 * 60 * 60 * 1000); // 3天有效期

      const stmt = db.prepare('INSERT INTO invites (code, created_at, expires_at) VALUES (?, ?, ?)');
      const batch = [];

      for(let i=0; i<count; i++) {
          const code = 'INV-' + Math.random().toString(36).substring(2, 8).toUpperCase();
          codes.push(code);
          batch.push(stmt.bind(code, now, expire));
      }
      
      await db.batch(batch);
      return new Response(JSON.stringify({ success: true, codes: codes }));
  }

  return new Response(JSON.stringify({ success: false, error: '未知指令' }));
}
