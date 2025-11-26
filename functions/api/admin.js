// --- functions/api/admin.js ---
export async function onRequestPost(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie) return new Response(JSON.stringify({ error: '无权操作' }), { status: 401 });
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const admin = await db.prepare(`SELECT users.role FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  
  if (!admin || admin.role !== 'admin') return new Response(JSON.stringify({ success: false, error: '权限不足' }), { status: 403 });

  let req = {};
  try {
      req = await context.request.json();
  } catch(e) {
      return new Response(JSON.stringify({ success: false, error: '无效的请求体' }), { status: 400 });
  }
  
  const { action } = req;

  // 1. 获取统计数据
  if (action === 'get_stats') {
      const total = await db.prepare('SELECT COUNT(*) as c FROM users').first();
      const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
      const active = await db.prepare('SELECT COUNT(*) as c FROM users WHERE last_seen > ?').bind(threeDaysAgo).first();
      const setting = await db.prepare("SELECT value FROM system_settings WHERE key = 'invite_required'").first();
      const inviteRequired = setting ? setting.value === 'true' : true;

      return new Response(JSON.stringify({ 
          success: true, 
          totalUsers: total.c, 
          activeUsers: active.c,
          inviteRequired: inviteRequired 
      }));
  }

  // 2. 切换邀请码开关
  if (action === 'toggle_invite_system') {
      const { enabled } = req;
      const val = enabled ? 'true' : 'false';
      await db.prepare("INSERT INTO system_settings (key, value) VALUES ('invite_required', ?) ON CONFLICT(key) DO UPDATE SET value = ?")
        .bind(val, val).run();
      return new Response(JSON.stringify({ success: true, message: `邀请注册已${enabled?'开启':'关闭'}` }));
  }

  // 3. 获取邀请码列表
  if (action === 'get_invites') {
      const codes = await db.prepare('SELECT * FROM invites ORDER BY is_used ASC, created_at DESC LIMIT 50').all();
      return new Response(JSON.stringify({ success: true, list: codes.results }));
  }

  // 4. 补全邀请码
  if (action === 'refill_invites') {
      const validCount = await db.prepare('SELECT COUNT(*) as c FROM invites WHERE is_used = 0 AND expires_at > ?').bind(Date.now()).first();
      const currentValid = validCount.c;
      let need = 10 - currentValid;
      
      if (need <= 0) return new Response(JSON.stringify({ success: false, error: '当前已有足够可用邀请码' }));
      if (need > 10) need = 10;

      const now = Date.now();
      const expire = now + (7 * 24 * 60 * 60 * 1000);
      const stmt = db.prepare('INSERT INTO invites (code, created_at, expires_at) VALUES (?, ?, ?)');
      const batch = [];
      
      for(let i=0; i<need; i++) {
          const code = 'INV-' + Math.random().toString(36).substring(2, 8).toUpperCase();
          batch.push(stmt.bind(code, now, expire));
      }
      await db.batch(batch);
      return new Response(JSON.stringify({ success: true, message: `已补充 ${need} 个邀请码` }));
  }

  // 5. 删除邀请码 (修复：改用 code 删除，防止 id 不存在导致 500 错误)
  if (action === 'delete_invite') {
      if (!req.code) return new Response(JSON.stringify({ success: false, error: '邀请码缺失' }));
      await db.prepare('DELETE FROM invites WHERE code = ?').bind(req.code).run();
      return new Response(JSON.stringify({ success: true }));
  }

  // 6. 获取反馈列表
  if (action === 'get_feedbacks') {
      const list = await db.prepare(`
        SELECT feedbacks.*, users.username, users.nickname 
        FROM feedbacks 
        JOIN users ON feedbacks.user_id = users.id 
        ORDER BY feedbacks.created_at DESC LIMIT 30
      `).all();
      return new Response(JSON.stringify({ success: true, list: list.results }));
  }

  if (action === 'ban_user') {
      const expireTime = Date.now() + (parseInt(req.days) * 86400000);
      await db.prepare("UPDATE users SET status = 'banned', ban_expires_at = ? WHERE id = ?").bind(expireTime, req.target_user_id).run();
      return new Response(JSON.stringify({ success: true, message: '已封禁' }));
  }
  if (action === 'post_announce') {
      const adminUser = await db.prepare(`SELECT users.id, users.username, users.nickname FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
      await db.prepare('INSERT INTO posts (user_id, author_name, title, content, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(adminUser.id, adminUser.nickname || adminUser.username, req.title, req.content, '公告', Date.now(), Date.now()).run();
      return new Response(JSON.stringify({ success: true, message: '公告已发布' }));
  }
  if (action === 'grant_title') {
      await db.prepare("UPDATE users SET custom_title = ?, custom_title_color = ? WHERE username = ?").bind(req.title, req.color, req.target_username).run();
      return new Response(JSON.stringify({ success: true, message: '头衔已发放' }));
  }
  if (action === 'gen_key') {
      const target = await db.prepare("SELECT recovery_key FROM users WHERE username = ?").bind(req.target_username).first();
      return new Response(JSON.stringify({ success: true, key: target ? target.recovery_key : '用户不存在' }));
  }

  return new Response(JSON.stringify({ success: false, error: '未知指令' }));
}
