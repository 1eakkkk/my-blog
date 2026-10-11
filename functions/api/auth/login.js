import { json, readJson, verifyTurnstile, isBanned } from '../_lib.js';

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  const { username, password, turnstileToken } = await readJson(request);
  if (typeof username !== 'string' || username.length < 2 || username.length > 20 || typeof password !== 'string' || !password) return json({ success: false, error: '账号或密码格式无效' }, { status: 400 });

  // Turnstile
  const verificationError = await verifyTurnstile(context, turnstileToken);
  if (verificationError) return verificationError;

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
    // 单条 UPDATE 原子计数与设锁，避免并发请求都基于同一个旧计数覆盖。
    const state = await db.prepare(`UPDATE users SET
      login_fails = CASE WHEN login_locked_until > 0 AND login_locked_until <= ? THEN 1 ELSE COALESCE(login_fails, 0) + 1 END,
      login_locked_until = CASE
        WHEN login_locked_until > ? THEN login_locked_until
        WHEN (CASE WHEN login_locked_until > 0 AND login_locked_until <= ? THEN 1 ELSE COALESCE(login_fails, 0) + 1 END) >= 5 THEN ?
        ELSE 0 END
      WHERE id = ? RETURNING login_fails, login_locked_until`)
      .bind(now, now, now, now + 15 * 60 * 1000, user.id).first();
    if (state.login_locked_until > now) {
      return new Response(JSON.stringify({ success: false, error: '登录失败次数过多，请 15 分钟后再试' }), { status: 429 });
    }
    return new Response(JSON.stringify({ success: false, error: `账号或密码错误（还剩 ${5 - state.login_fails} 次尝试）` }), { status: 401 });
  }

  // 登录成功，重置计数
  await db.prepare('UPDATE users SET login_fails = 0, login_locked_until = 0 WHERE id = ?').bind(user.id).run();

  // 检查封禁
  if (isBanned(user, now)) {
    return new Response(JSON.stringify({ success: false, error: '账号已被封禁' }), { status: 403 });
  }

  const sessionId = crypto.randomUUID();
  await db.prepare('INSERT INTO sessions (session_id, user_id, created_at) VALUES (?, ?, ?)')
    .bind(sessionId, user.id, now).run();

  const headers = new Headers();
  headers.append('Set-Cookie', `session_id=${sessionId}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=604800`);
  headers.append('Content-Type', 'application/json');
  headers.append('Cache-Control', 'no-store');

  return new Response(JSON.stringify({ success: true, username: user.username }), { headers });
}
