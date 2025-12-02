// --- functions/api/admin.js ---
export async function onRequestPost(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie) return new Response(JSON.stringify({ error: '无权操作' }), { status: 401 });
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const admin = await db.prepare(`SELECT users.role FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  
  if (!admin || admin.role !== 'admin') return new Response(JSON.stringify({ success: false, error: '权限不足' }), { status: 403 });

  let req = {};
  try { req = await context.request.json(); } catch(e) { return new Response(JSON.stringify({ success: false, error: '无效请求' })); }
  
  const { action } = req;

  if (action === 'get_stats') {
      const total = await db.prepare('SELECT COUNT(*) as c FROM users').first();
      // === 改动：24小时活跃 ===
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      const active = await db.prepare('SELECT COUNT(*) as c FROM users WHERE last_seen > ?').bind(oneDayAgo).first();
      const setting = await db.prepare("SELECT value FROM system_settings WHERE key = 'invite_required'").first();
      const unreadFb = await db.prepare('SELECT COUNT(*) as c FROM feedbacks WHERE is_read = 0').first();
      const tsSetting = await db.prepare("SELECT value FROM system_settings WHERE key = 'turnstile_enabled'").first();

      return new Response(JSON.stringify({ 
          success: true, 
          totalUsers: total.c, 
          activeUsers: active.c,
          inviteRequired: setting ? setting.value === 'true' : true,
          unreadFeedback: unreadFb.c,
          turnstileEnabled: tsSetting ? tsSetting.value === 'true' : true 
      }));
  }

  // === 新增：获取封禁列表 ===
  if (action === 'get_banned_users') {
      const list = await db.prepare(`SELECT id, username, nickname, ban_expires_at, ban_reason FROM users WHERE status = 'banned' ORDER BY ban_expires_at DESC`).all();
      return new Response(JSON.stringify({ success: true, list: list.results }));
  }

  // === 修改：封禁用户 (增加理由) ===
  if (action === 'ban_user') {
      const expireTime = Date.now() + (parseInt(req.days) * 86400000);
      const reason = req.reason || '违反社区规定';
      await db.prepare("UPDATE users SET status = 'banned', ban_expires_at = ?, ban_reason = ? WHERE id = ?")
        .bind(expireTime, reason, req.target_user_id).run();
      return new Response(JSON.stringify({ success: true, message: '用户已封禁' }));
  }

  // === 新增：解封用户 ===
  if (action === 'unban_user') {
      await db.prepare("UPDATE users SET status = 'active', ban_expires_at = 0, ban_reason = NULL WHERE id = ?")
        .bind(req.target_user_id).run();
      return new Response(JSON.stringify({ success: true, message: '用户已解封' }));
  }

  // ... 在 admin.js 现有的 action 判断中添加 ...

  // 获取待审核播报
  if (action === 'get_pending_broadcasts') {
      const list = await db.prepare("SELECT * FROM broadcasts WHERE status = 'pending' ORDER BY created_at ASC").all();
      return new Response(JSON.stringify({ success: true, list: list.results }));
  }

  // 审核播报
  if (action === 'review_broadcast') {
      const { id, decision } = req; // decision: 'approve' or 'reject'
      
      if (decision === 'reject') {
          // 拒绝：状态改 rejected，这里为了简单不退道具了（或者你可以加退道具逻辑），通常作为惩罚
          await db.prepare("UPDATE broadcasts SET status = 'rejected' WHERE id = ?").bind(id).run();
          return new Response(JSON.stringify({ success: true, message: '已驳回' }));
      }
      
      if (decision === 'approve') {
          const now = Date.now();
          const endTime = now + (24 * 60 * 60 * 1000); // 24小时后过期
          await db.prepare("UPDATE broadcasts SET status = 'active', start_time = ?, end_time = ? WHERE id = ?")
            .bind(now, endTime, id).run();
          return new Response(JSON.stringify({ success: true, message: '已通过，即刻生效' }));
      }
  }

      // === 1. 获取充值申请列表 ===
  if (action === 'get_recharge_requests') {
      const list = await db.prepare("SELECT * FROM recharge_requests WHERE status = 'pending' ORDER BY created_at DESC").all();
      return new Response(JSON.stringify({ success: true, list: list.results }));
      }

      // === 2. 审核通过/驳回 ===
  if (action === 'review_recharge') {
      const { id, decision } = body; // decision: 'approve' or 'reject'
            
      const req = await db.prepare("SELECT * FROM recharge_requests WHERE id = ?").bind(id).first();
      if (!req || req.status !== 'pending') return new Response(JSON.stringify({ error: '申请不存在或已处理' }));

      const updates = [];
      const now = Date.now();

      if (decision === 'approve') {
          // 解析金额：从 "0.1元 (650币)" 中提取 650
      const coins = parseInt(req.amount_str.match(/(\d+)币/)[1]);
                
          // 1. 给用户加钱
      updates.push(db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").bind(coins, req.user_id));
           // 2. 更新申请状态
      updates.push(db.prepare("UPDATE recharge_requests SET status = 'approved' WHERE id = ?").bind(id));
           // 3. 通知用户
      updates.push(db.prepare("INSERT INTO notifications (user_id, type, message, created_at, is_read) VALUES (?, 'system', ?, ?, 0)")
        .bind(req.user_id, `【充值到账】感谢支持！您的 ${coins} i币已到账。`, now));
  } else {
                // 驳回
      updates.push(db.prepare("UPDATE recharge_requests SET status = 'rejected' WHERE id = ?").bind(id));
      updates.push(db.prepare("INSERT INTO notifications (user_id, type, message, created_at, is_read) VALUES (?, 'system', ?, ?, 0)")
        .bind(req.user_id, `【充值失败】您的充值申请未通过审核 (截图无效或未收到款项)。`, now));
      }

      await db.batch(updates);
      return new Response(JSON.stringify({ success: true }));
  }

  // ... (保留其他功能: toggle_invite, get_invites, refill, delete, get_feedbacks, mark_read, reply_fb, post_announce, grant, gen_key) ...
  if (action === 'toggle_invite_system') {
      const val = req.enabled ? 'true' : 'false';
      await db.prepare("INSERT INTO system_settings (key, value) VALUES ('invite_required', ?) ON CONFLICT(key) DO UPDATE SET value = ?").bind(val, val).run();
      return new Response(JSON.stringify({ success: true, message: `设置已更新` }));
  }
  if (action === 'toggle_turnstile') {
      const val = req.enabled ? 'true' : 'false';
      await db.prepare("INSERT INTO system_settings (key, value) VALUES ('turnstile_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = ?").bind(val, val).run();
      return new Response(JSON.stringify({ success: true, message: `人机验证已${req.enabled?'开启':'关闭'}` }));
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
  if (action === 'get_feedbacks') {
      const list = await db.prepare(`SELECT feedbacks.*, users.username, users.nickname FROM feedbacks JOIN users ON feedbacks.user_id = users.id ORDER BY feedbacks.is_read ASC, feedbacks.created_at DESC LIMIT 50`).all();
      return new Response(JSON.stringify({ success: true, list: list.results }));
  }
  if (action === 'mark_feedback_read') {
      await db.prepare('UPDATE feedbacks SET is_read = 1 WHERE id = ?').bind(req.id).run();
      return new Response(JSON.stringify({ success: true }));
  }
  if (action === 'delete_feedback') {
      await db.prepare('DELETE FROM feedbacks WHERE id = ?').bind(req.id).run();
      return new Response(JSON.stringify({ success: true }));
  }
  if (action === 'reply_feedback') {
      const { id, user_id, content } = req;
      await db.prepare('UPDATE feedbacks SET is_read = 1, reply_content = ?, replied_at = ? WHERE id = ?').bind(content, Date.now(), id).run();
      const u = await db.prepare('SELECT nickname, username FROM users WHERE id = (SELECT user_id FROM sessions WHERE session_id = ?)').bind(sessionId).first();
      const msg = `管理员回复了你的反馈: ${content}`;
      await db.prepare('INSERT INTO notifications (user_id, type, message, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(user_id, 'system', msg, '#feedback', Date.now()).run();
      return new Response(JSON.stringify({ success: true, message: '已回复' }));
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
  // === 修复版：查询密钥 (支持 ID 查询 + 自动补发) ===
  if (action === 'gen_key') {
      const { target_username, target_user_id } = req;
      
      let user = null;
      
      // 1. 优先按 ID 查 (最准确)
      if (target_user_id) {
          user = await db.prepare("SELECT id, username, recovery_key FROM users WHERE id = ?").bind(target_user_id).first();
      } 
      // 2. 其次按用户名查
      else if (target_username) {
          user = await db.prepare("SELECT id, username, recovery_key FROM users WHERE username = ?").bind(target_username).first();
      }

      if (!user) {
          return new Response(JSON.stringify({ success: false, key: '❌ 用户不存在 (User Not Found)' }));
      }

      // 3. 返回结果 (顺便返回真实的用户名，防止有空格)
      let finalKey = user.recovery_key;
      let msg = "";

      // 如果没有密钥，自动生成
      if (!finalKey) {
          const generateKey = () => Math.random().toString(36).substring(2, 6).toUpperCase();
          finalKey = `KEY-${generateKey()}-${generateKey()}-${generateKey()}`;
          await db.prepare("UPDATE users SET recovery_key = ? WHERE id = ?").bind(finalKey, user.id).run();
          msg = " (系统自动补发)";
      }

      return new Response(JSON.stringify({ 
          success: true, 
          key: finalKey + msg,
          real_username: user.username // 把数据库里真实的用户名也传回去
      }));
  }

  if (action === 'manage_balance') {
      const { target_username, amount, reason } = req;
      const change = parseInt(amount);
      
      if (isNaN(change)) return new Response(JSON.stringify({ success: false, error: '金额无效' }));

      // 1. 查用户是否存在
      const target = await db.prepare('SELECT id FROM users WHERE username = ?').bind(target_username).first();
      if (!target) return new Response(JSON.stringify({ success: false, error: '用户不存在' }));

      // 2. 修改余额
      await db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(change, target.id).run();

      // 3. 发送系统通知
      const msg = `系统通知: 您的账户余额变动 ${change > 0 ? '+' : ''}${change} i币。原因: ${reason || '系统调整'}`;
      await db.prepare('INSERT INTO notifications (user_id, type, message, link, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(target.id, 'system', msg, '#home', Date.now()).run();

      return new Response(JSON.stringify({ success: true, message: `操作成功！已给用户 [${target_username}] ${change > 0 ? '增加' : '扣除'} ${Math.abs(change)} i币。` }));
  }

  // ... (在 manage_balance 代码块之后) ...

  // === 新增：全服福利发放 (包含封禁用户) ===
  if (action === 'global_welfare') {
      const { xp, coins, reason } = req;
      const addXp = parseInt(xp) || 0;
      const addCoins = parseInt(coins) || 0;
      
      if (addXp === 0 && addCoins === 0) {
          return new Response(JSON.stringify({ success: false, error: '经验和i币不能同时为0' }));
      }
      
      const now = Date.now();
      const msg = `🎁 [全服福利] 系统发放: ${addXp} XP, ${addCoins} i币。备注: ${reason || '节日快乐'}`;

      try {
          await db.batch([
              // 1. 更新所有用户 (不加 WHERE 条件即为全员，包括封禁用户)
              db.prepare('UPDATE users SET xp = xp + ?, coins = coins + ?').bind(addXp, addCoins),
              
              // 2. 给所有用户插入通知 (利用 SQL 批量插入，效率极高)
              db.prepare(`
                  INSERT INTO notifications (user_id, type, message, link, created_at)
                  SELECT id, 'system', ?, '#home', ? FROM users
              `).bind(msg, now)
          ]);
          
          return new Response(JSON.stringify({ success: true, message: '全服福利已发放，所有人均已收到通知。' }));
      } catch (e) {
          return new Response(JSON.stringify({ success: false, error: '发放失败: ' + e.message }));
      }
  }

  // === 新增：搜索用户 (支持搜昵称或账号) ===
  if (action === 'search_users') {
      const term = req.query || '';
      if (!term) return new Response(JSON.stringify({ success: false, error: '请输入关键词' }));
      
      const searchStr = `%${term}%`;
      
      // 同时匹配 username 和 nickname
      const list = await db.prepare(`
          SELECT id, username, nickname, status, coins, recovery_key, created_at 
          FROM users 
          WHERE username LIKE ? OR nickname LIKE ? 
          ORDER BY created_at DESC LIMIT 20
      `).bind(searchStr, searchStr).all();
      
      return new Response(JSON.stringify({ success: true, list: list.results }));
  }

  return new Response(JSON.stringify({ success: false, error: '未知指令' }));
}
