// --- functions/api/auth/login.js ---

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  const { username, password, turnstileToken } = await request.json();

  // 1. 检查开关配置
  const setting = await db.prepare("SELECT value FROM system_settings WHERE key = 'turnstile_enabled'").first();
  const isTurnstileEnabled = setting ? setting.value === 'true' : true; // 默认开启

  // 2. 只有开启时，才执行验证逻辑
  if (isTurnstileEnabled) {
      // 2.1 先检查有没有 Token (前端是否传了)
      if (!turnstileToken) {
          return new Response(JSON.stringify({ success: false, error: '请完成人机验证' }), { status: 403 });
      }

      // 2.2 准备数据
      const ip = request.headers.get('CF-Connecting-IP');
      const formData = new FormData();
      formData.append('secret', env.TURNSTILE_SECRET);
      formData.append('response', turnstileToken);
      formData.append('remoteip', ip);

      // 2.3 发起请求
      const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { 
          body: formData, 
          method: 'POST' 
      });
      const outcome = await verifyRes.json();

      // 2.4 检查结果
      if (!outcome.success) {
          return new Response(JSON.stringify({ success: false, error: '人机验证失败' }), { status: 403 });
      }
  }

  // 2. 密码哈希
  const myText = new TextEncoder().encode(password);
  const myDigest = await crypto.subtle.digest({ name: 'SHA-256' }, myText);
  const hashArray = Array.from(new Uint8Array(myDigest));
  const passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  // 3. 查用户
  const user = await db.prepare('SELECT * FROM users WHERE username = ? AND password = ?')
    .bind(username, passwordHash)
    .first();

  if (!user) {
    return new Response(JSON.stringify({ success: false, error: '账号或密码错误' }), { status: 401 });
  }
  
  // 检查封禁
  if (user.status === 'banned' && user.ban_expires_at > Date.now()) {
      return new Response(JSON.stringify({ success: false, error: '账号已被封禁' }), { status: 403 });
  }

  // 4. 生成 Session
  const sessionId = crypto.randomUUID();
  await db.prepare('INSERT INTO sessions (session_id, user_id, created_at) VALUES (?, ?, ?)')
    .bind(sessionId, user.id, Date.now())
    .run();

  const headers = new Headers();
  headers.append('Set-Cookie', `session_id=${sessionId}; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=86400`);
  headers.append('Content-Type', 'application/json');

  return new Response(JSON.stringify({ success: true, username: user.username }), { headers });
}

