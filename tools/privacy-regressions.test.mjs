import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet as listInvites, onRequestPost as writeInvite } from '../functions/api/invites.js';
import { onRequestPost as register } from '../functions/api/auth/register.js';
import { onRequest as config } from '../functions/api/config.js';
import { onRequestPost as profile } from '../functions/api/profile.js';
import { onRequestPost as upload } from '../functions/api/upload.js';
import { onRequestGet as media, onRequestHead as mediaHead, byteRange } from '../functions/api/media/[key].js';
import { inviteDigest } from '../functions/api/_privacy.js';
const { mediaUrl } = createRequire(import.meta.url)('../privacy-ui.js');

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT DEFAULT 'user', status TEXT DEFAULT 'active', ban_expires_at INTEGER DEFAULT 0, avatar_url TEXT, created_at INTEGER, last_seen INTEGER);
    CREATE TABLE sessions(session_id TEXT PRIMARY KEY,user_id INTEGER,created_at INTEGER);
    CREATE TABLE system_settings(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE invites(code TEXT PRIMARY KEY,is_used INTEGER DEFAULT 0);
    INSERT INTO invites(code) VALUES('legacy-untouched');
    INSERT INTO users(id,username,role) VALUES(1,'admin','admin'),(2,'member','user');
    INSERT INTO system_settings VALUES('turnstile_enabled','false');`);
  sqlite.exec(readFileSync(new URL('../migrations/001_registration_invites.sql', import.meta.url), 'utf8'));
  for (const [sid, uid] of [['admin-session',1],['member-session',2]]) sqlite.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sid,uid,Date.now());
  function prepare(sql, args = []) {
    return { bind(...values) { return prepare(sql, values); },
      async first() { return sqlite.prepare(sql).get(...args) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      syncRun() { const result = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } }; },
      async run() { return this.syncRun(); }
    };
  }
  const bytes = new Uint8Array([0,1,2,3,4,5,6,7,8,9]);
  const bucket = { headCalls: 0, getCalls: 0,
    async head(key) { this.headCalls++; return key === 'missing.png' ? null : { key, size: bytes.length, etag: 'abc', httpEtag: '"abc"', uploaded: new Date('2026-10-11T10:00:00Z') }; },
    async get(key, options) { this.getCalls++; assert.equal(options.onlyIf.etagMatches,'abc'); const slice = options.range ? bytes.slice(options.range.offset,options.range.offset+options.range.length) : bytes; return { body: new ReadableStream({start(controller) { controller.enqueue(slice); controller.close(); }}) }; }
  };
  const env = { DB: { prepare, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results = statements.map(s => s.syncRun()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } }, MY_BUCKET: bucket };
  function context(path, body, options = {}) {
    const headers = { ...(options.auth === false ? {} : { Cookie: `session_id=${options.member ? 'member-session' : 'admin-session'}` }), ...(options.headers || {}) };
    return { env, params: { key: options.key || 'sample.mp4' }, request: new Request('https://app.1eak.cool/api/' + path, { method: options.method || (body === undefined ? 'GET' : 'POST'), headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) };
  }
  const create = async days => (await (await writeInvite(context('invites',{action:'create',...(days === undefined ? {} : {expires_days:days})}))).json());
  return { sqlite, env, bucket, context, create, close: () => sqlite.close() };
}

test('邀请注册默认私有，管理员发码仅保存摘要，普通用户无法管理，旧表和账号保留', async () => {
  const f = fixture();
  try {
    f.sqlite.exec("DELETE FROM system_settings WHERE key='registration_mode'");
    assert.equal((await (await config(f.context('config'))).json()).registrationMode,'invite');
    const created = await f.create();
    assert.match(created.code,/^1eak_[A-Za-z0-9_-]{32}$/);
    const stored = f.sqlite.prepare('SELECT * FROM registration_invites').get();
    assert.equal(stored.token_hash,await inviteDigest(created.code));
    assert.equal(stored.code_hint,created.code.slice(-6));
    assert.ok(stored.expires_at > Date.now()+6*86400000);
    const listed = await (await listInvites(f.context('invites'))).json();
    assert.doesNotMatch(JSON.stringify(listed),/token_hash/);
    assert.ok(!JSON.stringify(listed).includes(created.code));
    assert.equal((await listInvites(f.context('invites',undefined,{auth:false}))).status,401);
    assert.equal((await writeInvite(f.context('invites',{action:'create'},{member:true}))).status,403);
    f.sqlite.exec("UPDATE users SET status='banned' WHERE id=1");
    assert.equal((await listInvites(f.context('invites'))).status,403);
    assert.equal(f.sqlite.prepare('SELECT code FROM invites').get().code,'legacy-untouched');
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM users').get().n,2);
  } finally { f.close(); }
});

test('单次邀请码的并发消费与用户创建原子化，账号冲突回滚邀请码', async () => {
  const f = fixture();
  try {
    const first = await f.create();
    assert.equal((await register(f.context('auth/register',{username:'admin',password:'correct-pass',inviteCode:first.code},{auth:false}))).status,409);
    assert.equal(f.sqlite.prepare('SELECT used_at FROM registration_invites WHERE id=?').get(first.invite.id).used_at,null);
    const responses = await Promise.all(Array.from({length:6},(_,i) => register(f.context('auth/register',{username:'newuser'+i,password:'correct-pass',inviteCode:first.code},{auth:false}))));
    assert.equal(responses.filter(r => r.status === 200).length,1);
    assert.equal(responses.filter(r => r.status === 403).length,5);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM users').get().n,3);
    const used = f.sqlite.prepare('SELECT used_at,used_by FROM registration_invites').get();
    assert.ok(used.used_at > 0);
    assert.equal(f.sqlite.prepare('SELECT username FROM users WHERE id=?').get(used.used_by).username,'newuser'+responses.findIndex(r => r.status === 200));
    assert.equal((await register(f.context('auth/register',{username:'withoutcode',password:'correct-pass'},{auth:false}))).status,400);
  } finally { f.close(); }
});

test('过期、撤销、关闭注册和事务前的关闭竞态均不能创建用户或消耗邀请码', async () => {
  const f = fixture();
  try {
    const invite = await f.create();
    const body = {username:'newuser',password:'correct-pass',inviteCode:invite.code};
    f.sqlite.prepare('UPDATE registration_invites SET expires_at=?').run(Date.now()-1);
    assert.equal((await register(f.context('auth/register',body,{auth:false}))).status,403);
    f.sqlite.prepare('UPDATE registration_invites SET expires_at=?').run(Date.now()+86400000);
    assert.equal((await writeInvite(f.context('invites',{action:'revoke',id:invite.invite.id}))).status,200);
    assert.equal((await register(f.context('auth/register',body,{auth:false}))).status,403);
    const second = await f.create(); body.inviteCode=second.code;
    assert.equal((await writeInvite(f.context('invites',{action:'set_mode',mode:'closed'}))).status,200);
    assert.equal((await register(f.context('auth/register',body,{auth:false}))).status,403);
    await writeInvite(f.context('invites',{action:'set_mode',mode:'invite'}));
    const batch = f.env.DB.batch;
    f.env.DB.batch = statements => { f.sqlite.exec("UPDATE system_settings SET value='closed' WHERE key='registration_mode'"); return batch(statements); };
    assert.equal((await register(f.context('auth/register',body,{auth:false}))).status,403);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM users').get().n,2);
    assert.equal(f.sqlite.prepare('SELECT used_at FROM registration_invites WHERE id=?').get(second.invite.id).used_at,null);
    for (const days of [0,31,'7',[],1.5]) assert.equal((await writeInvite(f.context('invites',{action:'create',expires_days:days}))).status,400);
    assert.equal((await writeInvite(f.context('invites',{action:'set_mode',mode:'open'}))).status,400);
  } finally { f.close(); }
});

test('邀请码记录支持稳定游标分页，不暴露旧完整码或摘要', async () => {
  const f = fixture();
  try {
    for (let i=0;i<25;i++) await f.create();
    const first = await (await listInvites(f.context('invites'))).json();
    const second = await (await listInvites(f.context('invites?before_id='+first.next_before_id))).json();
    assert.equal(first.invites.length,20); assert.equal(first.has_more,true);
    assert.equal(second.invites.length,5); assert.equal(second.has_more,false);
    assert.equal(new Set([...first.invites,...second.invites].map(i=>i.id)).size,25);
    assert.equal((await listInvites(f.context('invites?before_id=0'))).status,400);
  } finally { f.close(); }
});

test('媒体访问先鉴权，HEAD/条件请求不读body，视频单段Range流式返回，非法范围416', async () => {
  const f = fixture();
  try {
    assert.equal((await media(f.context('media/sample.mp4',undefined,{auth:false}))).status,401);
    assert.equal(f.bucket.headCalls,0);
    f.sqlite.exec("UPDATE users SET status='banned' WHERE id=1");
    assert.equal((await media(f.context('media/sample.mp4'))).status,403);
    assert.equal(f.bucket.headCalls,0);
    f.sqlite.exec("UPDATE users SET status='active' WHERE id=1");
    const head = await mediaHead(f.context('media/sample.mp4',undefined,{method:'HEAD'}));
    assert.equal(head.headers.get('Content-Length'),'10'); assert.equal(await head.text(),''); assert.equal(f.bucket.getCalls,0);
    const rangedHead = await mediaHead(f.context('media/sample.mp4',undefined,{method:'HEAD',headers:{Range:'bytes=2-5'}}));
    assert.equal(rangedHead.status,200); assert.equal(rangedHead.headers.get('Content-Length'),'10');
    assert.equal((await media(f.context('media/sample.mp4',undefined,{headers:{'If-None-Match':'W/"abc"'}}))).status,304);
    const response = await media(f.context('media/sample.mp4',undefined,{headers:{Range:'bytes=2-5'}}));
    assert.equal(response.status,206); assert.equal(response.headers.get('Content-Range'),'bytes 2-5/10');
    assert.equal(response.headers.get('Content-Type'),'video/mp4'); assert.equal(response.headers.get('Cache-Control'),'no-store');
    assert.equal(response.headers.get('Cross-Origin-Resource-Policy'),'same-origin');
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[2,3,4,5]);
    assert.equal((await media(f.context('media/sample.mp4',undefined,{headers:{Range:'bytes=0-1,3-4'}}))).status,416);
    assert.equal((await media(f.context('media/sample.mp4',undefined,{headers:{Range:'bytes=10-'}}))).headers.get('Content-Range'),'bytes */10');
    assert.equal((await media(f.context('media/sample.mp4',undefined,{headers:{Range:'bytes=2-5','If-Range':'"different"'}}))).status,200);
    const pdf = await media(f.context('media/sample.pdf',undefined,{key:'sample.pdf'}));
    assert.equal(pdf.headers.get('Content-Disposition'),'attachment');
    for (const key of ['../sample.png','sample.svg','sample.html','sample.png?x=1','folder/sample.png']) assert.equal((await media(f.context('media/key',undefined,{key}))).status,404);
    assert.equal((await media(f.context('media/missing.png',undefined,{key:'missing.png'}))).status,404);
    assert.deepEqual(byteRange('bytes=-3',10),{offset:7,length:3});
    assert.deepEqual(byteRange('bytes=3-',10),{offset:3,length:7});
    assert.equal(byteRange('bytes=-0',10),false);
    assert.equal(byteRange('bytes=9007199254740993-',10),false);
  } finally { f.close(); }
});

test('旧媒体链接映射到鉴权路由，新头像仅接受本站媒体图片', async () => {
  const f = fixture();
  try {
    assert.equal(mediaUrl('https://img.1eak.cool/123-abc.png','https://app.1eak.cool/#post?id=1'),'https://app.1eak.cool/api/media/123-abc.png');
    assert.equal(mediaUrl('https://img.1eak.cool/%E6%97%A7%20%E7%85%A7%E7%89%87.jpg','https://app.1eak.cool/'),'https://app.1eak.cool/api/media/%E6%97%A7%20%E7%85%A7%E7%89%87.jpg');
    assert.equal(mediaUrl('https://img.1eak.cool/old.mov?cache=1#t=2','https://app.1eak.cool/'),'https://app.1eak.cool/api/media/old.mov');
    assert.equal(mediaUrl('https://img.1eak.cool/folder/123.png','https://app.1eak.cool/'),'https://img.1eak.cool/folder/123.png');
    assert.equal(mediaUrl('https://other.test/123.png','https://app.1eak.cool/'),'https://other.test/123.png');
    assert.equal((await profile(f.context('profile',{avatar_url:'https://app.1eak.cool/api/media/123-abc.png'}))).status,200);
    assert.equal((await profile(f.context('profile',{avatar_url:'https://img.1eak.cool/old.png'}))).status,200);
    for (const url of ['https://evil.test/api/media/123.png','https://app.1eak.cool/api/media/a.mp4','https://app.1eak.cool/api/media/a.png?x=1','https://app.1eak.cool/a.png']) assert.equal((await profile(f.context('profile',{avatar_url:url}))).status,400);
    for (const [key,type] of [['旧 照片.jpg','image/jpeg'],['📷 旧照片.JPG','image/jpeg'],['old.mov','video/quicktime'],['old.ico','image/vnd.microsoft.icon'],['old.heif','image/heif']]) {
      const response = await media(f.context('media/key',undefined,{key})); assert.equal(response.status,200); assert.equal(response.headers.get('Content-Type'),type);
    }
  } finally { f.close(); }
});

test('历史格式的只读兼容不扩大新上传白名单', async () => {
  const f = fixture();
  try {
    for (const [name,type] of [['legacy.mov','video/quicktime'],['legacy.ico','image/vnd.microsoft.icon'],['legacy.heif','image/heif'],['legacy.heic','image/heic']]) {
      const form = new FormData();
      form.append('file',new File([new Uint8Array([0,0,0,16,102,116,121,112,104,101,105,99,0,0,0,0])],name,{type}));
      const context = f.context('upload');
      context.request = new Request('https://app.1eak.cool/api/upload',{method:'POST',headers:{Cookie:'session_id=admin-session'},body:form});
      assert.equal((await upload(context)).status,400);
    }
  } finally { f.close(); }
});
