export async function onRequestPost(context) {
  const db = context.env.DB;
  const { username, password } = await context.request.json();

  if (!username || !password) {
    return new Response("缺少用户名或密码", { status: 400 });
  }

  // 简单的密码哈希处理 (在真实生产环境中建议用 bcrypt，这里用 Web Crypto API 保持无依赖)
  const myText = new TextEncoder().encode(password);
  const myDigest = await crypto.subtle.digest({ name: 'SHA-256' }, myText);
  const hashArray = Array.from(new Uint8Array(myDigest));
  const passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  try {
    await db.prepare('INSERT INTO users (username, password, created_at) VALUES (?, ?, ?)')
      .bind(username, passwordHash, Date.now())
      .run();
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: '用户名已存在' }), { status: 409 });
  }
}