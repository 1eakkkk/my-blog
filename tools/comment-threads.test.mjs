import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet as getComments } from '../functions/api/comments.js';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY,username TEXT,nickname TEXT,avatar_variant INTEGER,avatar_url TEXT,role TEXT);
    CREATE TABLE comments (id INTEGER PRIMARY KEY,post_id INTEGER,user_id INTEGER,content TEXT,parent_id INTEGER,reply_to_uid INTEGER,created_at INTEGER,is_pinned INTEGER DEFAULT 0);
    CREATE TABLE likes (target_id INTEGER,target_type TEXT,user_id INTEGER);
    INSERT INTO users VALUES (1,'owner','作者',0,'','user');`);
  const stmt = sqlite.prepare('INSERT INTO comments(id,post_id,user_id,content,parent_id,created_at,is_pinned) VALUES (?,?,1,?,?,?,?)');
  const add = (id, parent = null, pinned = 0, post = 1) => stmt.run(id, post, '评论' + id, parent, 1000, pinned);
  function prepare(sql, args = []) {
    return { bind(...values) { assert.ok(values.length <= 100, 'D1 binding limit'); return prepare(sql, values); }, first: async () => sqlite.prepare(sql).get(...args),
      all: async () => ({ results: sqlite.prepare(sql).all(...args) }) };
  }
  const response = query => getComments({ request: new Request('https://test.local/api/comments?' + query), env: { DB: { prepare } } });
  const read = async query => { const r = await response(query); assert.equal(r.status, 200); return r.json(); };
  return { sqlite, add, read, response, close: () => sqlite.close() };
}

test('按讨论分页：上一页主评论的晚回复不会丢失，主评论楼层连续且无重复', async () => {
  const f = fixture();
  try {
    for (let id = 1; id <= 25; id++) f.add(id);
    f.add(26, 1);
    const first = await f.read('post_id=1');
    const second = await f.read('post_id=1&page=2');
    assert.equal(first.total, 26); assert.equal(first.root_total, 25); assert.equal(first.has_more, true);
    assert.equal(second.has_more, false);
    assert.ok(first.results.some(c => c.id === 26 && c.parent_id === 1));
    assert.deepEqual(second.results.map(c => c.floor), [21,22,23,24,25]);
    assert.equal(new Set([...first.results, ...second.results].map(c => c.id)).size, 26);
  } finally { f.close(); }
});

test('长讨论回复独立分页，首批有界、同时间戳顺序稳定，全部45条可读', async () => {
  const f = fixture();
  try {
    f.add(1); for (let id = 2; id <= 46; id++) f.add(id, 1);
    const first = await f.read('post_id=1');
    assert.equal(first.results.length, 21); assert.equal(first.has_more, false);
    const root = first.results.find(c => c.id === 1);
    assert.equal(root.reply_total, 45); assert.equal(root.reply_has_more, true);
    const second = await f.read('post_id=1&root_id=1&page=2');
    const third = await f.read('post_id=1&root_id=1&page=3');
    assert.equal(second.has_more, true); assert.equal(third.has_more, false);
    assert.deepEqual([...first.results.slice(1), ...second.results, ...third.results].map(c => c.id), Array.from({ length:45 }, (_,i)=>i+2));
  } finally { f.close(); }
});

test('置顶回复仍归属原讨论并推动讨论提前，楼层不会因为置顶改变', async () => {
  const f = fixture();
  try {
    for (let id = 1; id <= 25; id++) f.add(id);
    f.add(26, 25, 1); f.add(27, 25);
    const first = await f.read('post_id=1');
    assert.equal(first.results[0].id, 25); assert.equal(first.results[0].floor, 25);
    assert.equal(first.results[0].thread_pinned, 1);
    assert.deepEqual(first.results.filter(c=>c.parent_id===25).map(c=>c.id), [26,27]);
  } finally { f.close(); }
});

test('评论深链接直接定位后页主评论和第3页回复，不依赖逐页下载', async () => {
  const f = fixture();
  try {
    for (let id = 1; id <= 25; id++) f.add(id);
    for (let id = 26; id <= 70; id++) f.add(id, 25);
    const focused = await f.read('post_id=1&locate_id=70');
    assert.equal(focused.focused, true); assert.equal(focused.has_more, false);
    assert.equal(focused.results[0].id, 25); assert.equal(focused.results[0].floor, 25);
    assert.equal(focused.results[0].reply_page, 3); assert.equal(focused.results[0].reply_has_more, false);
    assert.deepEqual(focused.results.slice(1).map(c=>c.id), [66,67,68,69,70]);
    const rootFocus = await f.read('post_id=1&locate_id=25');
    assert.equal(rootFocus.results[0].reply_page, 1);
  } finally { f.close(); }
});

test('回复查询和定位拒绝跨帖、非主评论、已删除目标和非法参数', async () => {
  const f = fixture();
  try {
    f.add(1); f.add(2, 1); f.add(3, null, 0, 2); f.add(4, 3, 0, 2);
    for (const query of ['root_id=3','root_id=2','locate_id=4','locate_id=999']) assert.equal((await f.response('post_id=1&'+query)).status, 404);
    for (const query of ['root_id=0','locate_id=x','root_id=1&locate_id=2','page=0','limit=101']) assert.equal((await f.response('post_id=1&'+query)).status, 400);
  } finally { f.close(); }
});

test('最大请求页100个讨论仍遵守D1绑定参数上限', async () => {
  const f = fixture();
  try {
    for (let id = 1; id <= 100; id++) { f.add(id); f.add(id + 100, id); }
    const page = await f.read('post_id=1&limit=100');
    assert.equal(page.results.length, 200); assert.equal(page.has_more, false);
  } finally { f.close(); }
});
