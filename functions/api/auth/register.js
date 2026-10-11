import { json, readJson, verifyTurnstile } from '../_lib.js';

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  let { username, password, turnstileToken } = await readJson(request);
  if (typeof username !== 'string' || typeof password !== 'string') return json({ success: false, error: '账号或密码格式无效' }, { status: 400 });
  username = username.trim();

  if (!username || !password) return new Response(JSON.stringify({ success: false, error: '信息不完整' }), { status: 400 });
  if (username.length < 2 || username.length > 20) return new Response(JSON.stringify({ success: false, error: '用户名2-20个字符' }), { status: 400 });
  if (password.length < 6) return new Response(JSON.stringify({ success: false, error: '密码至少6位' }), { status: 400 });
  if (password.length > 128) return json({ success: false, error: '密码最多128位' }, { status: 400 });
  if (!/^[\u4e00-\u9fa5a-zA-Z0-9_-]+$/.test(username)) return new Response(JSON.stringify({ success: false, error: '用户名只能包含中文、字母、数字、下划线和连字符' }), { status: 400 });

  // Turnstile 验证
  const verificationError = await verifyTurnstile(context, turnstileToken);
  if (verificationError) return verificationError;

  // PBKDF2 哈希
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
  const hash = await hashPassword(password, salt);
  const passwordStore = `${salt}:${hash}`;

  try {
    await db.prepare('INSERT INTO users (username, password, created_at, last_seen) VALUES (?, ?, ?, ?)')
      .bind(username, passwordStore, Date.now(), Date.now()).run();

    return new Response(JSON.stringify({
      success: true,
      message: '注册成功！'
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    if (!/UNIQUE constraint failed:\s*users\.username/i.test(String(e.message))) throw e;
    return new Response(JSON.stringify({ success: false, error: '用户名已存在' }), { status: 409 });
  }
}
