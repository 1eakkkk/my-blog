async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  const { username, recoveryKey, newPassword } = await context.request.json();

  if (!username || !recoveryKey || !newPassword) {
    return new Response(JSON.stringify({ success: false, error: '信息不完整' }), { status: 400 });
  }
  if (newPassword.length < 6) {
    return new Response(JSON.stringify({ success: false, error: '新密码至少6位' }), { status: 400 });
  }

  // 验证恢复短语
  const user = await db.prepare('SELECT id, recovery_key FROM users WHERE username = ?')
    .bind(username).first();
  if (!user || user.recovery_key !== recoveryKey) {
    return new Response(JSON.stringify({ success: false, error: '用户名或恢复短语错误' }), { status: 403 });
  }

  // PBKDF2 哈希新密码
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
  const hash = await hashPassword(newPassword, salt);
  const passwordStore = `${salt}:${hash}`;

  await db.prepare('UPDATE users SET password = ?, login_fails = 0, login_locked_until = 0 WHERE id = ?')
    .bind(passwordStore, user.id).run();

  return new Response(JSON.stringify({ success: true, message: '密码重置成功，请重新登录' }), { headers: { 'Content-Type': 'application/json' } });
}
