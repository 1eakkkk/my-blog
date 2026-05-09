async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  const { username, password, turnstileToken } = await request.json();

  // 确保 login_fails / login_locked_until 列存在
  try { await db.exec('ALTER TABLE users ADD COLUMN login_fails INTEGER DEFAULT 0'); } catch (e) { }
  try { await db.exec('ALTER TABLE users ADD COLUMN login_locked_until INTEGER DEFAULT 0'); } catch (e) { }

  // Turnstile
  const setting = await db.prepare("SELECT value FROM system_settings WHERE key = 'turnstile_enabled'").first();
  if (!setting || setting.value === 'true') {
    if (!turnstileToken) return new Response(JSON.stringify({ success: false, error: '请完成人机验证' }), { status: 403 });
    const ip = request.headers.get('CF-Connecting-IP');
    const formData = new FormData();
    formData.append('secret', env.TURNSTILE_SECRET);
    formData.append('response', turnstileToken);
    formData.append('remoteip', ip);
    const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { body: formData, method: 'POST' });
    const outcome = await verifyRes.json();
    if (!outcome.success) return new Response(JSON.stringify({ success: false, error: '人机验证失败' }), { status: 403 });
  }

  // 查用户（含锁定状态）
  const user = await db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
  if (!user) {
    return new Response(JSON.stringify({ success: false, error: '账号或密码错误' }), { status: 401 });
  }

  // 检查是否被锁定
  const now = Date.now();
  if (user.login_locked_until > now) {
    const remaining = Math.ceil((user.login_locked_until - now) / 60000);
    return new Response(JSON.stringify({ success: false, error: `登录失败次数过多，请 ${remaining} 分钟后再试` }), { status: 429 });
  }

  // 验证密码 (PBKDF2)
  const [salt, storedHash] = (user.password || '').split(':');

  // 兼容旧 SHA-256 密码（无 salt 分隔符）
  let passwordMatch = false;
  if (!storedHash) {
    // 旧格式：裸 SHA-256 hex
    const myDigest = await crypto.subtle.digest({ name: 'SHA-256' }, new TextEncoder().encode(password));
    const oldHash = Array.from(new Uint8Array(myDigest)).map(b => b.toString(16).padStart(2, '0')).join('');
    if (oldHash === user.password) {
      passwordMatch = true;
      // 自动升级为 PBKDF2
      const newSalt = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
      const newHash = await hashPassword(password, newSalt);
      await db.prepare('UPDATE users SET password = ? WHERE id = ?').bind(`${newSalt}:${newHash}`, user.id).run();
    }
  } else {
    const computedHash = await hashPassword(password, salt);
    passwordMatch = computedHash === storedHash;
  }

  if (!passwordMatch) {
    // 登录失败计数
    const fails = (user.login_fails || 0) + 1;
    if (fails >= 5) {
      await db.prepare('UPDATE users SET login_fails = ?, login_locked_until = ? WHERE id = ?')
        .bind(fails, now + 15 * 60 * 1000, user.id).run();
      return new Response(JSON.stringify({ success: false, error: '登录失败次数过多，请 15 分钟后再试' }), { status: 429 });
    }
    await db.prepare('UPDATE users SET login_fails = ? WHERE id = ?').bind(fails, user.id).run();
    return new Response(JSON.stringify({ success: false, error: `账号或密码错误（还剩 ${5 - fails} 次尝试）` }), { status: 401 });
  }

  // 登录成功，重置计数
  await db.prepare('UPDATE users SET login_fails = 0, login_locked_until = 0 WHERE id = ?').bind(user.id).run();

  // 检查封禁
  if (user.status === 'banned' && user.ban_expires_at > now) {
    return new Response(JSON.stringify({ success: false, error: '账号已被封禁' }), { status: 403 });
  }

  const sessionId = crypto.randomUUID();
  await db.prepare('INSERT INTO sessions (session_id, user_id, created_at) VALUES (?, ?, ?)')
    .bind(sessionId, user.id, now).run();

  const headers = new Headers();
  headers.append('Set-Cookie', `session_id=${sessionId}; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=86400`);
  headers.append('Content-Type', 'application/json');

  return new Response(JSON.stringify({ success: true, username: user.username }), { headers });
}
