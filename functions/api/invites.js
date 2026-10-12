import { json, getUser, readJson, positiveId, isBanned } from './_lib.js';
import { registrationMode, inviteDigest, createInviteCode } from './_privacy.js';

async function admin(context) {
  const user = await getUser(context);
  if (!user) return { response: json({ success: false, error: '请先登录' }, { status: 401 }) };
  if (user.role !== 'admin' || isBanned(user)) return { response: json({ success: false, error: '无权限' }, { status: 403 }) };
  return { user };
}

export async function onRequestGet(context) {
  const access = await admin(context);
  if (access.response) return access.response;
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const rawBefore = url.searchParams.get('before_id');
  const before = rawBefore === null ? null : positiveId(rawBefore);
  if (rawBefore !== null && before === null) return json({ success: false, error: '分页无效' }, { status: 400 });
  const query = `SELECT id, code_hint, created_at, expires_at, used_at, used_by, revoked_at
    FROM registration_invites ${before === null ? '' : 'WHERE id < ?'} ORDER BY id DESC LIMIT 21`;
  const statement = db.prepare(query);
  const result = await (before === null ? statement : statement.bind(before)).all();
  const invites = result.results.slice(0, 20);
  return json({ registrationMode: await registrationMode(db), invites, has_more: result.results.length > 20,
    next_before_id: invites.at(-1)?.id || null });
}

export async function onRequestPost(context) {
  const access = await admin(context);
  if (access.response) return access.response;
  const db = context.env.DB;
  const body = await readJson(context.request);
  if (body.action === 'set_mode') {
    if (!['invite', 'closed'].includes(body.mode)) return json({ success: false, error: '注册方式无效' }, { status: 400 });
    await db.prepare("INSERT INTO system_settings(key,value) VALUES('registration_mode',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .bind(body.mode).run();
    return json({ success: true, registrationMode: body.mode });
  }
  if (body.action === 'create') {
    const days = body.expires_days ?? 7;
    if (!Number.isInteger(days) || days < 1 || days > 30) return json({ success: false, error: '有效期需为1–30天' }, { status: 400 });
    const code = createInviteCode();
    const now = Date.now();
    const expiry = now + days * 86400000;
    const invite = await db.prepare(`INSERT INTO registration_invites(token_hash,code_hint,created_by,created_at,expires_at)
      VALUES(?,?,?,?,?) RETURNING id,code_hint,created_at,expires_at,used_at,used_by,revoked_at`)
      .bind(await inviteDigest(code), code.slice(-6), access.user.id, now, expiry).first();
    // 完整邀请码仅在创建响应出现一次；列表与数据库都不保存明文。
    return json({ success: true, code, invite });
  }
  if (body.action === 'revoke') {
    const id = positiveId(body.id);
    if (id === null) return json({ success: false, error: '邀请码编号无效' }, { status: 400 });
    const result = await db.prepare('UPDATE registration_invites SET revoked_at=? WHERE id=? AND used_at IS NULL AND revoked_at IS NULL')
      .bind(Date.now(), id).run();
    if (!result.meta?.changes) return json({ success: false, error: '邀请码不存在或已失效' }, { status: 409 });
    return json({ success: true });
  }
  return json({ success: false, error: '未知操作' }, { status: 400 });
}
