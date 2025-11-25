export async function onRequestPost(context) {
  // 从上下文中获取数据库连接 (DB 是我们稍后绑定的名字)
  const db = context.env.DB;

  // 假设当前用户是 'visitor_007' (实际项目中这里需要做登录验证，现在简化处理)
  const username = 'visitor_007';
  const today = new Date().toDateString();

  // 1. 查询用户当前状态
  const user = await db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();

  if (!user) {
    return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404 });
  }

  // 2. 检查是否签到
  if (user.last_check_in === today) {
    return new Response(JSON.stringify({ 
      success: false, 
      message: '今日已签到', 
      coins: user.coins 
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  // 3. 更新数据库：加10个币，更新日期
  const newCoins = user.coins + 10;
  await db.prepare('UPDATE users SET coins = ?, last_check_in = ? WHERE username = ?')
    .bind(newCoins, today, username)
    .run();

  // 4. 返回最新结果给前端
  return new Response(JSON.stringify({ 
    success: true, 
    message: '签到成功 +10', 
    coins: newCoins 
  }), { headers: { 'Content-Type': 'application/json' } });
}

// 获取数据的接口 (GET)
export async function onRequestGet(context) {
    const db = context.env.DB;
    const username = 'visitor_007';
    const user = await db.prepare('SELECT coins FROM users WHERE username = ?').bind(username).first();
    return new Response(JSON.stringify(user || { coins: 0 }), { headers: { 'Content-Type': 'application/json' } });
}