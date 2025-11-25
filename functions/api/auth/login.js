// --- functions/api/auth/login.js ---

export async function onRequestPost(context) {
  const db = context.env.DB;
  const { username, password } = await context.request.json();

  // 1. 密码哈希
  const myText = new TextEncoder().encode(password);
  const myDigest = await crypto.subtle.digest({ name: 'SHA-256' }, myText);
  const hashArray = Array.from(new Uint8Array(myDigest));
  const passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  // 2. 查用户
  const user = await db.prepare('SELECT * FROM users WHERE username = ? AND password = ?')
    .bind(username, passwordHash)
    .first();

  if (!user) {
    return new Response(JSON.stringify({ success: false, error: '账号或密码错误' }), { status: 401 });
  }

  // 3. 生成 Session ID
  const sessionId = crypto.randomUUID();
  
  // 4. 存入数据库 (如果这一步报错，前端会提示错误)
  await db.prepare('INSERT INTO sessions (session_id, user_id, created_at) VALUES (?, ?, ?)')
    .bind(sessionId, user.id, Date.now())
    .run();

  // 5. 设置 Cookie (关键修复：增加 Secure; SameSite=None)
  const headers = new Headers();
  // 注意：Max-Age=86400 是一天
  headers.append('Set-Cookie', `session_id=${sessionId}; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=86400`);
  headers.append('Content-Type', 'application/json');

  return new Response(JSON.stringify({ success: true, username: user.username }), { headers });
}
