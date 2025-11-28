// --- functions/api/upload.js ---
export async function onRequestPost(context) {
  const { request, env } = context;
  
  // 1. 鉴权 (照抄之前的逻辑)
  const db = env.DB;
  const cookie = request.headers.get('Cookie');
  if (!cookie) return new Response(JSON.stringify({ error: '请登录' }), { status: 401 });
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const user = await db.prepare(`SELECT id FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ error: '无效会话' }), { status: 401 });

  // 2. 处理文件
  const formData = await request.formData();
  const file = formData.get('file');

  if (!file || !(file instanceof File)) {
    return new Response(JSON.stringify({ error: '请选择图片文件' }), { status: 400 });
  }

  // 简单验证类型
  if (!file.type.startsWith('image/')) {
    return new Response(JSON.stringify({ error: '只能上传图片' }), { status: 400 });
  }

  // 限制大小 (例如 5MB)
  if (file.size > 5 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: '图片不能超过 5MB' }), { status: 400 });
  }

  // 3. 生成随机文件名 (防止覆盖)
  const ext = file.name.split('.').pop();
  const filename = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${ext}`;

  // 4. 上传到 R2 (MY_BUCKET 必须在后台绑定过)
  try {
    await env.MY_BUCKET.put(filename, file.stream(), {
      httpMetadata: { contentType: file.type }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'R2 上传失败: ' + err.message }), { status: 500 });
  }

  // 5. 返回公开访问 URL (这里需要替换成你的 R2 域名)
  // 请将下面的域名换成你在 Cloudflare 后台 R2 设置里绑定的域名
  const publicDomain = 'https://img.1eak.cool'; 
  const imageUrl = `${publicDomain}/${filename}`;

  return new Response(JSON.stringify({ success: true, url: imageUrl }));
}
