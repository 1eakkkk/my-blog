// functions/api/admin.js

export async function onRequestPost(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  
  // 1. 基础鉴权
  if (!cookie) return new Response(JSON.stringify({ error: '无权操作' }), { status: 401 });
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  if (!sessionId) return new Response(JSON.stringify({ error: 'Session无效' }), { status: 401 });

  const admin = await db.prepare(`SELECT users.role FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!admin || admin.role !== 'admin') return new Response(JSON.stringify({ success: false, error: '权限不足' }), { status: 403 });

  let req = {};
  try { req = await context.request.json(); } catch(e) { return new Response(JSON.stringify({ success: false, error: '无效请求数据' })); }
  
  const { action } = req;

  try {
      // === 1. 获取统计数据 (修复版：实时 + 日活) ===
      if (action === 'get_stats') {
          try {
              const now = Date.now();
              const oneDayAgo = now - (24 * 60 * 60 * 1000); // 24小时前
              const fiveMinAgo = now - (5 * 60 * 1000);      // 5分钟前 (视为在线)

              // 1. 总注册数
              const total = await db.prepare('SELECT COUNT(*) as c FROM users').first();
              
              // 2. 24H 日活 (DAU)
              const dau = await db.prepare('SELECT COUNT(*) as c FROM users WHERE last_seen > ?').bind(oneDayAgo).first();
              
              // 3. 实时在线 (Online)
              const online = await db.prepare('SELECT COUNT(*) as c FROM users WHERE last_seen > ?').bind(fiveMinAgo).first();
              
              // 获取系统设置状态
              let inviteRequired = false;
              let turnstileEnabled = false;
              let unreadFb = 0;

              try {
                  const setting = await db.prepare("SELECT value FROM system_settings WHERE key = 'invite_required'").first();
                  if(setting) inviteRequired = setting.value === 'true';
                  
                  const tsSetting = await db.prepare("SELECT value FROM system_settings WHERE key = 'turnstile_enabled'").first();
                  if(tsSetting) turnstileEnabled = tsSetting.value === 'true';

                  const fbCount = await db.prepare('SELECT COUNT(*) as c FROM feedbacks WHERE is_read = 0').first();
                  if(fbCount) unreadFb = fbCount.c;
              } catch(e) {}

              return new Response(JSON.stringify({ 
                  success: true, 
                  totalUsers: total ? total.c : 0, 
                  activeUsers: dau ? dau.c : 0,    // 24小时日活
                  onlineUsers: online ? online.c : 0, // 实时在线 (新字段)
                  inviteRequired,
                  unreadFeedback: unreadFb,
                  turnstileEnabled
              }));
          } catch(err) {
              return new Response(JSON.stringify({ success: false, error: "Stats DB Error: " + err.message }));
          }
      }

      // === 2. 封禁管理 ===
      if (action === 'get_banned_users') {
          const list = await db.prepare(`SELECT id, username, nickname, ban_expires_at, ban_reason FROM users WHERE status = 'banned' ORDER BY ban_expires_at DESC`).all();
          return new Response(JSON.stringify({ success: true, list: list.results }));
      }

      if (action === 'ban_user') {
          const expireTime = Date.now() + (parseInt(req.days) * 86400000);
          const reason = req.reason || '违反社区规定';
          await db.prepare("UPDATE users SET status = 'banned', ban_expires_at = ?, ban_reason = ? WHERE id = ?")
            .bind(expireTime, reason, req.target_user_id).run();
          return new Response(JSON.stringify({ success: true, message: '用户已封禁' }));
      }

      if (action === 'unban_user') {
          await db.prepare("UPDATE users SET status = 'active', ban_expires_at = 0, ban_reason = NULL WHERE id = ?")
            .bind(req.target_user_id).run();
          return new Response(JSON.stringify({ success: true, message: '用户已解封' }));
      }

      // === 3. 播报管理 ===
      if (action === 'get_pending_broadcasts') {
          // 检查表是否存在，不存在返回空
          try {
              const list = await db.prepare("SELECT * FROM broadcasts WHERE status = 'pending' ORDER BY created_at ASC").all();
              return new Response(JSON.stringify({ success: true, list: list.results }));
          } catch (e) {
              return new Response(JSON.stringify({ success: true, list: [] })); 
          }
      }

      if (action === 'review_broadcast') {
          const { id, decision } = req; 
          if (decision === 'reject') {
              await db.prepare("UPDATE broadcasts SET status = 'rejected' WHERE id = ?").bind(id).run();
              return new Response(JSON.stringify({ success: true, message: '已驳回' }));
          }
          if (decision === 'approve') {
              const now = Date.now();
              const endTime = now + (24 * 60 * 60 * 1000); 
              await db.prepare("UPDATE broadcasts SET status = 'active', start_time = ?, end_time = ? WHERE id = ?")
                .bind(now, endTime, id).run();
              return new Response(JSON.stringify({ success: true, message: '已通过' }));
          }
      }

      // === 4. 充值审核 (修复版) ===
      if (action === 'get_recharge_requests') {
          // 容错处理：如果表不存在，返回空列表而不是报错
          try {
              const list = await db.prepare("SELECT * FROM recharge_requests WHERE status = 'pending' ORDER BY created_at DESC").all();
              return new Response(JSON.stringify({ success: true, list: list.results }));
          } catch(e) {
              return new Response(JSON.stringify({ success: true, list: [] }));
          }
      }

      if (action === 'review_recharge') {
          const { id, decision } = req; 
          const rechargeRecord = await db.prepare("SELECT * FROM recharge_requests WHERE id = ?").bind(id).first();
          
          if (!rechargeRecord || rechargeRecord.status !== 'pending') {
              return new Response(JSON.stringify({ success: false, error: '申请不存在或已处理' }));
          }

          const updates = [];
          const now = Date.now();
          const userId = rechargeRecord.user_id; 

          if (decision === 'approve') {
              const match = (rechargeRecord.amount_str || "").match(/(\d+)币/);
              const coins = match ? parseInt(match[1]) : 0;
              if (coins <= 0) return new Response(JSON.stringify({ success: false, error: '金额解析失败' }));

              updates.push(db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").bind(coins, userId));
              updates.push(db.prepare("UPDATE recharge_requests SET status = 'approved' WHERE id = ?").bind(id));
              updates.push(db.prepare("INSERT INTO notifications (user_id, type, message, created_at, is_read) VALUES (?, 'system', ?, ?, 0)").bind(userId, `【充值到账】${coins} i币已到账。`, now));
          } else {
              updates.push(db.prepare("UPDATE recharge_requests SET status = 'rejected' WHERE id = ?").bind(id));
              updates.push(db.prepare("INSERT INTO notifications (user_id, type, message, created_at, is_read) VALUES (?, 'system', ?, ?, 0)").bind(userId, `【充值失败】您的充值申请未通过审核。`, now));
          }

          await db.batch(updates);
          return new Response(JSON.stringify({ success: true, message: '操作成功' }));
      }

      // === 5. 系统设置 (开关) ===
      if (action === 'toggle_invite_system') {
          const val = req.enabled ? 'true' : 'false';
          await db.prepare("INSERT INTO system_settings (key, value) VALUES ('invite_required', ?) ON CONFLICT(key) DO UPDATE SET value = ?").bind(val, val).run();
          return new Response(JSON.stringify({ success: true, message: `设置已更新` }));
      }
      if (action === 'toggle_turnstile') {
          const val = req.enabled ? 'true' : 'false';
          await db.prepare("INSERT INTO system_settings (key, value) VALUES ('turnstile_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = ?").bind(val, val).run();
          return new Response(JSON.stringify({ success: true, message: `设置已更新` }));
      }

      // === 6. 邀请码管理 ===
      if (action === 'get_invites') {
          try {
              const codes = await db.prepare('SELECT * FROM invites ORDER BY is_used ASC, created_at DESC LIMIT 50').all();
              return new Response(JSON.stringify({ success: true, list: codes.results }));
          } catch(e) { return new Response(JSON.stringify({ success: true, list: [] })); }
      }
      if (action === 'refill_invites') {
          const valid = await db.prepare('SELECT COUNT(*) as c FROM invites WHERE is_used = 0 AND expires_at > ?').bind(Date.now()).first();
          let need = 10 - (valid ? valid.c : 0); if(need > 10) need = 10; 
          if(need <= 0) return new Response(JSON.stringify({success:false, error:'无需补充'}));
          
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

      // === 7. 反馈管理 ===
      if (action === 'get_feedbacks') {
          try {
              const list = await db.prepare(`SELECT feedbacks.*, users.username, users.nickname FROM feedbacks JOIN users ON feedbacks.user_id = users.id ORDER BY feedbacks.is_read ASC, feedbacks.created_at DESC LIMIT 50`).all();
              return new Response(JSON.stringify({ success: true, list: list.results }));
          } catch(e) { return new Response(JSON.stringify({ success: true, list: [] })); }
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

      // === 9. 新增：用户列表与在线监控 ===
      
      // A. 获取注册用户列表 (最近 100 人)
      if (action === 'get_user_list') {
          // 这里查询 ID, 用户名, 昵称, 余额, 经验, 注册时间, 状态
          const list = await db.prepare(`
              SELECT id, username, nickname, coins, xp, created_at, status, last_seen 
              FROM users 
              ORDER BY created_at DESC 
          `).all();
          return new Response(JSON.stringify({ success: true, list: list.results }));
      }

      // B. 获取实时在线用户 (过去 5 分钟内活跃)
      if (action === 'get_online_users') {
          const fiveMinAgo = Date.now() - (5 * 60 * 1000);
          
          // 查询最近活跃的用户
          const list = await db.prepare(`
              SELECT id, username, nickname, last_seen, coins 
              FROM users 
              WHERE last_seen > ? 
              ORDER BY last_seen DESC
          `).bind(fiveMinAgo).all();
          
          return new Response(JSON.stringify({ success: true, list: list.results }));
      }
      // === 8. 其他功能 (公告、头衔、密钥、余额、搜索、福利) ===
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
          const { target_username, target_user_id } = req;
          let user = null;
          if (target_user_id) user = await db.prepare("SELECT id, username, recovery_key FROM users WHERE id = ?").bind(target_user_id).first();
          else if (target_username) user = await db.prepare("SELECT id, username, recovery_key FROM users WHERE username = ?").bind(target_username).first();

          if (!user) return new Response(JSON.stringify({ success: false, key: '❌ 用户不存在' }));

          let finalKey = user.recovery_key;
          let msg = "";
          if (!finalKey) {
              const generateKey = () => Math.random().toString(36).substring(2, 6).toUpperCase();
              finalKey = `KEY-${generateKey()}-${generateKey()}-${generateKey()}`;
              await db.prepare("UPDATE users SET recovery_key = ? WHERE id = ?").bind(finalKey, user.id).run();
              msg = " (系统自动补发)";
          }
          return new Response(JSON.stringify({ success: true, key: finalKey + msg, real_username: user.username }));
      }
      if (action === 'manage_balance') {
          const { target_username, amount, reason } = req;
          const change = parseInt(amount);
          if (isNaN(change)) return new Response(JSON.stringify({ success: false, error: '金额无效' }));
          const target = await db.prepare('SELECT id FROM users WHERE username = ?').bind(target_username).first();
          if (!target) return new Response(JSON.stringify({ success: false, error: '用户不存在' }));
          await db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(change, target.id).run();
          const msg = `系统通知: 余额变动 ${change > 0 ? '+' : ''}${change} i币。原因: ${reason || '系统调整'}`;
          await db.prepare('INSERT INTO notifications (user_id, type, message, link, created_at) VALUES (?, ?, ?, ?, ?)').bind(target.id, 'system', msg, '#home', Date.now()).run();
          return new Response(JSON.stringify({ success: true, message: `操作成功` }));
      }
      if (action === 'global_welfare') {
          const { xp, coins, reason } = req;
          const addXp = parseInt(xp) || 0;
          const addCoins = parseInt(coins) || 0;
          if (addXp === 0 && addCoins === 0) return new Response(JSON.stringify({ success: false, error: '经验和i币不能同时为0' }));
          const now = Date.now();
          const msg = `🎁 [全服福利] 系统发放: ${addXp} XP, ${addCoins} i币。备注: ${reason}`;
          await db.batch([
              db.prepare('UPDATE users SET xp = xp + ?, coins = coins + ?').bind(addXp, addCoins),
              db.prepare(`INSERT INTO notifications (user_id, type, message, link, created_at) SELECT id, 'system', ?, '#home', ? FROM users`).bind(msg, now)
          ]);
          return new Response(JSON.stringify({ success: true, message: '发放成功' }));
      }
      if (action === 'search_users') {
          const term = req.query || '';
          if (!term) return new Response(JSON.stringify({ success: false, error: '请输入关键词' }));
          const searchStr = `%${term}%`;
          const list = await db.prepare(`SELECT id, username, nickname, status, coins, recovery_key, created_at FROM users WHERE username LIKE ? OR nickname LIKE ? ORDER BY created_at DESC LIMIT 20`).bind(searchStr, searchStr).all();
          return new Response(JSON.stringify({ success: true, list: list.results }));
      }

      return new Response(JSON.stringify({ success: false, error: '未知指令' }));

  } catch (err) {
      // 全局捕获，防止 500 错误直接抛出，而是返回 JSON
      return new Response(JSON.stringify({ success: false, error: "Server Error: " + err.message }), { status: 500 });
  }
}
