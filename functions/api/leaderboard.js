// --- functions/api/leaderboard.js (纯净版) ---
export async function onRequestGet(context) {
  const db = context.env.DB;

  // 1. 获取当前用户 ID (用于更新日常任务 - 仅保留浏览任务)
  const cookie = context.request.headers.get('Cookie');
  let currentUserId = null;
  if (cookie && cookie.includes('session_id')) {
      const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
      const u = await db.prepare('SELECT user_id FROM sessions WHERE session_id = ?').bind(sessionId).first();
      if(u) currentUserId = u.user_id;
  }

  // 2. 更新任务进度 (view_rank) - 如果任务系统还在的话
  // (既然你之前删除了任务系统，这里其实可以删掉，但保留着也不报错，为了保险起见保留 update 逻辑，若表不存在 catch 会捕获)
  if (currentUserId) {
      const today = new Date(new Date().getTime() + 8*3600*1000).toISOString().split('T')[0];
      try {
          await db.prepare(`UPDATE user_tasks SET progress = progress + 1 WHERE user_id = ? AND task_code = 'view_rank' AND category = 'daily' AND status = 0 AND period_key = ?`)
            .bind(currentUserId, today).run();
      } catch(e) {}
  }

  // 3. 核心查询逻辑 (移除了 Net Worth)
  const results = await db.batch([
      // 0: 经验榜
      db.prepare('SELECT username, nickname, avatar_variant, avatar_url, xp, level, is_vip, custom_title, custom_title_color FROM users ORDER BY xp DESC LIMIT 10'),
      
      // 1: 支出榜
      db.prepare('SELECT username, nickname, avatar_variant, avatar_url, tips_sent, is_vip, custom_title, custom_title_color, xp, level FROM users WHERE tips_sent > 0 ORDER BY tips_sent DESC LIMIT 10'),
      
      // 2: 收入榜
      db.prepare('SELECT username, nickname, avatar_variant, avatar_url, tips_received, is_vip, custom_title, custom_title_color, xp, level FROM users WHERE tips_received > 0 ORDER BY tips_received DESC LIMIT 10'),
      
      // 3: 人气榜
      db.prepare('SELECT username, nickname, avatar_variant, avatar_url, likes_received, is_vip, custom_title, custom_title_color, xp, level FROM users WHERE likes_received > 0 ORDER BY likes_received DESC LIMIT 10'),
      
      // 4: 现金榜 (i币榜)
      db.prepare('SELECT username, nickname, avatar_variant, avatar_url, coins, is_vip, custom_title, custom_title_color, xp, level FROM users ORDER BY coins DESC LIMIT 10')
  ]);

  return new Response(JSON.stringify({
      success: true,
      xp: results[0].results,
      sent: results[1].results,
      received: results[2].results,
      likes: results[3].results,
      coins: results[4].results
      // 删除了 net_worth
  }));
}
