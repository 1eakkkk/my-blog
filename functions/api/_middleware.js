// --- functions/api/_middleware.js ---

export async function onRequest(context) {
  const { request, env, next } = context;
  const db = env.DB;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  
  // 只限制修改类请求 (POST, PUT, DELETE)，GET 请求通常不限制或者限制宽松
  if (request.method === 'GET') {
      return next();
  }

  const now = Date.now();
  const windowSize = 60 * 1000; // 1分钟窗口
  const limit = 30; // 限制：每分钟最多 30 次写操作 (发帖、评论、点赞等)

  // 1. 清理过期记录 (为了不让表无限膨胀，这里顺手清理一下)
  // 注意：生产环境最好用 Cron Trigger 每天清理，但这里简化处理
  // 为了不拖慢每个请求，我们用 waitUntil 异步清理 (Cloudflare 特性)
  context.waitUntil(
      db.prepare('DELETE FROM rate_limits WHERE timestamp < ?').bind(now - windowSize).run()
  );

  // 2. 统计当前 IP 在过去 1 分钟内的请求数
  const countRes = await db.prepare('SELECT COUNT(*) as c FROM rate_limits WHERE ip = ? AND timestamp > ?')
      .bind(ip, now - windowSize)
      .first();

  const count = countRes.c;

  if (count >= limit) {
      return new Response(JSON.stringify({ 
          success: false, 
          error: `操作太频繁，请稍息片刻 (Rate Limit: ${limit}/min)` 
      }), { 
          status: 429,
          headers: { 'Content-Type': 'application/json' }
      });
  }

  // 3. 记录本次请求
  // 不要 await，让它异步入库，加快响应速度
  context.waitUntil(
      db.prepare('INSERT INTO rate_limits (ip, timestamp) VALUES (?, ?)').bind(ip, now).run()
  );

  // 4. 继续处理请求
  return next();
}
