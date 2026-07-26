// 公共工具模块（文件名以 _ 开头，Pages Functions 不会为它生成路由）
// 所有 API 的鉴权和 JSON 响应统一走这里，改一处即可全局生效。

const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 会话有效期 7 天

// 统一 JSON 响应
export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
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
  const user = await context.env.DB.prepare(
    `SELECT users.* FROM sessions
     JOIN users ON sessions.user_id = users.id
     WHERE sessions.session_id = ? AND sessions.created_at > ?`
  ).bind(sessionId, minCreatedAt).first();

  if (!user) return null;
  delete user.password; // 永远不把密码哈希带出这个函数
  return user;
}
