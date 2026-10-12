import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet as getInbox, onRequestPut as markInbox } from '../functions/api/notifications.js';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, nickname TEXT, role TEXT, status TEXT, ban_expires_at INTEGER);
    CREATE TABLE sessions (session_id TEXT PRIMARY KEY, user_id INTEGER, created_at INTEGER);
    CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE posts (id INTEGER PRIMARY KEY,user_id INTEGER,title TEXT,deleted INTEGER DEFAULT 0);
    CREATE TABLE comments (id INTEGER PRIMARY KEY,post_id INTEGER,user_id INTEGER,content TEXT,parent_id INTEGER,reply_to_uid INTEGER,created_at INTEGER,deleted INTEGER DEFAULT 0);
    CREATE VIEW active_posts AS SELECT * FROM posts WHERE deleted = 0;
    CREATE VIEW active_comments AS SELECT c.* FROM comments c JOIN active_posts p ON p.id=c.post_id WHERE c.deleted=0 AND NOT EXISTS(SELECT 1 FROM comments root WHERE root.id=c.parent_id AND root.deleted=1);
    INSERT INTO users VALUES (1,'owner','作者','user','active',0),(2,'other','朋友','user','active',0),(3,'third','路人','user','active',0);
    INSERT INTO posts(id,user_id,title) VALUES (1,1,'自己的帖子'),(2,2,'朋友的帖子');`);
  const migration = readFileSync(new URL('../migrations/003_reply_inbox.sql', import.meta.url), 'utf8');
  sqlite.exec(migration);
  const start = Date.now() - 60000;
  sqlite.prepare("UPDATE system_settings SET value=? WHERE key='site_inbox_started_at'").run(String(start));
  for (let id = 1; id <= 3; id++) sqlite.prepare('INSERT INTO sessions VALUES (?,?,?)').run('session-' + id, id, Date.now());
  const insert = sqlite.prepare('INSERT INTO comments (id,post_id,user_id,content,parent_id,reply_to_uid,created_at) VALUES (?,?,?,?,?,?,?)');
  const add = (id, { post = 1, author = 2, parent = null, recipient = null, time = start + 1000, content = '回复' + id } = {}) => insert.run(id, post, author, content, parent, recipient, time);
  function prepare(sql, values = []) {
    return { bind(...args) { assert.ok(args.length <= 100); return prepare(sql, args); },
      first: async () => sqlite.prepare(sql).get(...values) || null,
      all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
      run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }) };
  }
  function context(query = '', { user = 1, payload } = {}) {
    return { env: { DB: { prepare } }, request: new Request('https://test.local/api/notifications?' + query, {
      method: payload ? 'PUT' : 'GET', headers: { ...(user ? { Cookie: 'session_id=session-' + user } : {}), ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}) }) };
  }
  const get = async (query = '', options) => { const r = await getInbox(context(query, options)); assert.equal(r.status, 200); return r.json(); };
  const put = async (payload, options) => markInbox(context('', { ...options, payload }));
  return { sqlite, add, get, put, context, migration, start, close: () => sqlite.close() };
}

test('根评论提醒帖主，回复提醒被回复者；排除自己的发言并严格隔离账号', async () => {
  const f = fixture();
  try {
    f.add(1); f.add(2, { author: 1 }); f.add(3, { post: 2, author: 3 });
    f.add(4, { post: 2, author: 2, parent: 3, recipient: 1 });
    f.add(5, { author: 3, parent: 1, recipient: 2 });
    const owner = await f.get('user_id=2');
    assert.deepEqual(owner.results.map(r => r.comment_id), [4,1]);
    assert.deepEqual(owner.results.map(r => r.kind), ['reply','comment']);
    assert.equal(owner.unread_count, 2); assert.equal(owner.read_through, 4);
    const other = await f.get('', { user: 2 });
    assert.deepEqual(other.results.map(r => r.comment_id), [5,3]);
    assert.equal((await f.put({ action: 'read', comment_id: 5 })).status, 404);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM notification_reads').get().n, 0);
  } finally { f.close(); }
});

test('历史回复保留在全部列表且默认已读；迁移重复执行不改变上线起点', async () => {
  const f = fixture();
  try {
    f.add(1, { time: f.start - 1 }); f.add(2, { time: f.start });
    const all = await f.get(); assert.equal(all.total, 2); assert.equal(all.unread_count, 1);
    assert.deepEqual(all.results.map(r => r.is_unread), [true,false]);
    const unread = await f.get('unread=1'); assert.deepEqual(unread.results.map(r => r.comment_id), [2]);
    f.sqlite.exec(f.migration); assert.equal(f.sqlite.prepare("SELECT value FROM system_settings WHERE key='site_inbox_started_at'").get().value, String(f.start));
  } finally { f.close(); }
});

test('单条标记幂等，全部已读只覆盖快照范围，新到达的回复保持未读', async () => {
  const f = fixture();
  try {
    f.add(1); f.add(2); const snapshot = await f.get(); f.add(3);
    for (let i=0;i<2;i++) assert.equal((await f.put({ action:'read',comment_id:1 })).status,200);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM notification_reads').get().n,1);
    const response = await f.put({ action:'read_all',through_id:snapshot.read_through });
    assert.equal(response.status,200); assert.equal((await response.json()).unread_count,1);
    assert.deepEqual((await f.get('unread=1')).results.map(r=>r.comment_id),[3]);
    assert.equal((await f.get('', {user:2})).unread_count,0);
  } finally { f.close(); }
});

test('删除帖子、评论和主讨论立即隐藏提醒，恢复后重现且已读状态保留', async () => {
  const f = fixture();
  try {
    f.add(1); f.add(2, { post:2, author:2, parent:1, recipient:1 });
    await f.put({action:'read',comment_id:1});
    f.sqlite.exec('UPDATE posts SET deleted=1 WHERE id=1'); assert.deepEqual((await f.get()).results.map(r=>r.comment_id),[2]);
    f.sqlite.exec('UPDATE posts SET deleted=0 WHERE id=1; UPDATE comments SET deleted=1 WHERE id=1'); assert.equal((await f.get()).total,0);
    f.sqlite.exec('UPDATE comments SET deleted=0 WHERE id=1'); const restored=await f.get(); assert.equal(restored.total,2);
    assert.equal(restored.results.find(r=>r.comment_id===1).is_unread,false);
  } finally { f.close(); }
});

test('分页同时间戳有稳定顺序，摘要始终返回普通文字且不暴露完整正文', async () => {
  const f = fixture();
  try {
    for (let id=1;id<=45;id++) f.add(id);
    f.add(46,{content:'<img src=x onerror=alert(1)>**你好** [链接](javascript:bad) ![图](https://x.test/a.png) '+'长'.repeat(400)});
    const pages = await Promise.all([f.get('page=1'),f.get('page=2'),f.get('page=3')]);
    assert.deepEqual(pages.map(p=>p.has_more),[true,true,false]);
    assert.equal(new Set(pages.flatMap(p=>p.results.map(r=>r.comment_id))).size,46);
    const snippet=pages[0].results[0].excerpt; assert.match(snippet,/你好 链接 \[图片\]/); assert.ok(snippet.length<=240); assert.doesNotMatch(snippet,/onerror|javascript/);
    const summary=await f.get('summary=1'); assert.equal(summary.unread_count,46); assert.equal(summary.results,undefined);
  } finally { f.close(); }
});

test('游标翻页遇到新回复不会重复旧记录，同时间戳按编号稳定覆盖历史回复', async () => {
  const f = fixture();
  try {
    for(let id=1;id<=45;id++) f.add(id);
    const first=await f.get();
    assert.match(first.next_cursor,/^[1-9]\d*:[1-9]\d*$/);
    f.add(46);
    const second=await f.get(new URLSearchParams({cursor:first.next_cursor}));
    const third=await f.get(new URLSearchParams({cursor:second.next_cursor}));
    const ids=[...first.results,...second.results,...third.results].map(row=>row.comment_id);
    assert.deepEqual(ids,Array.from({length:45},(_,index)=>45-index));
    assert.equal(new Set(ids).size,45);assert.equal(second.total,46);assert.equal(third.has_more,false);
    assert.equal((await f.get()).results[0].comment_id,46);
  } finally { f.close(); }
});

test('游标前面的回复被回收或标为已读不会跳过仍可见的下一条', async () => {
  const f = fixture();
  try {
    for(let id=1;id<=45;id++) f.add(id,{time:f.start+1000+Math.floor(id/5)});
    const first=await f.get('unread=1');
    f.sqlite.exec('UPDATE comments SET deleted=1 WHERE id=45');
    await f.put({action:'read',comment_id:44});
    const second=await f.get(new URLSearchParams({unread:'1',cursor:first.next_cursor}));
    const third=await f.get(new URLSearchParams({unread:'1',cursor:second.next_cursor}));
    const older=[...second.results,...third.results].map(row=>row.comment_id);
    assert.deepEqual(older,Array.from({length:25},(_,index)=>25-index));
    assert.equal(second.unread_count,43);assert.equal(third.has_more,false);
    assert.equal(second.results[0].comment_id,25);
    const initialIds=new Set(first.results.map(row=>row.comment_id));assert.ok(older.every(id=>!initialIds.has(id)));
  } finally { f.close(); }
});

test('非法游标及混合偏移分页被拒绝，游标不能改变当前账号的接收范围', async () => {
  const f = fixture();
  try {
    for(const cursor of ['', '0:1','1:0','01:1','1:01','-1:2','1.5:2','1:2:3','1:9007199254740993','9007199254740993:1',"1:2' OR 1=1",'1'.repeat(65)]) {
      const query=new URLSearchParams({cursor});assert.equal((await getInbox(f.context(query))).status,400,cursor);
    }
    assert.equal((await getInbox(f.context('page=2&cursor=1%3A1'))).status,400);
    f.add(1);f.add(2,{post:2,author:3});
    const owned=await f.get();
    const other=await f.get(new URLSearchParams({cursor:owned.next_cursor,user_id:'1'}),{user:2});
    assert.ok(other.results.every(row=>row.post_id===2));
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM notification_reads').get().n,0);
  } finally { f.close(); }
});

test('鉴权、封禁、参数和未迁移数据库失败均有界，非法操作不产生回执', async () => {
  const f = fixture();
  try {
    assert.equal((await getInbox(f.context('',{user:0}))).status,401);
    f.sqlite.exec("UPDATE users SET status='banned' WHERE id=1");
    assert.equal((await getInbox(f.context())).status,403); assert.equal((await f.put({action:'read',comment_id:1})).status,403);
    f.sqlite.exec("UPDATE users SET status='active' WHERE id=1");
    for (const q of ['page=0','page=100001','limit=51','limit=-1','unread=true','summary=x']) assert.equal((await getInbox(f.context(q))).status,400,q);
    for (const payload of [{action:'read',comment_id:[1]},{action:'read',comment_id:'9007199254740993'},{action:'read_all',through_id:0},{action:'invalid'}]) assert.equal((await f.put(payload)).status,400);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM notification_reads').get().n,0);
    f.sqlite.exec("DELETE FROM system_settings WHERE key='site_inbox_started_at'"); assert.equal((await getInbox(f.context())).status,503);
  } finally { f.close(); }
});
