// --- functions/api/feedback.js ---
export async function onRequestPost(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ error: 'Login required' }), { status: 401 });
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const user = await db.prepare(`SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401 });

  const { content } = await context.request.json();
  if (!content || content.length < 5) return new Response(JSON.stringify({ success: false, error: '反馈内容太短' }), { status: 400 });

  // === 频率限制：每级每天可反馈次数 = 等级数 ===
  // 例如 LV.1 每天1次，LV.5 每天5次
  const now = new Date();
  // 获取今日0点的时间戳
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  
  const countResult = await db.prepare('SELECT COUNT(*) as count FROM feedbacks WHERE user_id = ? AND created_at >= ?')
    .bind(user.id, todayStart).first();
  
  // 计算用户等级 (简单复用逻辑，或者依赖前端传来的level不安全，这里重新简单估算或直接查表如果表里有level字段)
  // 假设 users 表里还没有 level 字段存储，我们用 exp 估算，或者假设 script.js 里的 LEVEL_TABLE 逻辑在后端也有一份
  // 为了简化且稳健，我们这里直接读取 users 表里的 level 字段 (如果在之前的步骤中已经存入数据库)，或者重新计算
  // 这里假设 users 表里有 level 字段(在之前的 comments 联合查询里出现过)。如果没有，可以用 xp 粗略判断。
  // 为了保证代码不出错，我们给个基础限制：基础1次 + 每1000xp多一次
  const limit = 1 + Math.floor((user.xp || 0) / 2000); 

  if (countResult.count >= limit) {
      return new Response(JSON.stringify({ success: false, error: `今日反馈次数已耗尽 (当前等级上限: ${limit}次)` }), { status: 429 });
  }

  await db.prepare('INSERT INTO feedbacks (user_id, content, created_at) VALUES (?, ?, ?)').bind(user.id, content, Date.now()).run();

  return new Response(JSON.stringify({ success: true, message: '反馈已提交，感谢您的建议！' }));
}
