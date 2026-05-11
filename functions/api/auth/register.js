const WORDS = ['蓝天','白云','青山','绿水','红日','明月','星辰','大海','春风','夏雨','秋霜','冬雪','金鱼','银河','彩虹','流星','晨曦','晚霞','飞鸟','游鱼','苍松','翠竹','梅花','兰花','清泉','灵石','龙腾','凤舞','虎啸','鹤鸣'];

function generateRecoveryPhrase() {
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)];
  return `${pick()}-${pick()}-${pick()}-${pick()}`;
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  const { username, password, turnstileToken } = await request.json();

  if (!username || !password) return new Response(JSON.stringify({ success: false, error: '信息不完整' }), { status: 400 });
  if (username.length < 2 || username.length > 20) return new Response(JSON.stringify({ success: false, error: '用户名2-20个字符' }), { status: 400 });
  if (password.length < 6) return new Response(JSON.stringify({ success: false, error: '密码至少6位' }), { status: 400 });
  if (!/^[\u4e00-\u9fa5a-zA-Z0-9_-]+$/.test(username)) return new Response(JSON.stringify({ success: false, error: '用户名只能包含中文、字母、数字、下划线和连字符' }), { status: 400 });

  // Turnstile 验证
  const tsSetting = await db.prepare("SELECT value FROM system_settings WHERE key = 'turnstile_enabled'").first();
  const isTurnstileEnabled = tsSetting ? tsSetting.value === 'true' : true;
  if (isTurnstileEnabled) {
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

  // PBKDF2 哈希
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
  const hash = await hashPassword(password, salt);
  const passwordStore = `${salt}:${hash}`;
  const recoveryPhrase = generateRecoveryPhrase();

  try {
    await db.prepare('INSERT INTO users (username, password, recovery_key, created_at, last_seen) VALUES (?, ?, ?, ?, ?)')
      .bind(username, passwordStore, recoveryPhrase, Date.now(), Date.now()).run();

    return new Response(JSON.stringify({
      success: true,
      recoveryPhrase: recoveryPhrase,
      message: '注册成功！请保存恢复短语，忘记密码时需要使用。'
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: '用户名已存在' }), { status: 409 });
  }
}
