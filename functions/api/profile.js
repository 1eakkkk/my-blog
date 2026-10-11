import { json, getUser, readJson, isBanned } from './_lib.js';

export async function onRequestPost(context) {
  const db = context.env.DB;
  const user = await getUser(context);
  if (!user) return json({ success: false, error: '请先登录' }, { status: 401 });
  if (isBanned(user)) return json({ success: false, error: '账号封禁中' }, { status: 403 });

  const { nickname, badge_preference, bio, avatar_url } = await readJson(context.request);

  if (nickname !== undefined) {
    if (typeof nickname !== 'string' || !nickname.trim() || nickname.length > 12) return json({ success: false, error: '昵称无效' }, { status: 400 });
    await db.prepare('UPDATE users SET nickname = ? WHERE id = ?').bind(nickname, user.id).run();
    return json({ success: true, message: '昵称已更新' });
  }

  if (avatar_url !== undefined) {
    if (typeof avatar_url !== 'string') return json({ success: false, error: '头像地址无效' }, { status: 400 });
    if (avatar_url !== '') {
      let avatar;
      try { avatar = new URL(avatar_url); } catch { return json({ success: false, error: '头像地址无效' }, { status: 400 }); }
      if (avatar.origin !== 'https://img.1eak.cool' || avatar.username || avatar.password || avatar.search || avatar.hash || !/^\/[a-zA-Z0-9-]+\.(?:jpe?g|png|gif|webp)$/.test(avatar.pathname)) {
        return json({ success: false, error: '请上传有效的图片作为头像' }, { status: 400 });
      }
    }
    await db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(avatar_url, user.id).run();
    return json({ success: true, message: '头像已更新' });
  }

  if (badge_preference !== undefined) {
    if (typeof badge_preference !== 'string' || !/^[a-zA-Z0-9_-]{1,24}$/.test(badge_preference)) return json({ success: false, error: '偏好无效' }, { status: 400 });
    await db.prepare('UPDATE users SET badge_preference = ? WHERE id = ?').bind(badge_preference, user.id).run();
    return json({ success: true, message: '偏好已保存' });
  }

  if (bio !== undefined) {
    if (typeof bio !== 'string' || bio.length > 50) return json({ success: false, error: '签名无效 (限50字)' }, { status: 400 });
    await db.prepare('UPDATE users SET bio = ? WHERE id = ?').bind(bio, user.id).run();
    return json({ success: true, message: '签名已更新' });
  }

  return json({ success: false, error: '无操作' });
}
