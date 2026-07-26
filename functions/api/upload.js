import { json, getUser } from './_lib.js';

const MAX_SIZE = 50 * 1024 * 1024; // 50MB

// 安全说明：SVG 已从白名单移除——SVG 可内嵌 <script>，是存储型 XSS 载体
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'application/pdf'];
const ALLOWED_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'pdf'];

export async function onRequestPost(context) {
  const { request, env } = context;
  const user = await getUser(context);
  if (!user) return json({ success: false, error: '请先登录' }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get('file');
  if (!file || !(file instanceof File)) return json({ success: false, error: '请选择文件' }, { status: 400 });

  if (file.size > MAX_SIZE) {
    return json({ success: false, error: `文件过大，最大支持 ${MAX_SIZE / 1024 / 1024}MB` }, { status: 400 });
  }

  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  if (!ALLOWED_TYPES.includes(file.type) || !ALLOWED_EXTS.includes(ext)) {
    return json({ success: false, error: '不支持的文件类型' }, { status: 400 });
  }

  const filename = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${ext}`;

  try {
    await env.MY_BUCKET.put(filename, file.stream(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' }
    });
  } catch (err) {
    return json({ success: false, error: 'R2 上传失败: ' + err.message }, { status: 500 });
  }

  const publicDomain = 'https://img.1eak.cool';
  const url = `${publicDomain}/${filename}`;

  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  const mdInsert = isImage ? `![](${url})` : isVideo ? `<video controls src="${url}"></video>` : `[${file.name}](${url})`;

  return json({ success: true, url, mdInsert, fileName: file.name, size: file.size });
}
