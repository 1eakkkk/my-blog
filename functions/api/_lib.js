// 公共工具模块（文件名以 _ 开头，Pages Functions 不会为它生成路由）
// 所有 API 的鉴权和 JSON 响应统一走这里，改一处即可全局生效。

const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 会话有效期 7 天
const MAX_JSON_BYTES = 256 * 1024;

export class ApiError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// 对无 Content-Length 的分块请求也限制体积；所有写接口仅接受 JSON 对象。
export async function readJson(request) {
  if (!request.body) throw new ApiError('请求内容无效');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JSON_BYTES) { await reader.cancel(); throw new ApiError('请求内容过大', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new ApiError('JSON 格式无效'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('请求内容无效');
  return value;
}

export function positiveId(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  return /^(?:[1-9]\d*)$/.test(String(value ?? '')) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
}

export function isBanned(user, now = Date.now()) {
  return user?.status === 'banned' && (!user.ban_expires_at || Number(user.ban_expires_at) > now);
}

// Turnstile 必须由服务端验证，拒绝其他 hostname 获得的 token。
export async function verifyTurnstile(context, token) {
  const setting = await context.env.DB.prepare("SELECT value FROM system_settings WHERE key = 'turnstile_enabled'").first();
  if (setting?.value === 'false') return null;
  if (typeof token !== 'string' || !token || token.length > 2048) return json({ success: false, error: '请完成人机验证' }, { status: 403 });
  if (!context.env.TURNSTILE_SECRET) return json({ success: false, error: '人机验证暂时不可用' }, { status: 503 });
  const formData = new FormData();
  formData.append('secret', context.env.TURNSTILE_SECRET);
  formData.append('response', token);
  const ip = context.request.headers.get('CF-Connecting-IP');
  if (ip) formData.append('remoteip', ip);
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { body: formData, method: 'POST' });
    if (!response.ok) return json({ success: false, error: '人机验证暂时不可用' }, { status: 503 });
    const outcome = await response.json();
    if (!outcome.success || outcome.hostname !== new URL(context.request.url).hostname) return json({ success: false, error: '人机验证失败' }, { status: 403 });
    return null;
  } catch { return json({ success: false, error: '人机验证暂时不可用' }, { status: 503 }); }
}

// 统一 JSON 响应
export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Server-Time': String(Date.now()),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      ...(init.headers || {})
    }
  });
}

// 从 Cookie 中提取 session_id（统一用正则，避免 split 写法在边界情况下崩溃）
export function getSessionId(request) {
  const cookie = request.headers.get('Cookie') || '';
  return cookie.match(/(?:^|;\s*)session_id=([^;]+)/)?.[1] || null;
}

// 获取当前登录用户；未登录或会话已过期返回 null
// 注意：SQL 里带了 sessions.created_at 过期校验，不再依赖后台清理任务
export async function getUser(context) {
  const sessionId = getSessionId(context.request);
  if (!sessionId) return null;

  const minCreatedAt = Date.now() - SESSION_MAX_AGE;
  let user = await context.env.DB.prepare(
    `SELECT users.* FROM sessions
     JOIN users ON sessions.user_id = users.id
     WHERE sessions.session_id = ? AND sessions.created_at > ?`
  ).bind(sessionId, minCreatedAt).first();

  if (!user) return null;
  delete user.password; // 永远不把密码哈希带出这个函数
  // 到期状态在鉴权时统一处理，不依赖先访问 /api/user 才能解封。
  if (user.status === 'banned' && Number(user.ban_expires_at) > 0 && Number(user.ban_expires_at) <= Date.now()) {
    const result = await context.env.DB.prepare("UPDATE users SET status = 'active', ban_expires_at = 0, ban_reason = NULL WHERE id = ? AND status = 'banned' AND ban_expires_at = ?")
      .bind(user.id, user.ban_expires_at).run();
    if (result.meta.changes > 0) {
      user.status = 'active'; user.ban_expires_at = 0; user.ban_reason = null;
    } else {
      // 管理员可能刚重新封禁：不能使用旧快照覆盖新状态。
      user = await context.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
      if (!user) return null;
      delete user.password;
    }
  }
  return user;
}
