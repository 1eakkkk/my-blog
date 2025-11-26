// --- functions/api/auth/register.js ---
export async function onRequestPost(context) {
  const db = context.env.DB;
  const { username, password } = await context.request.json();

  if (!username || !password) {
    return new Response("缺少用户名或密码", { status: 400 });
  }

  // 密码加密
  const myText = new TextEncoder().encode(password);
  const myDigest = await crypto.subtle.digest({ name: 'SHA-256' }, myText);
  const hashArray = Array.from(new Uint8Array(myDigest));
  const passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  // 生成恢复密钥 (格式: XXXX-XXXX-XXXX)
  const generateKey = () => Math.random().toString(36).substring(2, 6).toUpperCase();
  const recoveryKey = `KEY-${generateKey()}-${generateKey()}-${generateKey()}`;

  try {
    await db.prepare('INSERT INTO users (username, password, recovery_key, created_at) VALUES (?, ?, ?, ?)')
      .bind(username, passwordHash, recoveryKey, Date.now())
      .run();
    
    // 返回密钥给前端
    return new Response(JSON.stringify({ success: true, recoveryKey: recoveryKey }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: '用户名已存在' }), { status: 409 });
  }
}
