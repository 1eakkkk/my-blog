// --- functions/api/user.js (修复版：自动清理过期装备) ---

export async function onRequestGet(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  
  if (!cookie) return new Response(JSON.stringify({ loggedIn: false }), { headers: { 'Content-Type': 'application/json' } });
  
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  if (!sessionId) return new Response(JSON.stringify({ loggedIn: false }), { headers: { 'Content-Type': 'application/json' } });

  // 1. 查询用户
  let user = await db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();

  if (!user) return new Response(JSON.stringify({ loggedIn: false }), { headers: { 'Content-Type': 'application/json' } });

  const now = Date.now();

  // === 🛡️ 核心修复：检查并清理已过期的装备 ===
  // 查询该用户所有【已装备】但【已过期】的物品
  const expiredItems = await db.prepare(`
      SELECT id, item_id, category 
      FROM user_items 
      WHERE user_id = ? AND is_equipped = 1 AND expires_at > 0 AND expires_at < ?
  `).bind(user.id, now).all();

  if (expiredItems.results.length > 0) {
      const updates = [];
      // 字段映射表
      const catToCol = {
          'background': 'equipped_bg',
          'post_style': 'equipped_post_style',
          'bubble': 'equipped_bubble_style',
          'name_color': 'name_color'
      };

      for (const item of expiredItems.results) {
          // 1. 在背包中标记为卸下
          updates.push(db.prepare('UPDATE user_items SET is_equipped = 0 WHERE id = ?').bind(item.id));
          
          // 2. 清除 users 表中的特效字段
          const colName = catToCol[item.category];
          if (colName) {
              updates.push(db.prepare(`UPDATE users SET ${colName} = NULL WHERE id = ?`).bind(user.id));
              // 同时更新内存中的 user 对象，确保前端立即看到变化，不需要再刷一次
              user[colName] = null;
          }
      }
      
      // 批量执行清理
      if (updates.length > 0) await db.batch(updates);
  }
  // ===========================================

  // VIP 状态校验
  let isVip = false;
  if (user.vip_expires_at > now) {
      isVip = true;
  } else if (user.is_vip === 1 && user.vip_expires_at === 0) {
      isVip = false; // 修正逻辑
  }

  // 封禁自动解封
  if (user.status === 'banned' && user.ban_expires_at < now) {
      await db.prepare("UPDATE users SET status = 'active', ban_expires_at = 0, ban_reason = NULL WHERE id = ?").bind(user.id).run();
      user.status = 'active';
  }

  // 更新最后活跃
  if (!user.last_seen || (now - user.last_seen > 300000)) {
      try { await db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(now, user.id).run(); } catch(e) {}
  }

  if (!user.forge_levels) user.forge_levels = '{}';
  if (!user.tech_levels) user.tech_levels = '{}';

  delete user.password;
  
  return new Response(JSON.stringify({ 
      loggedIn: true, 
      ...user, 
      is_vip: isVip 
  }), { 
      headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
      } 
  });
}
