export const INVITE_PATTERN = /^1eak_[A-Za-z0-9_-]{32}$/;
// 历史上传包含中文/空格文件名及 MOV/ICO/HEIF；只读代理兼容，新的上传白名单不扩大。
export const MEDIA_KEY_PATTERN = /^[^\u0000-\u001f\u007f/\\?#]+\.(?:jpe?g|png|gif|webp|mp4|webm|pdf|mov|ico|heif|heic)$/i;

export async function registrationMode(db) {
  const setting = await db.prepare("SELECT value FROM system_settings WHERE key = 'registration_mode'").first();
  // 私人小站缺少配置时也不能恢复成开放注册。
  return setting?.value === 'closed' ? 'closed' : 'invite';
}

export async function inviteDigest(code) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createInviteCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return '1eak_' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
