// --- functions/api/auth/register.js ---
export async function onRequestPost(context) {
  const db = context.env.DB;
  const { username, password, inviteCode } = await context.request.json();

  if (!username || !password) return new Response(JSON.stringify({success:false, error:"缺信息"}), { status: 400 });

  // === 核心修改：检查开关 ===
  const setting = await db.prepare("SELECT value FROM system_settings WHERE key = 'invite_required'").first();
  const isInviteRequired = setting ? setting.value === 'true' : true;

  if (isInviteRequired) {
      if (!inviteCode) return new Response(JSON.stringify({success:false, error:"本站当前开启了邀请注册，请输入邀请码"}), { status: 400 });
      
      const invite = await db.prepare('SELECT * FROM invites WHERE code = ? AND is_used = 0').bind(inviteCode).first();
      if (!invite) return new Response(JSON.stringify({success:false, error:"邀请码无效"}), { status: 403 });
      if (invite.expires_at && invite.expires_at < Date.now()) return new Response(JSON.stringify({success:false, error:"邀请码已过期"}), { status: 403 });
  }

  const myText = new TextEncoder().encode(password);
  const myDigest = await crypto.subtle.digest({ name: 'SHA-256' }, myText);
  const hashArray = Array.from(new Uint8Array(myDigest));
  const passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  const generateKey = () => Math.random().toString(36).substring(2, 6).toUpperCase();
  const recoveryKey = `KEY-${generateKey()}-${generateKey()}-${generateKey()}`;

  try {
    const result = await db.prepare('INSERT INTO users (username, password, recovery_key, created_at, last_seen) VALUES (?, ?, ?, ?, ?)')
      .bind(username, passwordHash, recoveryKey, Date.now(), Date.now())
      .run();
    
    // 如果使用了邀请码，标记为已使用
    if (isInviteRequired && inviteCode) {
        await db.prepare('UPDATE invites SET is_used = 1, used_by = ? WHERE code = ?')
          .bind(result.meta.last_row_id, inviteCode)
          .run();
    }

    return new Response(JSON.stringify({ success: true, recoveryKey: recoveryKey }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: '用户名已存在' }), { status: 409 });
  }
}
