const MAX_SIZE = 50 * 1024 * 1024; // 50MB

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  const cookie = request.headers.get('Cookie');
  if (!cookie) return new Response(JSON.stringify({ error: '请登录' }), { status: 401 });
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const user = await db.prepare('SELECT id FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
  if (!user) return new Response(JSON.stringify({ error: '无效会话' }), { status: 401 });

  const formData = await request.formData();
  const file = formData.get('file');
  if (!file || !(file instanceof File)) return new Response(JSON.stringify({ error: '请选择文件' }), { status: 400 });

  if (file.size > MAX_SIZE) {
    return new Response(JSON.stringify({ error: `文件过大，最大支持 ${MAX_SIZE / 1024 / 1024}MB` }), { status: 400 });
  }

  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'video/mp4', 'video/webm', 'application/pdf'];
  const ALLOWED_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'mp4', 'webm', 'pdf'];
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();

  if (!ALLOWED_TYPES.includes(file.type) || !ALLOWED_EXTS.includes(ext)) {
    return new Response(JSON.stringify({ error: '不支持的文件类型' }), { status: 400 });
  }
  const filename = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${ext}`;

  try {
    await env.MY_BUCKET.put(filename, file.stream(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'R2 上传失败: ' + err.message }), { status: 500 });
  }

  const publicDomain = 'https://img.1eak.cool';
  const url = `${publicDomain}/${filename}`;

  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  const mdInsert = isImage ? `![](${url})` : isVideo ? `<video controls src="${url}"></video>` : `[${file.name}](${url})`;

  return new Response(JSON.stringify({ success: true, url, mdInsert, fileName: file.name, size: file.size }));
}
