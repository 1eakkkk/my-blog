import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { DiaryPublicationError, TEST_NOTICE, validateDiaryDate, getPublicationState, publishSiteDiary } from '../src/publication.js';
import { freezeSourcePacket } from '../src/source.js';

const NOW = Date.parse('2026-10-15T22:00:00+08:00');
const DATE = '2026-10-14';
const TITLE = '一天的项目记录';
const CONTENT = '当天讨论了项目发布，确认了手动测试与自动定时验证的区别。';
const migration = readFileSync(new URL('../../../migrations/004_ai_diary.sql', import.meta.url), 'utf8');

function wrapper(sqlite) {
  let queue = Promise.resolve(), beforeBatch = null;
  function prepare(sql, values = []) {
    return { sql, values, bind(...args) { return prepare(sql, args); },
      first: async () => sqlite.prepare(sql).get(...values) || null,
      all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
      run: async () => { const r = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; } };
  }
  return { prepare, beforeBatch(fn) { beforeBatch = fn; }, async batch(statements) {
    if (beforeBatch) await beforeBatch(statements);
    const pending = queue.then(() => {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(s => { const r = sqlite.prepare(s.sql).run(...s.values); return { meta: { changes: Number(r.changes) } }; });
        sqlite.exec('COMMIT'); return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    });
    queue = pending.catch(() => {}); return pending;
  } };
}

function fixture() {
  const site = new DatabaseSync(':memory:'), source = new DatabaseSync(':memory:');
  site.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,nickname TEXT,status TEXT,ban_expires_at INTEGER);
    CREATE TABLE posts(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,author_name TEXT,title TEXT,content TEXT,category TEXT,mood TEXT,created_at INTEGER,updated_at INTEGER);
    CREATE TABLE content_recycle(kind TEXT,target_id INTEGER,PRIMARY KEY(kind,target_id));
    INSERT INTO users VALUES(56,'ChatGPT',NULL,'active',0),(57,'someone-else','其他作者','active',0);`);
  site.exec(migration);
  source.exec(`CREATE TABLE diary_source_packets(id TEXT PRIMARY KEY,date TEXT,channel TEXT,snapshot_id TEXT,manifest_json TEXT,messages_json TEXT,created_at INTEGER,expires_at INTEGER,UNIQUE(date,channel));`);
  const SITE_DB = wrapper(site), DB = wrapper(source);
  return { site, source, env: { DB, SITE_DB, AI_AUTHOR_ID: '56', SITE_ORIGIN: 'https://app.1eak.cool' },
    counts: () => ['posts', 'ai_diary_registry', 'ai_diary_publication_commits'].map(t => site.prepare(`SELECT count(*) n FROM ${t}`).get().n),
    close() { site.close(); source.close(); } };
}

async function packet(f, date = DATE, test = false, messages = null) {
  const start = Date.parse(`${date}T00:00:00+08:00`);
  const material = messages ?? [{ id: `note:${date}`, role: 'summary', createdAt: start + 12 * 3600000, content: CONTENT }];
  const row = await freezeSourcePacket({ date, test, snapshotId: `curated:${date}:${test ? 'test' : 'daily'}`,
    messages: material, coverage: '仅包含人工整理的一条项目工作摘要，不代表当天全部聊天。',
    sources: [{ id: 'curated', type: 'human_curated_project_summary', readStatus: 'SUCCESS', messageCount: material.length,
      scannedAt: NOW, coverageUntil: Math.min(start + 24 * 3600000, NOW), verification: 'received-data-consistency-only' }] }, NOW);
  f.source.prepare('INSERT INTO diary_source_packets VALUES(?,?,?,?,?,?,?,?)')
    .run(row.id, row.date, row.channel, row.snapshot_id, row.manifest_json, row.messages_json, row.created_at, row.expires_at);
  return { date, test, title: TITLE, content: CONTENT, sourceManifestId: row.id };
}

const errorIs = (status, code) => error => error instanceof DiaryPublicationError && error.status === status && (!code || error.code === code);

test('真实日期和UTC+8日界：日记不含今天，测试渠道可当天，七日与闰年边界正确', () => {
  assert.equal(validateDiaryDate(DATE, NOW).channel, 'ai-diary');
  assert.equal(validateDiaryDate('2026-10-15', NOW, { test: true }).channel, 'ai-diary-test');
  validateDiaryDate('2026-10-08', NOW);
  for (const date of ['2026-10-07', '2026-10-15', '2026-10-16']) assert.throws(() => validateDiaryDate(date, NOW), errorIs(400, 'DATE_OUT_OF_RANGE'));
  for (const date of ['2026-02-30', '2026-1-01', 20261014]) assert.throws(() => validateDiaryDate(date, NOW), errorIs(400, 'INVALID_DATE'));
  validateDiaryDate('2028-02-29', Date.parse('2028-03-01T00:00:00+08:00'));
  assert.throws(() => validateDiaryDate(DATE, NaN), errorIs(503));
  assert.throws(() => validateDiaryDate(DATE, NOW, { test: 'true' }), errorIs(400));
});

test('固定作者正式新建、相同规范请求复用、不同标题/正文/manifest冲突', async () => {
  const f = fixture(); try {
    const input = await packet(f);
    const first = await publishSiteDiary(f.env, { ...input, content: `  甲\r\n乙  ` }, NOW);
    const retry = await publishSiteDiary(f.env, { ...input, content: '甲\n乙' }, NOW + 1000);
    assert.equal(first.status, 201); assert.equal(first.reused, false);
    assert.equal(retry.status, 200); assert.deepEqual(retry.receipt, first.receipt);
    assert.equal(first.receipt.authorId, 56); assert.equal(first.receipt.author, 'ChatGPT');
    assert.equal(first.receipt.date, DATE); assert.equal(first.receipt.createdAt, NOW);
    assert.equal(first.receipt.url, `https://app.1eak.cool/#post?id=${first.receipt.postId}`);
    const stored = f.site.prepare('SELECT * FROM posts').get();
    assert.equal(stored.content, '甲\n乙'); assert.equal(stored.category, '生活'); assert.equal(stored.created_at, NOW);
    for (const patch of [{ title: '新标题' }, { content: '新正文' }, { sourceManifestId: 'other' }]) {
      await assert.rejects(publishSiteDiary(f.env, { ...input, content: '甲\n乙', ...patch }, NOW), errorIs(409, 'CONFLICT'));
    }
    assert.deepEqual(f.counts(), [1, 1, 1]);
  } finally { f.close(); }
});

