export async function onRequest(context) {
  const { request, env, next } = context;

  if (request.method === 'GET') return next();

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const kv = env.KV;
  const windowSize = 60; // 秒
  const limit = 180;
  const key = `rate:${ip}`;

  try {
    const current = await kv.get(key);
    const count = current ? parseInt(current) : 0;

    if (count >= limit) {
      return new Response(JSON.stringify({
        success: false,
        error: `操作太频繁，请稍息片刻 (Rate Limit: ${limit}/min)`
      }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 异步更新计数，不阻塞响应
    context.waitUntil(
      count === 0
        ? kv.put(key, '1', { expirationTtl: windowSize })
        : kv.put(key, String(count + 1), { expirationTtl: windowSize })
    );

  } catch (e) {
    // KV 异常时放行，不影响正常请求
    console.error('Rate limit KV error:', e);
  }

  return next();
}
