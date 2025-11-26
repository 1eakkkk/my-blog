// --- functions/api/auth/reset.js ---
export async function onRequestPost(context) {
  const db = context.env.DB;
  const { username, recoveryKey, newPassword } = await context.request.json();

  if (!username || !recoveryKey || !newPassword) {
    return new Response(JSON.stringify({ success: false, error: '信息不完整' }), { status: 400 });
  }

  // 1. 验证密钥是否匹配
  const user = await db.prepare('SELECT id FROM users WHERE username = ? AND recovery_key = ?')
    .bind(username, recoveryKey)
    .first();

  if (!user) {
    return new Response(JSON.stringify({ success: false, error: '用户名或恢复密钥错误' }), { status: 403 });
  }

  // 2. 加密新密码
  const myText = new TextEncoder().encode(newPassword);
  const myDigest = await crypto.subtle.digest({ name: 'SHA-256' }, myText);
  const hashArray = Array.from(new Uint8Array(myDigest));
  const passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  // 3. 更新密码 (为了安全，重置后可以自动生成新密钥，这里暂保持不变简化逻辑)
  await db.prepare('UPDATE users SET password = ? WHERE id = ?')
    .bind(passwordHash, user.id)
    .run();

  return new Response(JSON.stringify({ success: true, message: '密码重置成功，请重新登录' }), { headers: { 'Content-Type': 'application/json' } });
}