test('测试渠道强制标题/正文标记，且不占正式渠道的同日名额', async () => {
  const f = fixture(); try {
    const daily = await packet(f), trial = await packet(f, DATE, true), today = await packet(f, '2026-10-15', true);
    await publishSiteDiary(f.env, trial, NOW); await publishSiteDiary(f.env, daily, NOW); await publishSiteDiary(f.env, today, NOW);
    const rows = f.site.prepare('SELECT * FROM posts ORDER BY id').all();
    assert.ok(rows[0].title.startsWith('【发布测试】')); assert.ok(rows[0].content.startsWith(TEST_NOTICE));
    assert.equal(rows[1].content, CONTENT); assert.deepEqual(f.counts(), [3, 3, 3]);
    const previous = await getPublicationState(f.env.SITE_DB, { date: DATE, test: true }, f.env, NOW);
    const retry = await publishSiteDiary(f.env, { ...trial, title: previous.previousTitle, content: previous.previousContent }, NOW);
    assert.equal(retry.status, 200); assert.equal(retry.receipt.channel, 'ai-diary-test');
  } finally { f.close(); }
});

test('人工编辑保留；原始请求和回执在来源清理后仍可复用，重绑作者不释放名额', async () => {
  const f = fixture(); try {
    const input = await packet(f), first = await publishSiteDiary(f.env, input, NOW);
    f.site.prepare('UPDATE posts SET title=?,content=?,updated_at=? WHERE id=?').run('人工标题', '人工正文', NOW + 1, first.receipt.postId);
    f.source.exec('DELETE FROM diary_source_packets');
    const state = await getPublicationState(f.env.SITE_DB, input, f.env, NOW);
    assert.equal(state.previousTitle, TITLE); assert.equal(state.previousContent, CONTENT);
    const retry = await publishSiteDiary({ ...f.env, AI_AUTHOR_ID: '57' }, input, NOW + 9 * 86400000);
    assert.equal(retry.status, 200); assert.equal(retry.receipt.authorId, 56);
    assert.equal(f.site.prepare('SELECT content FROM posts').get().content, '人工正文');
    assert.throws(() => f.site.exec('DELETE FROM ai_diary_registry'), /permanent/);
    assert.throws(() => f.site.exec("UPDATE ai_diary_registry SET author_id=57"), /immutable/);
  } finally { f.close(); }
});

