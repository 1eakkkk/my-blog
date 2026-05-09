const WORDS = ['蓝天','白云','青山','绿水','红日','明月','星辰','大海','春风','夏雨','秋霜','冬雪','金鱼','银河','彩虹','流星','晨曦','晚霞','飞鸟','游鱼','苍松','翠竹','梅花','兰花','清泉','灵石','龙腾','凤舞','虎啸','鹤鸣'];

function generateRecoveryPhrase() {
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)];
  return `${pick()}-${pick()}-${pick()}-${pick()}`;
}

export async function onRequestGet(context) {
  const db = context.env.DB;
  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ error: '请先登录' }), { status: 401 });
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare('SELECT recovery_key FROM users JOIN sessions ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ error: '无效会话' }), { status: 401 });

  return new Response(JSON.stringify({ recoveryPhrase: user.recovery_key }), { headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  const reqBody = await context.request.json();
  const { nickname, badge_preference, bio, avatar_url, regenerate_recovery } = reqBody;

  const cookie = context.request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ success: false, error: '请先登录' }), { status: 401 });
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare(`SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ success: false, error: '无效会话' }), { status: 401 });

  // 重生成恢复短语
  if (regenerate_recovery) {
    const newPhrase = generateRecoveryPhrase();
    await db.prepare('UPDATE users SET recovery_key = ? WHERE id = ?').bind(newPhrase, user.id).run();
    return new Response(JSON.stringify({ success: true, recoveryPhrase: newPhrase, message: '恢复短语已更新，请妥善保存' }));
  }

  if (nickname !== undefined) {
    if (!nickname || nickname.length > 12) return new Response(JSON.stringify({ success: false, error: '昵称无效' }), { status: 400 });
    await db.prepare('UPDATE users SET nickname = ? WHERE id = ?').bind(nickname, user.id).run();
    return new Response(JSON.stringify({ success: true, message: '昵称已更新' }));
  }

  if (avatar_url !== undefined) {
    await db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(avatar_url, user.id).run();
    return new Response(JSON.stringify({ success: true, message: '头像已更新' }));
  }

  if (badge_preference !== undefined) {
    await db.prepare('UPDATE users SET badge_preference = ? WHERE id = ?').bind(badge_preference, user.id).run();
    return new Response(JSON.stringify({ success: true, message: '偏好已保存' }));
  }

  if (bio !== undefined) {
    if (bio.length > 50) return new Response(JSON.stringify({ success: false, error: '签名太长了 (限50字)' }), { status: 400 });
    await db.prepare('UPDATE users SET bio = ? WHERE id = ?').bind(bio, user.id).run();
    return new Response(JSON.stringify({ success: true, message: '签名已更新' }));
  }

  return new Response(JSON.stringify({ success: false, error: '无操作' }));
}
