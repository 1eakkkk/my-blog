// --- functions/api/profile_public.js ---
export async function onRequestGet(context) {
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const targetUsername = url.searchParams.get('u');

  // 获取当前查看者的ID (用于判断是否已关注)
  const cookie = context.request.headers.get('Cookie');
  let currentUserId = null;
  if (cookie && cookie.includes('session_id')) {
      const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
      const u = await db.prepare('SELECT user_id FROM sessions WHERE session_id = ?').bind(sessionId).first();
      if(u) currentUserId = u.user_id;
  }

  if (!targetUsername) return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404 });

  // 1. 获取基本信息
  const user = await db.prepare(`
    SELECT id, username, nickname, avatar_variant, bio, role, custom_title, is_vip, xp, created_at 
    FROM users WHERE username = ?
  `).bind(targetUsername).first();

  if (!user) return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404 });

  if (currentUserId && user.id !== currentUserId) {
      const today = new Date(new Date().getTime() + 8*3600*1000).toISOString().split('T')[0];
      // 使用 waitUntil 异步执行，不拖慢页面加载速度
      context.waitUntil(
          db.prepare(`UPDATE user_tasks SET progress = progress + 1 WHERE user_id = ? AND task_code = 'profile_visit' AND category = 'daily' AND status = 0 AND period_key = ?`)
            .bind(currentUserId, today).run()
      );
  }

  // 2. 获取统计数据
  const stats = await db.batch([
      // 发布的帖子数
      db.prepare('SELECT COUNT(*) as c FROM posts WHERE user_id = ?').bind(user.id),
      // 获得的赞
      db.prepare('SELECT COUNT(*) as c FROM likes WHERE target_type = "post" AND target_id IN (SELECT id FROM posts WHERE user_id = ?)').bind(user.id),
      // 关注了多少人
      db.prepare('SELECT COUNT(*) as c FROM follows WHERE follower_id = ?').bind(user.id),
      // 有多少粉丝
      db.prepare('SELECT COUNT(*) as c FROM follows WHERE following_id = ?').bind(user.id),
      // 当前用户是否关注了TA
      db.prepare('SELECT COUNT(*) as c FROM follows WHERE follower_id = ? AND following_id = ?').bind(currentUserId, user.id)
  ]);

  // 3. 获取最近动态 (最近发布的5个帖子)
  const recentPosts = await db.prepare(`
      SELECT id, title, created_at, category FROM posts WHERE user_id = ? ORDER BY created_at DESC LIMIT 5
  `).bind(user.id).all();

  return new Response(JSON.stringify({
      success: true,
      user: user,
      stats: {
          posts: stats[0].results[0].c,
          likes: stats[1].results[0].c,
          following: stats[2].results[0].c,
          followers: stats[3].results[0].c,
          isFollowing: stats[4].results[0].c > 0
      },
      recentPosts: recentPosts.results
  }));
}
