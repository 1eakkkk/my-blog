export async function onRequestPost(context) {
  const db = context.env.DB;
  
  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: false, error: '请先登录' }), { status: 401 });
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const user = await db.prepare(`SELECT id, username, nickname FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

  const { target_id, target_type } = await context.request.json(); // type: 'post' or 'comment'

  // 1. 检查是否已经点赞
  const existing = await db.prepare('SELECT id FROM likes WHERE user_id = ? AND target_id = ? AND target_type = ?')
    .bind(user.id, target_id, target_type).first();

  let isLiked = false;
  let change = 0;

  if (existing) {
    await db.prepare('DELETE FROM likes WHERE id = ?').bind(existing.id).run();
    change = -1;
    isLiked = false;
  } else {
    await db.prepare('INSERT INTO likes (user_id, target_id, target_type, created_at) VALUES (?, ?, ?, ?)')
      .bind(user.id, target_id, target_type, Date.now()).run();
    change = 1;
    isLiked = true;

    // === 新增：给被点赞的人发通知 ===
    // 先查出被点赞内容的主人
    let ownerSql = '';
    let link = '';
    let msgPrefix = '';
    
    if (target_type === 'post') {
        ownerSql = 'SELECT user_id, title FROM posts WHERE id = ?';
        link = `#post?id=${target_id}`;
        msgPrefix = '文章';
    } else {
        ownerSql = 'SELECT user_id, content FROM comments WHERE id = ?';
        link = `#post?id=`; // 评论跳转比较复杂，暂跳首页或以后优化定位
        msgPrefix = '评论';
    }

    const targetObj = await db.prepare(ownerSql).bind(target_id).first();
    
    if (targetObj && targetObj.user_id !== user.id) {
        const senderName = user.nickname || user.username;
        const msg = `${senderName} 点赞了你的${msgPrefix}`;
        await db.prepare('INSERT INTO notifications (user_id, type, message, link, created_at) VALUES (?, ?, ?, ?, ?)')
            .bind(targetObj.user_id, 'like', msg, link, Date.now())
            .run();
    }
  }

  const table = target_type === 'post' ? 'posts' : 'comments';
  await db.prepare(`UPDATE ${table} SET like_count = like_count + ? WHERE id = ?`).bind(change, target_id).run();
  const count = await db.prepare(`SELECT like_count FROM ${table} WHERE id = ?`).bind(target_id).first();

  return new Response(JSON.stringify({ success: true, isLiked, count: count.like_count }));
}
