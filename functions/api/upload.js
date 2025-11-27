export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  const bucket = env.MY_BUCKET; // 对应刚才绑定的变量名

  // 1. 鉴权
  const cookie = request.headers.get('Cookie');
  if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ error: '请先登录' }), { status: 401 });
  const sessionId = cookie.split('session_id=')[1].split(';')[0];
  const user = await db.prepare(`SELECT id FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ error: '无效会话' }), { status: 401 });

  // 2. 解析上传的文件
  const formData = await request.formData();
  const file = formData.get('file');

  if (!file || !(file instanceof File)) {
    return new Response(JSON.stringify({ error: '请选择图片文件' }), { status: 400 });
  }

  // 3. 限制文件大小 (例如 5MB)
  if (file.size > 5 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: '图片不能超过 5MB' }), { status: 400 });
  }

  // 4. 生成唯一文件名 (UUID + 扩展名)
  const ext = file.name.split('.').pop();
  const fileName = `${crypto.randomUUID()}.${ext}`;

  // 5. 写入 R2
  try {
    await bucket.put(fileName, file, {
      httpMetadata: { contentType: file.type }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'R2 存储失败: ' + e.message }), { status: 500 });
  }

  // 6. 返回公开访问链接
  // === 请修改下面的域名为你刚才在 R2 设置里绑定的域名 ===
  const publicUrl = `https://img.1eak.cool/${fileName}`; 

  return new Response(JSON.stringify({ 
    success: true, 
    url: publicUrl,
    markdown: `![](${publicUrl})`
  }));
}
