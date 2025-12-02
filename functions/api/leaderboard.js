// --- functions/api/leaderboard.js ---
export async function onRequestGet(context) {
  const db = context.env.DB;

  // 1. 获取当前用户 ID (用于更新任务)
  const cookie = context.request.headers.get('Cookie');
  let currentUserId = null;
  if (cookie && cookie.includes('session_id')) {
      const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
      const u = await db.prepare('SELECT user_id FROM sessions WHERE session_id = ?').bind(sessionId).first();
      if(u) currentUserId = u.user_id;
  }

  // 2. 查询逻辑 (新增了第5个查询：资金榜)
  const results = await db.batch([
      // 0: 经验榜
      db.prepare('SELECT username, nickname, avatar_variant, avatar_url, xp, level, is_vip, custom_title, custom_title_color FROM users ORDER BY xp DESC LIMIT 10'),
      // 1: 支出榜
      db.prepare('SELECT username, nickname, avatar_variant, avatar_url, tips_sent, is_vip, custom_title, custom_title_color FROM users WHERE tips_sent > 0 ORDER BY tips_sent DESC LIMIT 10'),
      // 2: 收入榜
      db.prepare('SELECT username, nickname, avatar_variant, avatar_url, tips_received, is_vip, custom_title, custom_title_color FROM users WHERE tips_received > 0 ORDER BY tips_received DESC LIMIT 10'),
      // 3: 人气榜
      db.prepare('SELECT username, nickname, avatar_variant, avatar_url, likes_received, is_vip, custom_title, custom_title_color FROM users WHERE likes_received > 0 ORDER BY likes_received DESC LIMIT 10'),
      // 4: === 新增：财富榜 (Coins) ===
      db.prepare('SELECT username, nickname, avatar_variant, avatar_url, coins, is_vip, custom_title, custom_title_color FROM users ORDER BY coins DESC LIMIT 10')
  ]);

  // 3. 更新任务进度 (view_rank)
  if (currentUserId) {
      const today = new Date(new Date().getTime() + 8*3600*1000).toISOString().split('T')[0];
      // 使用 try-catch 防止任务不存在时报错影响接口返回
      try {
          await db.prepare(`UPDATE user_tasks SET progress = progress + 1 WHERE user_id = ? AND task_code = 'view_rank' AND category = 'daily' AND status = 0 AND period_key = ?`)
            .bind(currentUserId, today).run();
      } catch(e) {
          // 忽略任务更新错误
      }
  }

  return new Response(JSON.stringify({
      success: true,
      xp: results[0].results,
      sent: results[1].results,
      received: results[2].results,
      likes: results[3].results,
      coins: results[4].results // <--- 新增字段：返回财富榜数据
  }));
}
