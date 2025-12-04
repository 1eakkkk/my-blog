// --- functions/api/leaderboard.js ---
export async function onRequestGet(context) {
  const db = context.env.DB;

  // 1. 任务更新逻辑
  const cookie = context.request.headers.get('Cookie');
  let currentUserId = null;
  if (cookie && cookie.includes('session_id')) {
      const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
      const u = await db.prepare('SELECT user_id FROM sessions WHERE session_id = ?').bind(sessionId).first();
      if(u) currentUserId = u.user_id;
  }
  if (currentUserId) {
      const today = new Date(new Date().getTime() + 8*3600*1000).toISOString().split('T')[0];
      try { await db.prepare(`UPDATE user_tasks SET progress = progress + 1 WHERE user_id = ? AND task_code = 'view_rank' AND category = 'daily' AND status = 0 AND period_key = ?`).bind(currentUserId, today).run(); } catch(e) {}
  }

  // 2. 核心查询
  // ROI 计算公式: (当前资产 - 周初资产) / 周初资产
  // 注意：这里需要做一个复杂的联表，为简化性能，我们直接查 snapshot 表
  
  const results = await db.batch([
      // 0: 经验榜
      db.prepare('SELECT username, nickname, avatar_variant, avatar_url, xp, level, is_vip, custom_title, custom_title_color FROM users ORDER BY xp DESC LIMIT 10'),
      // 1: 支出榜
      db.prepare('SELECT username, nickname, avatar_variant, avatar_url, tips_sent, is_vip, custom_title, custom_title_color, xp, level FROM users WHERE tips_sent > 0 ORDER BY tips_sent DESC LIMIT 10'),
      // 2: 收入榜
      db.prepare('SELECT username, nickname, avatar_variant, avatar_url, tips_received, is_vip, custom_title, custom_title_color, xp, level FROM users WHERE tips_received > 0 ORDER BY tips_received DESC LIMIT 10'),
      // 3: 人气榜
      db.prepare('SELECT username, nickname, avatar_variant, avatar_url, likes_received, is_vip, custom_title, custom_title_color, xp, level FROM users WHERE likes_received > 0 ORDER BY likes_received DESC LIMIT 10'),
      // 4: 财富榜
      db.prepare('SELECT username, nickname, avatar_variant, avatar_url, coins, is_vip, custom_title, custom_title_color, xp, level FROM users ORDER BY coins DESC LIMIT 10'),
      
      // 5: === 新增：黑马榜 (ROI) ===
      // 选取 snapshot 存在且当前资产 > 初始资产的用户
      // 这里的 coins 仅指现金，严谨的话应该算上股票市值，但为了性能先算现金+K币
      db.prepare(`
        SELECT u.username, u.nickname, u.avatar_variant, u.avatar_url, u.xp, u.level, u.is_vip, u.custom_title, u.custom_title_color,
               ((u.coins + u.k_coins * 4) - w.start_capital) * 100.0 / w.start_capital as roi
        FROM users u
        JOIN weekly_snapshots w ON u.id = w.user_id
        WHERE w.start_capital > 1000  -- 忽略小号
        ORDER BY roi DESC
        LIMIT 10
      `)
  ]);

  return new Response(JSON.stringify({
      success: true,
      xp: results[0].results,
      sent: results[1].results,
      received: results[2].results,
      likes: results[3].results,
      coins: results[4].results,
      roi: results[5].results // 新增
  }));
}