for (const method of ['recycle', 'delete']) test(`${method}后同请求或不同正文均410，永久登记和原回执仍保留`, async () => {
  const f = fixture(); try {
    const input = await packet(f), first = await publishSiteDiary(f.env, input, NOW);
    if (method === 'delete') f.site.prepare('DELETE FROM posts WHERE id=?').run(first.receipt.postId);
    else f.site.prepare("INSERT INTO content_recycle VALUES('post',?)").run(first.receipt.postId);
    for (const content of [CONTENT, '其他正文']) await assert.rejects(publishSiteDiary(f.env, { ...input, content }, NOW), errorIs(410, 'POST_DELETED'));
    const state = await getPublicationState(f.env.SITE_DB, input, f.env, NOW);
    assert.equal(state.previousReceipt.deleted, true); assert.equal(state.previousReceipt.postId, first.receipt.postId);
    assert.equal(f.site.prepare('SELECT COUNT(*) n FROM ai_diary_registry').get().n, 1);
  } finally { f.close(); }
});

test('缺失/有效封禁账号、无效环境、可伪造作者字段和超限请求均拒绝', async () => {
  const f = fixture(); try {
    const input = await packet(f);
    await assert.rejects(publishSiteDiary({ ...f.env, AI_AUTHOR_ID: '999' }, input, NOW), errorIs(403, 'AUTHOR_UNAVAILABLE'));
    f.site.exec("UPDATE users SET status='banned',ban_expires_at=0 WHERE id=56");
    await assert.rejects(publishSiteDiary(f.env, input, NOW), errorIs(403, 'AUTHOR_UNAVAILABLE'));
    f.site.exec(`UPDATE users SET ban_expires_at=${NOW - 1} WHERE id=56`);
    for (const env of [{ AI_AUTHOR_ID: '56 OR 1' }, { SITE_ORIGIN: 'http://app.1eak.cool' }, { SITE_ORIGIN: 'https://app.1eak.cool/other' }])
      await assert.rejects(publishSiteDiary({ ...f.env, ...env }, input, NOW), errorIs(503, 'INVALID_CONFIGURATION'));
    for (const patch of [{ authorId: 57 }, { test: 'true' }, { title: 'x\ny' }, { content: '' }, { content: 'x'.repeat(50001) }])
      await assert.rejects(publishSiteDiary(f.env, { ...input, ...patch }, NOW), errorIs(400));
    assert.deepEqual(f.counts(), [0, 0, 0]);
    assert.equal((await publishSiteDiary(f.env, input, NOW)).status, 201);
  } finally { f.close(); }
});

