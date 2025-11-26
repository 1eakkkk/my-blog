// --- functions/api/auth/register.js ---
export async function onRequestPost(context) {
  const db = context.env.DB;
  // 接收 inviteCode
  const { username, password, inviteCode } = await context.request.json();

  if (!username || !password) return new Response(JSON.stringify({success:false, error:"缺信息"}), { status: 400 });

  // === 核心：验证邀请码 ===
  if (!inviteCode) return new Response(JSON.stringify({success:false, error:"需要邀请码"}), { status: 400 });
  
  const invite = await db.prepare('SELECT * FROM invites WHERE code = ? AND is_used = 0').bind(inviteCode).first();
  // 检查是否存在及是否过期
  if (!invite) {
      return new Response(JSON.stringify({success:false, error:"邀请码无效"}), { status: 403 });
  }
  if (invite.expires_at && invite.expires_at < Date.now()) {
      return new Response(JSON.stringify({success:false, error:"邀请码已过期"}), { status: 403 });
  }

  const myText = new TextEncoder().encode(password);
  const myDigest = await crypto.subtle.digest({ name: 'SHA-256' }, myText);
  const hashArray = Array.from(new Uint8Array(myDigest));
  const passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  const generateKey = () => Math.random().toString(36).substring(2, 6).toUpperCase();
  const recoveryKey = `KEY-${generateKey()}-${generateKey()}-${generateKey()}`;

  try {
    // 插入用户
    const result = await db.prepare('INSERT INTO users (username, password, recovery_key, created_at) VALUES (?, ?, ?, ?)')
      .bind(username, passwordHash, recoveryKey, Date.now())
      .run();
    
    // 标记邀请码为已使用
    // 注意：result.meta.last_row_id 获取新用户的 ID
    await db.prepare('UPDATE invites SET is_used = 1, used_by = ? WHERE code = ?')
      .bind(result.meta.last_row_id, inviteCode)
      .run();

    return new Response(JSON.stringify({ success: true, recoveryKey: recoveryKey }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: '用户名已存在' }), { status: 409 });
  }
}

