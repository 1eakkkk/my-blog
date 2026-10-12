import { json, getUser, isBanned } from './_lib.js';

const MAX_SIZE = 50 * 1024 * 1024;
const TYPES = {
  'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/gif': ['gif'],
  'image/webp': ['webp'], 'video/mp4': ['mp4'], 'video/webm': ['webm'], 'application/pdf': ['pdf']
};

function hasSignature(bytes, type) {
  const ascii = (start, length) => String.fromCharCode(...bytes.slice(start, start + length));
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return [137,80,78,71,13,10,26,10].every((byte, i) => bytes[i] === byte);
  if (type === 'image/gif') return ['GIF87a', 'GIF89a'].includes(ascii(0, 6));
  if (type === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
  if (type === 'video/mp4') return ascii(4, 4) === 'ftyp';
  if (type === 'video/webm') return [0x1a,0x45,0xdf,0xa3].every((byte, i) => bytes[i] === byte);
  if (type === 'application/pdf') return ascii(0, 5) === '%PDF-';
  return false;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const user = await getUser(context);
  if (!user) return json({ success: false, error: '请先登录' }, { status: 401 });
  if (isBanned(user)) return json({ success: false, error: '账号封禁中' }, { status: 403 });
  if (!request.body) return json({ success: false, error: '请选择文件' }, { status: 400 });

  let received = 0;
  let tooLarge = false;
  const limited = request.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > MAX_SIZE + 1024 * 1024) { tooLarge = true; throw new Error('Multipart size limit'); }
      controller.enqueue(chunk);
    }
  }));
  let formData;
  try { formData = await new Response(limited, { headers: request.headers }).formData(); }
  catch { return json({ success: false, error: tooLarge ? '文件过大，最大支持50MB' : '上传格式无效' }, { status: tooLarge ? 413 : 400 }); }
  const file = formData.get('file');
  if (!file || !(file instanceof File)) return json({ success: false, error: '请选择文件' }, { status: 400 });
  if (!file.size || file.size > MAX_SIZE) return json({ success: false, error: '文件大小无效，最大支持50MB' }, { status: 400 });

  // MIME、扩展名必须匹配，并核验文件头，拒绝伪装成图片的 HTML/SVG。
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!TYPES[file.type]?.includes(ext) || !hasSignature(new Uint8Array(await file.slice(0, 16).arrayBuffer()), file.type)) {
    return json({ success: false, error: '文件类型与内容不匹配或不受支持' }, { status: 400 });
  }
  const filename = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
  try {
    await env.MY_BUCKET.put(filename, file.stream(), {
      httpMetadata: { contentType: file.type, ...(file.type === 'application/pdf' ? { contentDisposition: 'attachment' } : {}) }
    });
  } catch (error) {
    console.error('R2 upload failed:', error);
    return json({ success: false, error: '文件上传暂时失败，请稍后再试' }, { status: 500 });
  }
  const url = new URL(`/api/media/${filename}`, request.url).href;
  const label = file.name.replace(/[\r\n]/g, ' ').replace(/[\\\[\]]/g, '\\$&');
  const mdInsert = file.type.startsWith('image/') ? `![](${url})` : file.type.startsWith('video/') ? `<video controls src="${url}"></video>` : `[${label}](${url})`;
  return json({ success: true, url, mdInsert, fileName: file.name, size: file.size });
}