test('私有来源缺失、跨日期/渠道、摘要篡改、空素材均不能占日期', async () => {
  const f = fixture(); try {
    const input = await packet(f);
    await assert.rejects(publishSiteDiary(f.env, { ...input, sourceManifestId: 'wrong' }, NOW), errorIs(400, 'INVALID_MANIFEST'));
    await assert.rejects(publishSiteDiary(f.env, { ...input, test: true }, NOW), errorIs(400, 'INVALID_MANIFEST'));
    const original = f.source.prepare('SELECT messages_json FROM diary_source_packets').get().messages_json;
    f.source.exec(`UPDATE diary_source_packets SET messages_json='[]'`);
    await assert.rejects(publishSiteDiary(f.env, input, NOW), errorIs(503, 'SOURCE_FAILED'));
    f.source.prepare('UPDATE diary_source_packets SET messages_json=?').run(original);
    const empty = await packet(f, '2026-10-13', false, []);
    await assert.rejects(publishSiteDiary(f.env, empty, NOW), errorIs(400, 'SOURCE_EMPTY'));
    f.source.exec(`UPDATE diary_source_packets SET expires_at=${NOW}`);
    await assert.rejects(publishSiteDiary(f.env, input, NOW), errorIs(400, 'INVALID_MANIFEST'));
    assert.deepEqual(f.counts(), [0, 0, 0]);
  } finally { f.close(); }
});

for (const step of ['claim', 'post', 'finalize']) test(`${step}阶段静默零行会触发最终约束并全部回滚`, async () => {
  const f = fixture(); try {
    const input = await packet(f);
    const target = step === 'post' ? 'posts' : 'ai_diary_registry';
    const event = step === 'finalize' ? 'UPDATE' : 'INSERT';
    f.site.exec(`CREATE TRIGGER swallow BEFORE ${event} ON ${target} BEGIN SELECT RAISE(IGNORE); END;`);
    await assert.rejects(publishSiteDiary(f.env, input, NOW), errorIs(503, 'PUBLISH_FAILED'));
    assert.deepEqual(f.counts(), [0, 0, 0]);
    f.site.exec('DROP TRIGGER swallow');
    assert.equal((await publishSiteDiary(f.env, input, NOW)).status, 201);
  } finally { f.close(); }
});

test('事务内账号被封禁会回滚，不能仅依赖事务外预检', async () => {
  const f = fixture(); try {
    const input = await packet(f); let once = false;
    f.env.SITE_DB.beforeBatch(async () => { if (!once) { once = true; f.site.exec("UPDATE users SET status='banned' WHERE id=56"); } });
    await assert.rejects(publishSiteDiary(f.env, input, NOW), errorIs(403, 'AUTHOR_UNAVAILABLE'));
    assert.deepEqual(f.counts(), [0, 0, 0]);
  } finally { f.close(); }
});

for (const same of [true, false]) test(`并发${same ? '相同' : '不同'}请求只新建一次，同毫秒也不串认领`, async () => {
  const f = fixture(); try {
    const input = await packet(f); let arrivals = 0, release;
    const gate = new Promise(resolve => { release = resolve; });
    f.env.SITE_DB.beforeBatch(async () => { if (++arrivals === 2) release(); await gate; });
    const result = await Promise.allSettled([publishSiteDiary(f.env, input, NOW), publishSiteDiary(f.env, { ...input, content: same ? CONTENT : '另一篇正文' }, NOW)]);
    assert.equal(arrivals, 2); assert.deepEqual(f.counts(), [1, 1, 1]);
    if (same) assert.deepEqual(result.map(r => r.value.status).sort(), [200, 201]);
    else { assert.equal(result.filter(r => r.status === 'fulfilled').length, 1); assert.ok(errorIs(409, 'CONFLICT')(result.find(r => r.status === 'rejected').reason)); }
  } finally { f.close(); }
});

test('永久登记若指向其他作者帖子则拒绝，不返回该帖内容或回执', async () => {
  const f = fixture(); try {
    const input = await packet(f), first = await publishSiteDiary(f.env, input, NOW);
    f.site.prepare('UPDATE posts SET user_id=57 WHERE id=?').run(first.receipt.postId);
    await assert.rejects(getPublicationState(f.env.SITE_DB, input, f.env, NOW), errorIs(503, 'PUBLICATION_INTEGRITY_FAILED'));
    await assert.rejects(publishSiteDiary(f.env, input, NOW), errorIs(503, 'PUBLICATION_INTEGRITY_FAILED'));
  } finally { f.close(); }
});
