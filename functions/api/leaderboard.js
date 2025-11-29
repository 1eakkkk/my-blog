// --- functions/api/leaderboard.js ---
export async function onRequestGet(context) {
  const db = context.env.DB;

  // 查询四个榜单，每个取前10名
  const results = await db.batch([
      // 1. 等级榜 (XP)
      db.prepare('SELECT username, nickname, avatar_variant, xp, level, is_vip, custom_title, custom_title_color FROM users ORDER BY xp DESC LIMIT 10'),
      
      // 2. 壕气榜 (打赏支出)
      db.prepare('SELECT username, nickname, avatar_variant, tips_sent, is_vip FROM users WHERE tips_sent > 0 ORDER BY tips_sent DESC LIMIT 10'),
      
      // 3. 人气榜 (收到打赏)
      db.prepare('SELECT username, nickname, avatar_variant, tips_received, is_vip FROM users WHERE tips_received > 0 ORDER BY tips_received DESC LIMIT 10'),
      
      // 4. 获赞榜 (收到点赞)
      db.prepare('SELECT username, nickname, avatar_variant, likes_received, is_vip FROM users WHERE likes_received > 0 ORDER BY likes_received DESC LIMIT 10')
  ]);

  return new Response(JSON.stringify({
      success: true,
      xp: results[0].results,
      sent: results[1].results,
      received: results[2].results,
      likes: results[3].results
  }));
}
