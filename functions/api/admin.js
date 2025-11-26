// --- functions/api/admin.js ---
export async function onRequestPost(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie) return new Response(JSON.stringify({ error: '无权操作' }), { status: 401 });
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const admin = await db.prepare(`SELECT users.role, users.nickname, users.username FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  
  if (!admin || admin.role !== 'admin') return new Response(JSON.stringify({ success: false, error: '权限不足' }), { status: 403 });

  let req = {};
  try { req = await context.request.json(); } catch(e) { return new Response(JSON.stringify({ success: false, error: '无效请求' }), { status: 400 }); }
  
  const { action } = req;

  // 1. 获取统计数据 (新增反馈未读数)
  if (action === 'get_stats') {
      const total = await db.prepare('SELECT COUNT(*) as c FROM users').first();
      const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
      const active = await db.prepare('SELECT COUNT(*) as c FROM users WHERE last_seen > ?').bind(threeDaysAgo).first();
      const setting = await db.prepare("SELECT value FROM system_settings WHERE key = 'invite_required'").first();
      
      // 统计未读反馈
      const unreadFb = await db.prepare('SELECT COUNT(*) as c FROM feedbacks WHERE is_read = 0').first();

      return new Response(JSON.stringify({ 
          success: true, 
          totalUsers: total.c, 
          activeUsers: active.c,
          inviteRequired: setting ? setting.value === 'true' : true,
          unreadFeedback: unreadFb.c // 新增字段
      }));
  }

  // 2. 获取反馈列表 (更新排序和字段)
  if (action === 'get_feedbacks') {
      const list = await db.prepare(`
        SELECT feedbacks.*, users.username, users.nickname 
        FROM feedbacks 
        JOIN users ON feedbacks.user_id = users.id 
        ORDER BY feedbacks.is_read ASC, feedbacks.created_at DESC LIMIT 50
      `).all();
      return new Response(JSON.stringify({ success: true, list: list.results }));
  }

  // 3. 标记反馈已读
  if (action === 'mark_feedback_read') {
      await db.prepare('UPDATE feedbacks SET is_read = 1 WHERE id = ?').bind(req.id).run();
      return new Response(JSON.stringify({ success: true }));
  }

  // 4. 删除反馈
  if (action === 'delete_feedback') {
      await db.prepare('DELETE FROM feedbacks WHERE id = ?').bind(req.id).run();
      return new Response(JSON.stringify({ success: true }));
  }

  // 5. 回复反馈
  if (action === 'reply_feedback') {
      const { id, user_id, content } = req;
      if(!content) return new Response(JSON.stringify({ success: false, error: '回复内容为空' }));

      // 更新反馈表
      await db.prepare('UPDATE feedbacks SET is_read = 1, reply_content = ?, replied_at = ? WHERE id = ?')
          .bind(content, Date.now(), id).run();

      // 给用户发通知
      const adminName = admin.nickname || admin.username;
      const msg = `管理员回复了你的反馈: ${content}`;
      await db.prepare('INSERT INTO notifications (user_id, type, message, link, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(user_id, 'system', msg, '#feedback', Date.now()).run();

      return new Response(JSON.stringify({ success: true, message: '已回复并通知用户' }));
  }

  // ... (以下保持原有逻辑不变: toggle_invite, get_invites, refill, delete_invite, ban, post_announce, grant, gen_key) ...
  if (action === 'toggle_invite_system') {
      const val = req.enabled ? 'true' : 'false';
      await db.prepare("INSERT INTO system_settings (key, value) VALUES ('invite_required', ?) ON CONFLICT(key) DO UPDATE SET value = ?").bind(val, val).run();
      return new Response(JSON.stringify({ success: true, message: `设置已更新` }));
  }
  if (action === 'get_invites') {
      const codes = await db.prepare('SELECT * FROM invites ORDER BY is_used ASC, created_at DESC LIMIT 50').all();
      return new Response(JSON.stringify({ success: true, list: codes.results }));
  }
  if (action === 'refill_invites') {
      const valid = await db.prepare('SELECT COUNT(*) as c FROM invites WHERE is_used = 0 AND expires_at > ?').bind(Date.now()).first();
      let need = 10 - valid.c; if(need > 10) need = 10; if(need <= 0) return new Response(JSON.stringify({success:false, error:'无需补充'}));
      const stmt = db.prepare('INSERT INTO invites (code, created_at, expires_at) VALUES (?, ?, ?)');
      const batch = []; const now = Date.now(); const exp = now + 604800000;
      for(let i=0; i<need; i++) batch.push(stmt.bind('INV-'+Math.random().toString(36).substring(2,8).toUpperCase(), now, exp));
      await db.batch(batch);
      return new Response(JSON.stringify({ success: true, message: `已补充 ${need} 个` }));
  }
  if (action === 'delete_invite') {
      await db.prepare('DELETE FROM invites WHERE code = ?').bind(req.code).run();
      return new Response(JSON.stringify({ success: true }));
  }
  if (action === 'ban_user') {
      const exp = Date.now() + (parseInt(req.days) * 86400000);
      await db.prepare("UPDATE users SET status = 'banned', ban_expires_at = ? WHERE id = ?").bind(exp, req.target_user_id).run();
      return new Response(JSON.stringify({ success: true, message: '已封禁' }));
  }
  if (action === 'post_announce') {
      const u = await db.prepare(`SELECT id, username, nickname FROM users WHERE id = (SELECT user_id FROM sessions WHERE session_id = ?)`).bind(sessionId).first();
      await db.prepare('INSERT INTO posts (user_id, author_name, title, content, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(u.id, u.nickname||u.username, req.title, req.content, '公告', Date.now(), Date.now()).run();
      return new Response(JSON.stringify({ success: true, message: '发布成功' }));
  }
  if (action === 'grant_title') {
      await db.prepare("UPDATE users SET custom_title = ?, custom_title_color = ? WHERE username = ?").bind(req.title, req.color, req.target_username).run();
      return new Response(JSON.stringify({ success: true, message: 'OK' }));
  }
  if (action === 'gen_key') {
      const t = await db.prepare("SELECT recovery_key FROM users WHERE username = ?").bind(req.target_username).first();
      return new Response(JSON.stringify({ success: true, key: t ? t.recovery_key : 'Not Found' }));
  }

  return new Response(JSON.stringify({ success: false, error: '未知指令' }));
}
