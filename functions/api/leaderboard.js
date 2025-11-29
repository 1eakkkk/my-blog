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

  // 2. 原有的查询逻辑 (保持不变)
  const results = await db.batch([
      db.prepare('SELECT username, nickname, avatar_variant, xp, level, is_vip, custom_title, custom_title_color FROM users ORDER BY xp DESC LIMIT 10'),
      db.prepare('SELECT username, nickname, avatar_variant, tips_sent, is_vip FROM users WHERE tips_sent > 0 ORDER BY tips_sent DESC LIMIT 10'),
      db.prepare('SELECT username, nickname, avatar_variant, tips_received, is_vip FROM users WHERE tips_received > 0 ORDER BY tips_received DESC LIMIT 10'),
      db.prepare('SELECT username, nickname, avatar_variant, likes_received, is_vip FROM users WHERE likes_received > 0 ORDER BY likes_received DESC LIMIT 10')
  ]);

  // 3. === 新增：更新任务进度 (view_rank) ===
  if (currentUserId) {
      // 只有登录用户才记录任务
      const today = new Date(new Date().getTime() + 8*3600*1000).toISOString().split('T')[0];
      await db.prepare(`UPDATE user_tasks SET progress = progress + 1 WHERE user_id = ? AND task_code = 'view_rank' AND category = 'daily' AND status = 0 AND period_key = ?`)
        .bind(currentUserId, today).run();
  }
  // =======================================

  return new Response(JSON.stringify({
      success: true,
      xp: results[0].results,
      sent: results[1].results,
      received: results[2].results,
      likes: results[3].results
  }));
}
