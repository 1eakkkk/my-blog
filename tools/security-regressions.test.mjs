import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequest as middleware } from '../functions/api/_middleware.js';
import { onRequestPost as addComment, onRequestPut as editComment, onRequestDelete as deleteComment, onRequestGet as getComments } from '../functions/api/comments.js';
import { onRequestPost as profile } from '../functions/api/profile.js';
import { onRequestPost as upload } from '../functions/api/upload.js';
import { onRequestPost as like } from '../functions/api/like.js';
import { onRequestPost as login } from '../functions/api/auth/login.js';
import { onRequestPost as register } from '../functions/api/auth/register.js';
import { onRequestPost as logout } from '../functions/api/auth/logout.js';
import { getUser, positiveId, readJson, verifyTurnstile } from '../functions/api/_lib.js';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password TEXT, nickname TEXT, avatar_variant INTEGER DEFAULT 0, avatar_url TEXT DEFAULT '', role TEXT DEFAULT 'user', bio TEXT DEFAULT '', badge_preference TEXT, status TEXT DEFAULT 'active', ban_expires_at INTEGER DEFAULT 0, ban_reason TEXT, login_fails INTEGER DEFAULT 0, login_locked_until INTEGER DEFAULT 0, created_at INTEGER, last_seen INTEGER);
    CREATE TABLE sessions (session_id TEXT PRIMARY KEY, user_id INTEGER, created_at INTEGER);
    CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, like_count INTEGER DEFAULT 0);
    CREATE TABLE comments (id INTEGER PRIMARY KEY, post_id INTEGER, user_id INTEGER, content TEXT, parent_id INTEGER, reply_to_uid INTEGER, created_at INTEGER, is_pinned INTEGER DEFAULT 0, like_count INTEGER DEFAULT 0);
    CREATE TABLE likes (id INTEGER PRIMARY KEY, user_id INTEGER, target_id INTEGER, target_type TEXT, created_at INTEGER);
    CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO system_settings VALUES ('turnstile_enabled', 'false');
    INSERT INTO users (id, username) VALUES (1,'owner'),(2,'other');
    INSERT INTO posts (id,user_id) VALUES (1,1),(2,2);
    INSERT INTO comments (id,post_id,user_id,content,parent_id) VALUES (1,1,1,'root',NULL),(2,2,2,'other post',NULL),(3,1,2,'reply',1),(4,1,2,'historically inconsistent',2);`);
  sqlite.exec(readFileSync(new URL('../migrations/002_recycle.sql', import.meta.url), 'utf8'));
  sqlite.prepare('INSERT INTO sessions VALUES (?,?,?)').run('valid-session', 1, Date.now());
  function prepare(sql, args = []) {
    return {
      bind(...values) { return prepare(sql, values); },
      async first() { return sqlite.prepare(sql).get(...args) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      async run() { const result = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } }; }
    };
  }
  const env = { DB: { prepare, async batch(statements) { return Promise.all(statements.map(s => s.run())); } }, MY_BUCKET: { puts: [], async put(...args) { this.puts.push(args); } } };
  function context(path, body, options = {}) {
    const headers = { ...(options.auth === false ? {} : { Cookie: 'session_id=valid-session' }), ...(options.headers || {}) };
    const requestOptions = { method: options.method || (body === undefined ? 'GET' : 'POST'), headers };
    if (body !== undefined) {
      if (body instanceof FormData) requestOptions.body = body;
      else { requestOptions.body = options.raw ? body : JSON.stringify(body); if (!headers['Content-Type']) headers['Content-Type'] = 'application/json'; }
    }
    return { env, request: new Request('https://app.1eak.cool/api/' + path, requestOptions), waitUntil() {} };
  }
  async function dispatch(path, handler, body, options) {
    const ctx = context(path, body, options);
    ctx.next = () => handler(ctx);
    return middleware(ctx);
  }
  return { sqlite, env, context, dispatch, close: () => sqlite.close() };
}

const count = (f, table) => f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

test('登录墙在内容 API 服务端生效，过期/封禁会话均无法读取且返回安全响应头', async () => {
  const f = fixture();
  try {
    let reached = false;
    const handler = () => { reached = true; return new Response('{}'); };
    for (const method of ['GET', 'HEAD']) {
      for (const path of ['posts', 'comments?post_id=1', 'user-public?id=1']) {
        const response = await f.dispatch(path, handler, undefined, { auth: false, method });
        assert.equal(response.status, 401);
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
        assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
      }
    }
    assert.equal(reached, false);
    assert.equal((await f.dispatch('posts', handler)).status, 200);
    f.sqlite.prepare('UPDATE sessions SET created_at=?').run(Date.now() - 8 * 86400000);
    assert.equal((await f.dispatch('posts', handler)).status, 401);
    f.sqlite.prepare('UPDATE sessions SET created_at=?').run(Date.now());
    f.sqlite.exec("UPDATE users SET status='banned',ban_expires_at=0 WHERE id=1");
    assert.equal((await f.dispatch('posts', handler)).status, 403);
    for (const path of ['user', 'config']) assert.equal((await f.dispatch(path, handler, undefined, { auth: false })).status, 200);
  } finally { f.close(); }
});

test('拒绝跨站及同主域子站 CSRF 和 text/plain JSON，允许同源 JSON 与 multipart 上传', async () => {
  const f = fixture();
  try {
    for (const headers of [
      { Origin: 'https://evil.test' }, { Origin: 'https://img.1eak.cool', 'Sec-Fetch-Site': 'same-site' },
      { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }
    ]) assert.equal((await f.dispatch('profile', profile, { nickname: '侵入' }, { headers })).status, 403);
    assert.equal((await f.dispatch('profile', profile, '{"nickname":"侵入"}', { raw: true, headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal(f.sqlite.prepare('SELECT nickname FROM users WHERE id=1').get().nickname, null);
    assert.equal((await f.dispatch('profile', profile, { nickname: '合法' }, { headers: { Origin: 'https://app.1eak.cool', 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
    assert.equal(f.sqlite.prepare('SELECT nickname FROM users WHERE id=1').get().nickname, '合法');
    const form = new FormData();
    form.append('file', new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6wWQAAAAASUVORK5CYII=', 'base64')], 'ok.png', { type: 'image/png' }));
    const response = await f.dispatch('upload', upload, form, { headers: { Origin: 'https://app.1eak.cool' } });
    assert.equal(response.status, 200);
    assert.equal(f.env.MY_BUCKET.puts.length, 1);
  } finally { f.close(); }
});

test('回复必须属于同一帖子，嵌套回复只能归入本帖根评论', async () => {
  const f = fixture();
  try {
    const before = count(f, 'comments');
    for (const parent_id of [2,4]) assert.equal((await f.dispatch('comments', addComment, { post_id: 1, content: 'attack', parent_id })).status, 404);
    assert.equal(count(f, 'comments'), before);
    assert.equal((await f.dispatch('comments', addComment, { post_id: 1, content: 'valid reply', parent_id: 3 })).status, 200);
    const added = f.sqlite.prepare('SELECT * FROM comments ORDER BY id DESC LIMIT 1').get();
    assert.equal(added.post_id, 1);
    assert.equal(added.parent_id, 1);
    assert.equal(added.reply_to_uid, 2);
  } finally { f.close(); }
});

test('普通用户不能编辑/删除他人评论或在他人帖子置顶，封禁后不能绕过前端写入', async () => {
  const f = fixture();
  try {
    assert.equal((await f.dispatch('comments', editComment, { id: 2, action: 'edit', content: 'attack' }, { method: 'PUT' })).status, 403);
    assert.equal((await f.dispatch('comments', editComment, { id: 2, action: 'pin' }, { method: 'PUT' })).status, 403);
    assert.equal((await f.dispatch('comments?id=2', deleteComment, undefined, { method: 'DELETE' })).status, 403);
    assert.equal(f.sqlite.prepare('SELECT content FROM comments WHERE id=2').get().content, 'other post');
    f.sqlite.exec("UPDATE users SET status='banned',ban_expires_at=0 WHERE id=1");
    for (const [path, handler, body, options] of [
      ['profile',profile,{bio:'attack'}], ['comments',addComment,{post_id:1,content:'attack'}],
      ['comments',editComment,{id:1,action:'edit',content:'attack'},{method:'PUT'}],
      ['comments?id=1',deleteComment,undefined,{method:'DELETE'}], ['like',like,{target_id:1,target_type:'post'}],
      ['upload',upload,new FormData()]
    ]) assert.equal((await f.dispatch(path,handler,body,options)).status,403);
    assert.equal((await f.dispatch('auth/logout', logout, undefined, { method: 'POST' })).status, 200);
    assert.equal(count(f,'sessions'),0);
  } finally { f.close(); }
});

test('拒绝恶意资料 URL、复杂类型、无限分页及不存在的点赞目标，无数据库写入', async () => {
  const f = fixture();
  try {
    for (const avatar_url of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'https://evil.test/a.png', 'https://img.1eak.cool/a.svg', 'https://img.1eak.cool/a.png?x=1', {}]) assert.equal((await f.dispatch('profile',profile,{avatar_url})).status,400);
    for (const body of [{nickname:[]},{nickname:'   '},{bio:{}},{badge_preference:{}}]) assert.equal((await f.dispatch('profile',profile,body)).status,400);
    for (const body of [{post_id:[1],content:'attack'},{post_id:1,content:[]},{post_id:1,content:'ok',parent_id:[1]}]) assert.equal((await f.dispatch('comments',addComment,body)).status,400);
    for (const query of ['post_id=1&limit=-1','post_id=1&page=100001','post_id=1&limit=100000','post_id=1 OR 1=1']) assert.equal((await f.dispatch('comments?' + query,getComments)).status,400);
    for (const target_id of [0,[1],{},'1 OR 1=1']) assert.equal((await f.dispatch('like',like,{target_id,target_type:'post'})).status,400);
    assert.equal((await f.dispatch('like',like,{target_id:999,target_type:'post'})).status,404);
    assert.equal(count(f,'likes'),0);
    assert.equal((await f.dispatch('profile',profile,{avatar_url:'https://img.1eak.cool/123-abc.png'})).status,200);
    assert.equal(positiveId([1]),null);
  } finally { f.close(); }
});

test('伪造扩展名/MIME的 HTML 和 SVG 不可进入 R2，合法 PDF 强制下载并逃逸 Markdown 标签', async () => {
  const f = fixture();
  try {
    for (const [name,type,content] of [['attack.png','image/png','<html><script>alert(1)</script>'],['attack.jpg','image/jpeg','<svg onload="alert(1)"/>'],['attack.svg','image/svg+xml','<svg/>'],['attack.jpg','image/png',Buffer.from([137,80,78,71,13,10,26,10])]]) {
      const form = new FormData(); form.append('file',new File([content],name,{type}));
      assert.equal((await f.dispatch('upload',upload,form)).status,400);
    }
    assert.equal(f.env.MY_BUCKET.puts.length,0);
    const pdf = new FormData(); pdf.append('file',new File(['%PDF-1.7\n'],'](https://evil.test).pdf',{type:'application/pdf'}));
    const response = await f.dispatch('upload',upload,pdf);
    assert.equal(response.status,200);
    assert.equal(f.env.MY_BUCKET.puts[0][2].httpMetadata.contentDisposition,'attachment');
    assert.match((await response.json()).mdInsert,/^\[\\\]/);
    f.env.MY_BUCKET.put = async () => { throw new Error('SENSITIVE_R2_DETAIL'); };
    const second = new FormData(); second.append('file',new File(['%PDF-1.7\n'],'ok.pdf',{type:'application/pdf'}));
    const originalError = console.error; console.error = () => {};
    try { assert.doesNotMatch(await (await f.dispatch('upload',upload,second)).text(),/SENSITIVE/); }
    finally { console.error = originalError; }
  } finally { f.close(); }
});

test('JSON 对象/体积校验覆盖无 Content-Length 请求，失败不暴露内部堆栈', async () => {
  const f = fixture();
  try {
    for (const value of ['null','[]','{bad']) assert.equal((await f.dispatch('profile',profile,value,{raw:true})).status,400);
    assert.equal((await f.dispatch('profile',profile,JSON.stringify({bio:'a'.repeat(256 * 1024)}),{raw:true})).status,413);
    const req = new Request('https://app.1eak.cool/api/profile',{method:'POST',body:JSON.stringify({bio:'a'.repeat(256 * 1024)}),headers:{'Content-Type':'application/json'}});
    assert.equal(req.headers.get('Content-Length'),null);
    await assert.rejects(readJson(req),error => error.status === 413);
    const originalError = console.error; console.error = () => {};
    try {
      const response = await f.dispatch('posts',() => { throw new Error('SENSITIVE_DB_DETAIL'); });
      assert.equal(response.status,500); assert.doesNotMatch(await response.text(),/SENSITIVE|stack|Error:/);
    } finally { console.error = originalError; }
  } finally { f.close(); }
});

test('登录失败计数原子化：并发失败不会覆盖计数，锁定到期后重新获得5次机会', async () => {
  const f = fixture();
  try {
    // 并发请求会在 await digest 时同时持有读取到的旧用户对象。
    const hash = Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('correct-pass'))).toString('hex');
    f.sqlite.prepare('UPDATE users SET password=? WHERE id=1').run(hash);
    const responses = await Promise.all(Array.from({length:8},() => f.dispatch('auth/login',login,{username:'owner',password:'wrong'})));
    const state = f.sqlite.prepare('SELECT login_fails,login_locked_until FROM users WHERE id=1').get();
    assert.equal(state.login_fails,8);
    assert.ok(state.login_locked_until > Date.now());
    assert.equal(responses.filter(r => r.status === 429).length,4);
    assert.equal((await f.dispatch('auth/login',login,{username:'owner',password:'correct-pass'})).status,429);
    f.sqlite.prepare('UPDATE users SET login_locked_until=? WHERE id=1').run(Date.now()-1000);
    assert.equal((await f.dispatch('auth/login',login,{username:'owner',password:'wrong'})).status,401);
    assert.equal(f.sqlite.prepare('SELECT login_fails FROM users WHERE id=1').get().login_fails,1);
  } finally { f.close(); }
});

test('登录保留旧密码升级、随机 HttpOnly 会话；类型异常、封禁账户和失效session拒绝', async () => {
  const f = fixture();
  try {
    const hash = Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('correct-pass'))).toString('hex');
    f.sqlite.prepare('UPDATE users SET password=? WHERE id=1').run(hash);
    for (const handler of [login,register]) assert.equal((await f.dispatch('auth/login',handler,{username:[],password:{}})).status,400);
    const response = await f.dispatch('auth/login',login,{username:'owner',password:'correct-pass'});
    assert.equal(response.status,200);
    const cookie = response.headers.get('Set-Cookie');
    assert.match(cookie,/session_id=[0-9a-f-]{36};/); assert.match(cookie,/Secure;/); assert.match(cookie,/HttpOnly;/); assert.match(cookie,/SameSite=Lax/); assert.doesNotMatch(cookie,/Domain=/);
    assert.match(f.sqlite.prepare('SELECT password FROM users WHERE id=1').get().password,/^[a-f0-9]{32}:[a-f0-9]{64}$/);
    f.sqlite.exec("UPDATE users SET status='banned',ban_expires_at=0 WHERE id=1");
    assert.equal((await f.dispatch('auth/login',login,{username:'owner',password:'correct-pass'})).status,403);
    f.sqlite.prepare('UPDATE users SET ban_expires_at=? WHERE id=1').run(Date.now()-1000);
    assert.equal((await getUser(f.context('user'))).status,'active');
  } finally { f.close(); }
});

test('自动解封不覆盖管理员在读取后新设置的封禁', async () => {
  const f = fixture();
  try {
    f.sqlite.prepare("UPDATE users SET status='banned',ban_expires_at=? WHERE id=1").run(Date.now()-1000);
    const originalPrepare = f.env.DB.prepare;
    let changed = false;
    f.env.DB.prepare = sql => {
      if (!changed && sql.startsWith("UPDATE users SET status = 'active'")) {
        changed = true;
        f.sqlite.prepare("UPDATE users SET ban_expires_at=?,ban_reason='new ban' WHERE id=1").run(Date.now()+3600000);
      }
      return originalPrepare(sql);
    };
    const user = await getUser(f.context('user'));
    assert.equal(user.status,'banned');
    assert.equal(user.ban_reason,'new ban');
    assert.ok(user.ban_expires_at > Date.now());
    assert.equal(user.password,undefined);
    assert.equal((await f.dispatch('posts',() => new Response('{}'))).status,403);
  } finally { f.close(); }
});

test('新注册密码上限不会阻断旧有超过128字符密码的登录', async () => {
  const f = fixture();
  try {
    const password = 'existing-long-password'.repeat(8);
    assert.ok(password.length > 128);
    const hash = Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(password))).toString('hex');
    f.sqlite.prepare('UPDATE users SET password=? WHERE id=1').run(hash);
    assert.equal((await f.dispatch('auth/login',login,{username:'owner',password})).status,200);
    assert.equal((await f.dispatch('auth/register',register,{username:'new-user',password})).status,400);
  } finally { f.close(); }
});

test('Turnstile验证限定服务器secret、token类型长度及当前hostname，服务故障不放行', async () => {
  const f = fixture();
  const originalFetch = globalThis.fetch;
  try {
    f.sqlite.exec("UPDATE system_settings SET value='true'");
    f.env.TURNSTILE_SECRET = 'test-secret';
    const ctx = f.context('auth/login');
    for (const token of [{},'', 'x'.repeat(2049)]) assert.equal((await verifyTurnstile(ctx,token)).status,403);
    globalThis.fetch = async () => new Response(JSON.stringify({success:true,hostname:'evil.test'}),{headers:{'Content-Type':'application/json'}});
    assert.equal((await verifyTurnstile(ctx,'token')).status,403);
    globalThis.fetch = async (_url,init) => {
      assert.equal(init.body.get('secret'),'test-secret');
      return new Response(JSON.stringify({success:true,hostname:'app.1eak.cool'}),{headers:{'Content-Type':'application/json'}});
    };
    assert.equal(await verifyTurnstile(ctx,'token'),null);
    globalThis.fetch = async () => { throw new Error('network failure'); };
    assert.equal((await verifyTurnstile(ctx,'token')).status,503);
  } finally { globalThis.fetch = originalFetch; f.close(); }
});
