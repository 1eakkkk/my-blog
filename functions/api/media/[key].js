import { json, getUser, isBanned } from '../_lib.js';
import { MEDIA_KEY_PATTERN } from '../_privacy.js';

const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  mp4: 'video/mp4', webm: 'video/webm', pdf: 'application/pdf', mov: 'video/quicktime', ico: 'image/vnd.microsoft.icon', heif: 'image/heif', heic: 'image/heic' };

export function byteRange(value, size) {
  if (value === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size <= 0) return false;
  const start = match[1] ? Number(match[1]) : null;
  const end = match[2] ? Number(match[2]) : null;
  if ((start !== null && !Number.isSafeInteger(start)) || (end !== null && !Number.isSafeInteger(end))) return false;
  if (start === null) {
    if (end <= 0) return false;
    return { offset: Math.max(0, size - end), length: Math.min(size, end) };
  }
  if (start >= size || (end !== null && end < start)) return false;
  return { offset: start, length: Math.min(end ?? size - 1, size - 1) - start + 1 };
}

function objectHeaders(object, key) {
  const headers = new Headers();
  headers.set('Content-Type', TYPES[key.split('.').at(-1).toLowerCase()]);
  headers.set('Cache-Control', 'no-store');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('ETag', object.httpEtag);
  if (object.uploaded) headers.set('Last-Modified', new Date(object.uploaded).toUTCString());
  if (key.toLowerCase().endsWith('.pdf')) headers.set('Content-Disposition', 'attachment');
  return headers;
}

async function serve(context) {
  const user = await getUser(context);
  if (!user) return json({ success: false, error: '请先登录' }, { status: 401 });
  if (isBanned(user)) return json({ success: false, error: '账号封禁中' }, { status: 403 });
  const key = context.params?.key;
  if (typeof key !== 'string' || key.length > 1024 || !MEDIA_KEY_PATTERN.test(key)) return json({ success: false, error: '文件不存在' }, { status: 404 });
  const bucket = context.env.MY_BUCKET;
  const object = await bucket.head(key);
  if (!object) return json({ success: false, error: '文件不存在' }, { status: 404 });
  const headers = objectHeaders(object, key);
  const noneMatch = context.request.headers.get('If-None-Match');
  if (noneMatch && noneMatch.split(',').some(tag => tag.trim() === '*' || tag.trim().replace(/^W\//, '') === object.httpEtag)) {
    return new Response(null, { status: 304, headers });
  }
  const ifRange = context.request.headers.get('If-Range');
  const uploaded = object.uploaded ? Math.floor(new Date(object.uploaded).getTime() / 1000) * 1000 : NaN;
  const canRange = !ifRange || ifRange === object.httpEtag || (Number.isFinite(uploaded) && Date.parse(ifRange) >= uploaded);
  const range = byteRange(canRange && context.request.method === 'GET' ? context.request.headers.get('Range') : null, object.size);
  if (range === false) {
    headers.set('Content-Range', `bytes */${object.size}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set('Content-Length', String(range?.length ?? object.size));
  if (range) headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
  if (context.request.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers });
  // R2 的 get body 是流，50MB 视频不会整块加载到 Functions 内存。
  const result = await bucket.get(key, { ...(range ? { range } : {}), onlyIf: { etagMatches: object.etag } });
  if (!result || !('body' in result)) return json({ success: false, error: '文件暂时不可用，请重试' }, { status: 409 });
  return new Response(result.body, { status: range ? 206 : 200, headers });
}

export const onRequestGet = serve;
export const onRequestHead = serve;
