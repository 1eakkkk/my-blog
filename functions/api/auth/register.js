// --- functions/api/auth/register.js ---
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  const { username, password, inviteCode, turnstileToken } = await request.json();

  if (!username || !password) return new Response(JSON.stringify({success:false, error:"缺信息"}), { status: 400 });

  // 1. 验证 Turnstile
  const setting = await db.prepare("SELECT value FROM system_settings WHERE key = 'turnstile_enabled'").first();
  const isTurnstileEnabled = setting ? setting.value === 'true' : true;
  const ip = request.headers.get('CF-Connecting-IP');
  const formData = new FormData();
  formData.append('secret', env.TURNSTILE_SECRET);
  formData.append('response', turnstileToken);
  formData.append('remoteip', ip);

  const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { body: formData, method: 'POST' });
  const outcome = await verifyRes.json();
  
  if (isTurnstileEnabled) {
      if (!outcome.success) {
    return new Response(JSON.stringify({ success: false, error: '人机验证失败' }), { status: 403 });
      }  
      if (!turnstileToken) return new Response(JSON.stringify({ success: false, error: '请完成验证' }), { status: 403 });
      // ... fetch verify ...
  }

  // 2. 邀请码逻辑
  const setting = await db.prepare("SELECT value FROM system_settings WHERE key = 'invite_required'").first();
  const isInviteRequired = setting ? setting.value === 'true' : true;

  if (isInviteRequired) {
      if (!inviteCode) return new Response(JSON.stringify({success:false, error:"请输入邀请码"}), { status: 400 });
      const invite = await db.prepare('SELECT * FROM invites WHERE code = ? AND is_used = 0').bind(inviteCode).first();
      if (!invite) return new Response(JSON.stringify({success:false, error:"邀请码无效"}), { status: 403 });
      if (invite.expires_at && invite.expires_at < Date.now()) return new Response(JSON.stringify({success:false, error:"邀请码已过期"}), { status: 403 });
  }

  // 3. 注册逻辑
  const myText = new TextEncoder().encode(password);
  const myDigest = await crypto.subtle.digest({ name: 'SHA-256' }, myText);
  const passwordHash = Array.from(new Uint8Array(myDigest)).map(b => b.toString(16).padStart(2, '0')).join('');
  
  const generateKey = () => Math.random().toString(36).substring(2, 6).toUpperCase();
  const recoveryKey = `KEY-${generateKey()}-${generateKey()}-${generateKey()}`;

  try {
    const result = await db.prepare('INSERT INTO users (username, password, recovery_key, created_at, last_seen) VALUES (?, ?, ?, ?, ?)')
      .bind(username, passwordHash, recoveryKey, Date.now(), Date.now())
      .run();
    
    if (isInviteRequired && inviteCode) {
        await db.prepare('UPDATE invites SET is_used = 1, used_by = ? WHERE code = ?')
          .bind(result.meta.last_row_id, inviteCode).run();
    }

    return new Response(JSON.stringify({ success: true, recoveryKey: recoveryKey }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: '用户名已存在' }), { status: 409 });
  }
}

