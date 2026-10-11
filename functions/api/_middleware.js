import { json, getUser, isBanned, ApiError } from './_lib.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function secureResponse(response) {
  const secured = new Response(response.body, response);
  secured.headers.set('X-Content-Type-Options', 'nosniff');
  secured.headers.set('X-Frame-Options', 'DENY');
  secured.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  secured.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  secured.headers.set('Cache-Control', 'no-store');
  if (!secured.headers.has('X-Server-Time')) secured.headers.set('X-Server-Time', String(Date.now()));
  return secured;
}

async function handle(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  // 前端本来就需要登录才能阅读，服务端同步落实这条隐私边界。
  const publicRoute = ['/api/user', '/api/config'].includes(url.pathname) || url.pathname.startsWith('/api/auth/');
  if (!publicRoute && request.method !== 'OPTIONS') {
    const user = await getUser(context);
    if (!user) return json({ success: false, error: '请先登录' }, { status: 401 });
    if (isBanned(user)) return json({ success: false, error: '账号封禁中' }, { status: 403 });
  }
  if (SAFE_METHODS.has(request.method)) return context.next();

  // SameSite=Lax 不隔离同一主域下的其他站点，Origin 必须精确同源。
  const origin = request.headers.get('Origin');
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if ((origin !== null && origin !== url.origin) || (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none')) {
    return json({ success: false, error: '请求来源无效' }, { status: 403 });
  }

  const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const isUpload = url.pathname === '/api/upload';
  if (request.body && contentType !== (isUpload ? 'multipart/form-data' : 'application/json')) {
    return json({ success: false, error: '请求格式不支持' }, { status: 415 });
  }
  const maxBytes = isUpload ? 51 * 1024 * 1024 : 256 * 1024;
  if (Number(request.headers.get('Content-Length')) > maxBytes) {
    return json({ success: false, error: '请求内容过大' }, { status: 413 });
  }

  // KV 为尽力而为的防刷；登录失败锁定另由数据库落实。
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const scope = url.pathname.startsWith('/api/auth/') ? 'auth' : isUpload ? 'upload' : 'write';
  const limit = scope === 'auth' ? 20 : scope === 'upload' ? 15 : 180;
  try {
    if (env.KV) {
      const key = `rate:${scope}:${ip}:${Math.floor(Date.now() / 60000)}`;
      const count = Number(await env.KV.get(key)) || 0;
      if (count >= limit) return json({ success: false, error: '操作太频繁，请稍后再试' }, { status: 429, headers: { 'Retry-After': '60' } });
      await env.KV.put(key, String(count + 1), { expirationTtl: 120 });
    }
  } catch (error) { console.error('Rate limit KV error:', error); }
  return context.next();
}

export async function onRequest(context) {
  try { return secureResponse(await handle(context)); }
  catch (error) {
    if (error instanceof ApiError) return secureResponse(json({ success: false, error: error.message }, { status: error.status }));
    if (error instanceof SyntaxError) return secureResponse(json({ success: false, error: 'JSON 格式无效' }, { status: 400 }));
    console.error('API request failed:', error);
    return secureResponse(json({ success: false, error: '服务暂时不可用，请稍后再试' }, { status: 500 }));
  }
}
