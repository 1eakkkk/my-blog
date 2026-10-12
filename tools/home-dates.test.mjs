import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { onRequestGet as getPosts, onRequestPost as createPost, onRequestPut as editPost, onRequestDelete as deletePost } from '../functions/api/posts.js';
const utils = createRequire(import.meta.url)('../blog-utils.js');

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE users (id INTEGER, username TEXT, nickname TEXT, avatar_variant INTEGER, avatar_url TEXT, role TEXT);
    CREATE TABLE posts (id INTEGER, user_id INTEGER, title TEXT, content TEXT, category TEXT, created_at INTEGER, like_count INTEGER DEFAULT 0, is_pinned INTEGER DEFAULT 0, pinned_until INTEGER);
    CREATE TABLE comments (id INTEGER, post_id INTEGER, content TEXT, parent_id INTEGER, user_id INTEGER, created_at INTEGER);
    CREATE TABLE likes (target_id INTEGER, target_type TEXT, user_id INTEGER);
    INSERT INTO users VALUES (1,'owner','作者',0,'','user'), (2,'other','其他作者',0,'','user');`);
  sqlite.exec(readFileSync(new URL('../migrations/002_recycle.sql', import.meta.url), 'utf8'));
  const add = sqlite.prepare('INSERT INTO posts (id,user_id,title,content,category,created_at) VALUES (?,?,?,?,?,?)');
  const start = Date.parse('2026-10-11T00:00:00+08:00');
  add.run(1, 1, '相册 A', '图片', '生活', start - 1);
  add.run(2, 1, '相册 B', '图片', '生活', start);
  add.run(3, 2, '另一篇', '文字', '生活', start + 86400000 - 1);
  add.run(4, 2, '相册 C', '图片', '技术', start + 3600000);
  add.run(5, 1, '相册 D', '图片', '生活', start + 86400000);
  sqlite.exec("INSERT INTO comments VALUES (1,3,'相册里的回复',NULL,1,1000)");
  const db = { prepare(sql) { return { bind(...args) { const stmt = sqlite.prepare(sql); return { first: async () => stmt.get(...args), all: async () => ({ results: stmt.all(...args) }) }; } }; } };
  return { sqlite, context: query => ({ env: { DB: db }, request: new Request('https://test.local/api/posts?' + query) }) };
}

test('首页日期统计覆盖全站，组合搜索/分类且忽略当前选中的日期', async () => {
  const f = fixture();
  try {
    const all = await (await getPosts(f.context('archive=1'))).json();
    assert.equal(all.time_zone, 'UTC+8');
    assert.deepEqual(all.days, [{ date: '2026-10-12', count: 1 }, { date: '2026-10-11', count: 3 }, { date: '2026-10-10', count: 1 }]);
    const filtered = await (await getPosts(f.context('archive=1&search=相册&category=生活&date=2026-10-11'))).json();
    assert.deepEqual(filtered.days, [{ date: '2026-10-12', count: 1 }, { date: '2026-10-11', count: 2 }, { date: '2026-10-10', count: 1 }]);
    const author = await (await getPosts(f.context('archive=1&user_id=1'))).json();
    assert.deepEqual(author.days.map(day => day.count), [1, 1, 1]);
    const empty = await (await getPosts(f.context('archive=1&search=不存在'))).json();
    assert.deepEqual(empty.days, []);
  } finally { f.sqlite.close(); }
});

test('首页日期列表与日历统计使用相同条件和 UTC+8 午夜边界', async () => {
  const f = fixture();
  try {
    const posts = await (await getPosts(f.context('date=2026-10-11&search=相册&category=生活'))).json();
    assert.deepEqual(posts.map(p => p.id), [3, 2]);
    const nextDay = await (await getPosts(f.context('date=2026-10-12'))).json();
    assert.deepEqual(nextDay.map(p => p.id), [5]);
    const firstPage = await (await getPosts(f.context('date=2026-10-11&limit=1&page=1'))).json();
    const secondPage = await (await getPosts(f.context('date=2026-10-11&limit=1&page=2'))).json();
    assert.equal(firstPage[0].id, 3);
    assert.equal(secondPage[0].id, 4);
  } finally { f.sqlite.close(); }
});

test('帖子查询拒绝无效编号、日期、分页和超长搜索', async () => {
  const f = fixture();
  try {
    for (const query of ['id=x', 'id=9007199254740993', 'user_id=0', 'page=-1', 'page=2x', 'page=100001', 'limit=101', 'limit=0', 'date=2026-02-30', 'sort=invalid', 'category=invalid', 'search=' + 'x'.repeat(201)]) {
      assert.equal((await getPosts(f.context(query))).status, 400, query);
    }
  } finally { f.sqlite.close(); }
});

function authenticatedContext(method, body, user = { id: 1, role: 'user', status: 'active' }) {
  let writes = 0;
  const db = { prepare(sql) { return { bind() { return { first: async () => sql.includes('sessions') ? { ...user } : { user_id: 1 }, run: async () => { writes++; return { meta: { changes: 1 } }; } }; } }; } };
  return { context: { env: { DB: db }, request: new Request('https://test.local/api/posts?id=1', { method, headers: { Cookie: 'session_id=test', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) }, writes: () => writes };
}
test('发帖和编辑拒绝非文字内容与过长心情，封禁用户所有帖子写入均被拦截', async () => {
  for (const payload of [{ title: 123, content: '正文' }, { title: '标题', content: {} }, { title: '标题', content: '正文', mood: '<img>'.repeat(8) }]) {
    for (const [method, handler] of [['POST', createPost], ['PUT', editPost]]) {
      const f = authenticatedContext(method, { id: 1, action: 'edit', ...payload });
      assert.equal((await handler(f.context)).status, 400);
      assert.equal(f.writes(), 0);
    }
  }
  for (const [method, handler] of [['POST', createPost], ['PUT', editPost], ['DELETE', deletePost]]) {
    const f = authenticatedContext(method, method === 'DELETE' ? undefined : { id: 1, action: 'edit', title: '标题', content: '正文' }, { id: 1, role: 'admin', status: 'banned', ban_expires_at: 0 });
    assert.equal((await handler(f.context)).status, 403);
    assert.equal(f.writes(), 0);
  }
  for (const id of [[1], {}, 0, -1, '1 OR 1=1', '9007199254740993']) {
    const f = authenticatedContext('PUT', { id, action: 'edit', title: '标题', content: '正文' });
    assert.equal((await editPost(f.context)).status, 400);
    assert.equal(f.writes(), 0);
  }
});

test('日历仅采用有效日期与正整数计数，资源 URL 拒绝可执行协议、凭据及控制字符', () => {
  const data = utils.archiveData([{ date: '2026-10-11', count: 2 }, { date: '2026-02-30', count: 1 }, { date: "2026-10-12');alert(1)", count: 1 }, { date: '2026-10-12', count: -1 }]);
  assert.deepEqual([...data.days], [['2026-10-11', 2]]);
  assert.deepEqual(data.months, ['2026-10']);
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'vbscript:evil', 'https://user:password@test.local/image', 'java\nscript:alert(1)']) assert.equal(utils.safeUrl(url, 'https://test.local/'), '');
  assert.equal(utils.safeUrl('/api/files/avatar.ico', 'https://test.local/'), 'https://test.local/api/files/avatar.ico');
  assert.equal(utils.safeUrl('mailto:hello@example.com', 'https://test.local/', true), 'mailto:hello@example.com');
});

test('首页快速切换筛选时旧请求不能覆盖新结果，日期切换从第 1 页开始', async () => {
  const script = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
  const section = script.slice(script.indexOf('// === 帖子加载 ==='), script.indexOf('// === 单帖加载 ==='));
  const elements = new Map();
  for (const id of ['posts-list', 'loadMoreBtn', 'searchInput', 'categoryFilter', 'sortSelect', 'homeDateLabel', 'homeDateClear']) {
    let html = '';
    elements.set(id, { value: id === 'sortSelect' ? 'latest' : '', style: {}, hidden: false, textContent: '', cards: [], set innerHTML(value) { html = value; this.cards = []; }, get innerHTML() { return html; }, appendChild(card) { this.cards.push(card); }, scrollIntoView() {} });
  }
  const pending = [];
  const sandbox = {
    URLSearchParams, AbortController, Map, BlogUtils: utils, console,
    document: { getElementById: id => elements.get(id) || null, createElement: () => ({ setAttribute() {} }) },
    location: { href: 'https://test.local/', origin: 'https://test.local' },
    sessionStorage: { setItem() {} },
    fetchApi: (url, options) => new Promise(resolve => pending.push({ url, options, resolve })),
    escapeHtml: value => String(value ?? ''), stripMarkdown: value => value, extractImages: () => [], estimateReadTime: () => '', timeAgo: () => '刚刚', showToast() {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`const API_BASE='/api'; let currentPage=1; const POSTS_PER_PAGE=10; let isLoadingPosts=false; let hasMorePosts=true; let homePostsGeneration=0; let homePostsController=null; const homeArchiveState={date:'',days:new Map(),months:[],month:'',generation:0,loading:false,filters:JSON.stringify(['',''])}; function renderArchiveCalendar() {}`, sandbox);
  vm.runInContext(section, sandbox);
  const first = sandbox.loadPosts(true, false);
  elements.get('searchInput').value = '新搜索';
  const second = sandbox.loadPosts(true, false);
  assert.equal(pending[0].options.signal.aborted, true);
  pending[1].resolve({ ok: true, json: async () => [{ id: 2, title: '新结果', content: '', category: '生活' }] });
  await second;
  pending[0].resolve({ ok: true, json: async () => [{ id: 1, title: '旧结果', content: '', category: '生活' }] });
  await first;
  assert.equal(elements.get('posts-list').cards.length, 1);
  assert.match(elements.get('posts-list').cards[0].innerHTML, /新结果/);
  assert.doesNotMatch(elements.get('posts-list').cards[0].innerHTML, /旧结果/);
  vm.runInContext("homeArchiveState.filters=JSON.stringify(['新搜索','']); homeArchiveState.days.set('2026-10-11', 2); currentPage=8; hasMorePosts=false; selectHomeDate('2026-10-11')", sandbox);
  const selected = new URL(pending[2].url, 'https://test.local/');
  assert.equal(selected.searchParams.get('page'), '1');
  assert.equal(selected.searchParams.get('date'), '2026-10-11');
  assert.equal(elements.get('homeDateClear').hidden, false);
  assert.match(elements.get('homeDateLabel').textContent, /2026-10-11/);
  const requestCount = pending.length;
  sandbox.selectHomeDate('2026-10-10');
  assert.equal(pending.length, requestCount, '没有内容的日期不可选择');
  sandbox.selectHomeDate('');
  assert.equal(new URL(pending[3].url, 'https://test.local/').searchParams.has('date'), false);
  assert.equal(elements.get('homeDateClear').hidden, true);
  pending[2].resolve({ ok: true, json: async () => [] });
  pending[3].resolve({ ok: true, json: async () => [] });
  await new Promise(resolve => setImmediate(resolve));
  // 日期和新搜索组合；晚返回的旧日历不能清除仍有效的选中日期。
  elements.set('homeCalendar', { innerHTML: '' });
  vm.runInContext("homeArchiveState.date='2026-10-11'; homeArchiveState.days.set('2026-10-11', 2)", sandbox);
  elements.get('searchInput').value = '上一搜索';
  const third = sandbox.loadPosts(true);
  elements.get('searchInput').value = '最新搜索';
  const fourth = sandbox.loadPosts(true);
  assert.equal(new URL(pending[5].url, 'https://test.local/').searchParams.get('date'), '2026-10-11');
  assert.equal(new URL(pending[7].url, 'https://test.local/').searchParams.get('date'), '2026-10-11');
  pending[6].resolve({ ok: true, json: async () => ({ days: [{ date: '2026-10-11', count: 3 }] }) });
  pending[7].resolve({ ok: true, json: async () => [] });
  await fourth;
  await new Promise(resolve => setImmediate(resolve));
  pending[4].resolve({ ok: true, json: async () => ({ days: [] }) });
  pending[5].resolve({ ok: true, json: async () => [{ id: 1, title: '过时结果', content: '' }] });
  await third;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(vm.runInContext('homeArchiveState.date', sandbox), '2026-10-11');
  assert.match(elements.get('homeDateLabel').textContent, /3 篇帖子/);
  assert.equal(elements.get('posts-list').cards.length, 0);
});
