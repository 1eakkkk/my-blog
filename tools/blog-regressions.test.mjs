import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet as getPosts } from '../functions/api/posts.js';
import { onRequestGet as getComments } from '../functions/api/comments.js';
const { orderedListEdit, formatTime, relativeTime, timestamp } = createRequire(import.meta.url)('../blog-utils.js');

function insert(value, start = value.length, end = start) {
  const edit = orderedListEdit(value, start, end);
  return { value: value.slice(0, edit.start) + edit.text + value.slice(edit.end), start: edit.start + edit.selectStart, end: edit.start + edit.selectEnd };
}
test('列表按钮重复点击、手动编号和多行选区接续编号', () => {
  let edit = insert('');
  assert.equal(edit.value, '1. 列表项');
  edit = insert(edit.value, edit.start, edit.end);
  assert.equal(edit.value, '1. 列表项\n2. 列表项');
  edit = insert(edit.value, edit.start, edit.end);
  assert.equal(edit.value, '1. 列表项\n2. 列表项\n3. 列表项');
  assert.equal(insert('1. 手动输入\n').value, '1. 手动输入\n2. 列表项');
  assert.equal(insert('9. 手动输入').value, '9. 手动输入\n10. 列表项');
  assert.equal(insert('1.').value, '1.\n2. 列表项');
  assert.equal(insert('1. \n').value, '1. \n2. 列表项');
  assert.equal(insert('1. 已有\n甲\n乙', 6, 9).value, '1. 已有\n2. 甲\n3. 乙');
  assert.equal(insert('普通段落').value, '普通段落\n1. 列表项');
});
test('时间统一毫秒和 UTC+8，未知和未来时间不伪装为刚刚', () => {
  const ms = Date.parse('2026-10-10T16:00:00Z');
  assert.equal(formatTime(String(ms)), '2026-10-11 00:00:00 (UTC+8)');
  assert.equal(timestamp('2026-10-11T00:00:00+08:00'), ms);
  assert.equal(relativeTime(ms, ms + 5 * 3600000), '5小时前');
  assert.equal(relativeTime(null, ms), '时间未知');
  assert.equal(formatTime('2026-10-11 00:00:00'), '时间未知');
  assert.equal(relativeTime(ms + 7200000, ms), '2026-10-11 02:00:00 (UTC+8)');
});

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE users (id INTEGER, username TEXT, nickname TEXT, avatar_variant INTEGER, avatar_url TEXT, role TEXT);
    CREATE TABLE posts (id INTEGER, user_id INTEGER, title TEXT, content TEXT, category TEXT, created_at INTEGER, like_count INTEGER DEFAULT 0, is_pinned INTEGER DEFAULT 0, pinned_until INTEGER);
    CREATE TABLE comments (id INTEGER, post_id INTEGER, user_id INTEGER, content TEXT, created_at INTEGER, is_pinned INTEGER DEFAULT 0, reply_to_uid INTEGER);
    CREATE TABLE likes (target_id INTEGER, target_type TEXT, user_id INTEGER);
    INSERT INTO users VALUES (1, 'owner', '作者', 0, '', 'user'), (2, 'other', '其他用户', 0, '', 'user');`);
  const statement = sqlite.prepare('INSERT INTO posts (id,user_id,title,content,category,created_at) VALUES (?,?,?,?,?,?)');
  // 44 篇旧帖淹没在其他用户的 80 篇新帖之下。
  for (let i = 1; i <= 44; i++) statement.run(i, 1, '旧帖' + i, '内容', '灌水', Date.parse('2026-01-01T00:00:00Z') + i);
  for (let i = 45; i <= 124; i++) statement.run(i, 2, '新帖' + i, '内容', '技术', Date.parse('2026-10-01T00:00:00Z') + i);
  const db = { prepare(sql) { return { bind(...args) { const stmt = sqlite.prepare(sql); return { first: async () => stmt.get(...args), all: async () => ({ results: stmt.all(...args) }) }; } }; } };
  const context = query => ({ env: { DB: db }, request: new Request('https://test.local/api/posts?' + query) });
  return { sqlite, statement, context };
}
test('个人主页分页覆盖全部 44 篇旧帖，排序稳定且只返回指定作者', async () => {
  const f = fixture();
  try {
    const ids = [];
    for (let page = 1; page <= 3; page++) {
      const response = await getPosts(f.context(`user_id=1&page=${page}&limit=20`));
      assert.ok(Number(response.headers.get('X-Server-Time')) > 0);
      const posts = await response.json();
      assert.equal(posts.length, page < 3 ? 20 : 4);
      assert.ok(posts.every(p => p.user_id === 1));
      ids.push(...posts.map(p => p.id));
    }
    assert.equal(new Set(ids).size, 44);
    assert.equal(ids.at(-1), 1);
    const home = await (await getPosts(f.context('limit=10'))).json();
    assert.equal(home.length, 10);
    assert.equal(home[0].id, 124);
  } finally { f.sqlite.close(); }
});
test('日期日历与日期查询在 UTC+8 午夜边界一致，拒绝无效参数', async () => {
  const f = fixture();
  try {
    const start = Date.parse('2026-10-11T00:00:00+08:00');
    for (const [id, at] of [[125, start - 1], [126, start], [127, start + 86400000 - 1], [128, start + 86400000]]) f.statement.run(id, 1, '边界', '', '灌水', at);
    const posts = await (await getPosts(f.context('user_id=1&date=2026-10-11'))).json();
    assert.deepEqual(posts.map(p => p.id), [127,126]);
    const archive = await (await getPosts(f.context('user_id=1&archive=1'))).json();
    assert.equal(archive.days.find(d => d.date === '2026-10-11').count, 2);
    assert.equal(archive.days.find(d => d.date === '2026-01-01').count, 44);
    for (const query of ['user_id=0','user_id=1 OR 1=1','date=2026-02-30','date=invalid']) assert.equal((await getPosts(f.context(query))).status, 400);
    f.sqlite.exec(`INSERT INTO comments VALUES (1,126,1,'评论',${start + 1000},0,NULL)`);
    const comments = await getComments(f.context('post_id=126'));
    assert.ok(Number(comments.headers.get('X-Server-Time')) > 0);
    assert.equal((await comments.json()).results[0].created_at, start + 1000);
  } finally { f.sqlite.close(); }
});
