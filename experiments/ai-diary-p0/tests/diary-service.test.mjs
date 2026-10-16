import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { AUTHOR, CHANNEL, DiaryServiceError, getSourcePacket, publishDiary } from '../src/diary-service.js';

const NOW = Date.parse('2026-10-14T00:00:00+08:00');
const DATE = '2026-10-13';
const CONTENT = '【隔离测试】林某在虚构的一天整理植物、讨论读书计划，并准备继续阅读。';
const migration = readFileSync(new URL('../migrations/0001_probe.sql', import.meta.url), 'utf8');
const authMigration = readFileSync(new URL('../migrations/0002_auth.sql', import.meta.url), 'utf8');

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(migration);
  sqlite.exec(authMigration);
  let queue = Promise.resolve(), barrier = null;
  function prepare(sql, values = []) {
    return {
      sql, values,
      bind(...args) { return prepare(sql, args); },
      first: async () => sqlite.prepare(sql).get(...values) || null,
      all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
      run: async () => {
        const result = sqlite.prepare(sql).run(...values);
        return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      }
    };
  }
  const db = {
    prepare,
    async batch(statements) {
      if (statements.length === 4 && barrier) await barrier();
      const result = queue.then(() => {
        sqlite.exec('BEGIN IMMEDIATE');
        try {
          const results = statements.map(statement => {
            const result = sqlite.prepare(statement.sql).run(...statement.values);
            return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
          });
          sqlite.exec('COMMIT');
          return results;
        } catch (error) {
          sqlite.exec('ROLLBACK');
          throw error;
        }
      });
      queue = result.catch(() => {});
      return result;
    }
  };
  const counts = () => Object.fromEntries(['ai_diary_registry', 'probe_diaries', 'probe_events']
    .map(table => [table, sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));
  function simultaneousPublishes() {
    let arrivals = 0, release;
    const gate = new Promise(resolve => { release = resolve; });
    barrier = async () => { arrivals++; if (arrivals === 2) release(); await gate; };
    return () => arrivals;
  }
  return { sqlite, db, counts, simultaneousPublishes,
    beforePublish(callback) { barrier = callback; }, close: () => sqlite.close() };
}

function errorIs(status, code) {
  return error => error instanceof DiaryServiceError && error.status === status && error.code === code;
}

async function source(f, date = DATE, now = NOW) {
  return getSourcePacket(f.db, date, now);
}

async function publish(f, packet, content = CONTENT, now = NOW) {
  return publishDiary(f.db, { date: packet.date, content, sourceManifestId: packet.sourceManifestId }, now);
}

test('固定虚构来源快照稳定，清单的摘要和数量由服务端确定', async () => {
  const f = fixture();
  try {
    const a = await source(f), b = await source(f, DATE, NOW + 3600000);
    assert.deepEqual(a, b);
    assert.equal(a.synthetic, true); assert.equal(a.sourceManifest.noRealRecords, true);
    assert.equal(a.sourceManifest.messageCount, a.messages.length);
    assert.equal(a.snapshotId, 'diary-p0:2026-10-13:v1');
    assert.match(a.sourceManifest.serverHash, /^[a-f0-9]{64}$/);
    assert.ok(a.messages.every(message => message.content.startsWith('【固定虚构记录】')));
    assert.equal(a.previousReceipt, null); assert.equal(a.previousContent, null);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM probe_source_manifests').get().n, 1);
    f.sqlite.exec('UPDATE probe_source_manifests SET message_count=99');
    await assert.rejects(source(f), errorIs(503, 'SOURCE_INTEGRITY_FAILED'));
  } finally { f.close(); }
});

test('真实 UTC+8 日期、过去七日边界和零点切换', async () => {
  const f = fixture();
  try {
    await source(f, '2026-10-07');
    for (const date of ['2026-10-06', '2026-10-14', '2026-10-15']) {
      await assert.rejects(source(f, date), errorIs(400, 'DATE_OUT_OF_RANGE'));
    }
    for (const date of ['2026-02-30', '2026-10-1', '2026-13-01', null, 20261013]) {
      await assert.rejects(source(f, date), errorIs(400, 'INVALID_DATE'));
    }
    await assert.rejects(source(f, DATE, NOW - 1), errorIs(400, 'DATE_OUT_OF_RANGE'));
    const leapNow = Date.parse('2028-03-01T00:00:00+08:00');
    await source(f, '2028-02-29', leapNow);
    await assert.rejects(source(f, '2027-02-29', Date.parse('2027-03-01T00:00:00+08:00')), errorIs(400, 'INVALID_DATE'));
    await assert.rejects(source(f, DATE, NaN), errorIs(503, 'INVALID_CLOCK'));
  } finally { f.close(); }
});

test('非空/50000字符限制，清单必须存在且属于同一日期', async () => {
  const f = fixture();
  try {
    const packet = await source(f);
    await assert.rejects(publishDiary(f.db, null, NOW), errorIs(400, 'INVALID_INPUT'));
    for (const content of ['', ' \n\t ', null, {}, 'x'.repeat(50001)]) {
      await assert.rejects(publish(f, packet, content), errorIs(400, 'INVALID_CONTENT'));
    }
    const other = await source(f, '2026-10-12');
    await assert.rejects(publishDiary(f.db, { date: DATE, content: CONTENT, sourceManifestId: other.sourceManifestId }, NOW), errorIs(400, 'INVALID_MANIFEST'));
    const missing = await getSourcePacket(f.db, '2026-10-11', NOW);
    f.sqlite.prepare('DELETE FROM probe_source_manifests WHERE date=?').run(missing.date);
    await assert.rejects(publish(f, missing), errorIs(400, 'INVALID_MANIFEST'));
    const result = await publish(f, packet, 'x'.repeat(50000));
    assert.equal(result.status, 201);
  } finally { f.close(); }
});

test('首次原子发表，规范正文重试200，同日不同正文409', async () => {
  const f = fixture();
  try {
    const packet = await source(f);
    const first = await publish(f, packet, '  甲\r\n乙  '), retry = await publish(f, packet, '甲\n乙', NOW + 2000);
    assert.equal(first.status, 201); assert.equal(first.reused, false);
    assert.equal(retry.status, 200); assert.equal(retry.reused, true);
    assert.deepEqual(first.receipt, retry.receipt);
    assert.equal(first.receipt.author, AUTHOR); assert.equal(first.receipt.channel, CHANNEL);
    assert.equal(first.receipt.date, DATE); assert.equal(first.receipt.createdAt, NOW);
    assert.equal(f.sqlite.prepare('SELECT content FROM probe_diaries').get().content, '甲\n乙');
    await assert.rejects(publish(f, packet, '另一篇'), errorIs(409, 'CONFLICT'));
    assert.deepEqual(f.counts(), { ai_diary_registry: 1, probe_diaries: 1, probe_events: 1 });
    const reread = await source(f);
    assert.deepEqual(reread.previousReceipt, first.receipt);
    assert.equal(reread.previousContent, '甲\n乙');
  } finally { f.close(); }
});

test('人工修改展示正文后，原请求仍复用编号且不会覆盖修改', async () => {
  const f = fixture();
  try {
    const packet = await source(f), first = await publish(f, packet);
    f.sqlite.prepare('UPDATE probe_diaries SET content=?,updated_at=? WHERE id=?').run('人工校正的展示正文', NOW + 5000, first.receipt.postId);
    const reread = await source(f);
    assert.equal(reread.previousContent, CONTENT);
    const retry = await publish(f, reread, reread.previousContent);
    assert.equal(retry.status, 200); assert.equal(retry.receipt.postId, first.receipt.postId);
    assert.equal(f.sqlite.prepare('SELECT content FROM probe_diaries').get().content, '人工校正的展示正文');
    await assert.rejects(publish(f, packet, '人工校正的展示正文'), errorIs(409, 'CONFLICT'));
  } finally { f.close(); }
});

test('物理删除不释放日期，410优先于正文冲突，永久登记禁止删除/修改', async () => {
  const f = fixture();
  try {
    const packet = await source(f), first = await publish(f, packet);
    f.sqlite.prepare('DELETE FROM probe_diaries WHERE id=?').run(first.receipt.postId);
    await assert.rejects(publish(f, packet), errorIs(410, 'POST_DELETED'));
    await assert.rejects(publish(f, packet, '不同正文'), errorIs(410, 'POST_DELETED'));
    const reread = await source(f);
    assert.equal(reread.previousReceipt.postId, first.receipt.postId);
    assert.equal(reread.previousReceipt.deleted, true); assert.equal(reread.previousContent, CONTENT);
    assert.throws(() => f.sqlite.exec('DELETE FROM ai_diary_registry'), /permanent/);
    assert.throws(() => f.sqlite.exec("UPDATE ai_diary_registry SET date='2026-10-12'"), /immutable/);
    assert.deepEqual(f.counts(), { ai_diary_registry: 1, probe_diaries: 0, probe_events: 1 });
  } finally { f.close(); }
});

for (const stage of ['create', 'finalize']) {
  test(`数据库${stage}阶段抛错，认领/文章/发表审计全部回滚，原请求可重试`, async () => {
    const f = fixture();
    try {
      const packet = await source(f);
      const target = stage === 'create' ? 'BEFORE INSERT ON probe_diaries' : "BEFORE UPDATE ON ai_diary_registry WHEN NEW.state='PUBLISHED'";
      f.sqlite.exec(`CREATE TRIGGER injected_abort ${target} BEGIN SELECT RAISE(ABORT,'injected failure'); END`);
      await assert.rejects(publish(f, packet), errorIs(503, 'PUBLISH_FAILED'));
      assert.deepEqual(f.counts(), { ai_diary_registry: 0, probe_diaries: 0, probe_events: 0 });
      f.sqlite.exec('DROP TRIGGER injected_abort');
      assert.equal((await publish(f, packet)).status, 201);
    } finally { f.close(); }
  });
}

for (const stage of ['create', 'finalize']) {
  test(`条件${stage}写入零行也触发真实数据库回滚，不留下CLAIMED登记或孤立文章`, async () => {
    const f = fixture();
    try {
      const packet = await source(f);
      const target = stage === 'create' ? 'BEFORE INSERT ON probe_diaries' : "BEFORE UPDATE ON ai_diary_registry WHEN NEW.state='PUBLISHED'";
      f.sqlite.exec(`CREATE TRIGGER injected_zero ${target} BEGIN SELECT RAISE(IGNORE); END`);
      await assert.rejects(publish(f, packet), errorIs(503, 'PUBLISH_FAILED'));
      assert.deepEqual(f.counts(), { ai_diary_registry: 0, probe_diaries: 0, probe_events: 0 });
    } finally { f.close(); }
  });
}

test('认领nonce被抢换时所有后续条件写入停止并回滚', async () => {
  const f = fixture();
  try {
    const packet = await source(f);
    f.sqlite.exec(`CREATE TRIGGER changed_nonce AFTER INSERT ON ai_diary_registry BEGIN
      UPDATE ai_diary_registry SET claim_nonce='another-request' WHERE registry_id=NEW.registry_id;
    END`);
    await assert.rejects(publish(f, packet), errorIs(503, 'PUBLISH_FAILED'));
    assert.deepEqual(f.counts(), { ai_diary_registry: 0, probe_diaries: 0, probe_events: 0 });
  } finally { f.close(); }
});

test('来源在预检查后被修改，事务仍核对服务端固定样本，不接受过期校验', async () => {
  const f = fixture();
  try {
    const packet = await source(f);
    f.beforePublish(() => {
      f.sqlite.exec("UPDATE probe_source_manifests SET messages_json='[]'");
    });
    await assert.rejects(publish(f, packet), errorIs(503, 'PUBLISH_FAILED'));
    assert.deepEqual(f.counts(), { ai_diary_registry: 0, probe_diaries: 0, probe_events: 0 });
    await assert.rejects(source(f), errorIs(503, 'SOURCE_INTEGRITY_FAILED'));
  } finally { f.close(); }
});

test('内部grant缺省保留直接helper兼容，显式无效grant拒绝401，合法grant记入发表审计', async () => {
  const f = fixture();
  try {
    const packet = await source(f), input = { date: DATE, content: CONTENT, sourceManifestId: packet.sourceManifestId };
    for (const grantId of [undefined, null, '', 'space grant', 'g'.repeat(129)]) {
      await assert.rejects(publishDiary(f.db, { ...input, grantId }, NOW), errorIs(401, 'AUTH_REQUIRED'));
    }
    assert.deepEqual(f.counts(), { ai_diary_registry: 0, probe_diaries: 0, probe_events: 0 });
    assert.equal((await publishDiary(f.db, { ...input, grantId: 'grant-valid_test' }, NOW)).status, 201);
    assert.equal(f.sqlite.prepare("SELECT grant_id FROM probe_events WHERE event_type='DIARY_PUBLISHED'").get().grant_id, 'grant-valid_test');
  } finally { f.close(); }
});

test('发表前已经撤销的真实grant拒绝401，不认领日期或创建文章', async () => {
  const f = fixture();
  try {
    const packet = await source(f);
    f.sqlite.prepare('INSERT INTO revoked_grants(grant_id,revoked_at) VALUES (?,?)').run('grant-revoked', NOW);
    await assert.rejects(publishDiary(f.db, {
      date: DATE, content: CONTENT, sourceManifestId: packet.sourceManifestId, grantId: 'grant-revoked'
    }, NOW), errorIs(401, 'AUTH_REQUIRED'));
    assert.deepEqual(f.counts(), { ai_diary_registry: 0, probe_diaries: 0, probe_events: 0 });
  } finally { f.close(); }
});

test('预检查后、原子认领前撤销grant：SQL认领零行，整批回滚并返回401', async () => {
  const f = fixture();
  try {
    const packet = await source(f);
    f.beforePublish(() => {
      f.sqlite.prepare('INSERT INTO revoked_grants(grant_id,revoked_at) VALUES (?,?)').run('grant-race', NOW);
    });
    await assert.rejects(publishDiary(f.db, {
      date: DATE, content: CONTENT, sourceManifestId: packet.sourceManifestId, grantId: 'grant-race'
    }, NOW), errorIs(401, 'AUTH_REQUIRED'));
    assert.deepEqual(f.counts(), { ai_diary_registry: 0, probe_diaries: 0, probe_events: 0 });
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM revoked_grants').get().n, 1);
  } finally { f.close(); }
});

test('已发表后撤销授权：拒绝后续请求，永久成功登记和人工修改均不降级', async () => {
  const f = fixture();
  try {
    const packet = await source(f), input = {
      date: DATE, content: CONTENT, sourceManifestId: packet.sourceManifestId, grantId: 'grant-published'
    };
    const first = await publishDiary(f.db, input, NOW);
    f.sqlite.prepare('UPDATE probe_diaries SET content=? WHERE id=?').run('保留人工修改', first.receipt.postId);
    f.sqlite.prepare('INSERT INTO revoked_grants(grant_id,revoked_at) VALUES (?,?)').run(input.grantId, NOW + 1000);
    await assert.rejects(publishDiary(f.db, input, NOW + 2000), errorIs(401, 'AUTH_REQUIRED'));
    assert.equal(f.sqlite.prepare('SELECT state FROM ai_diary_registry').get().state, 'PUBLISHED');
    assert.equal(f.sqlite.prepare('SELECT content FROM probe_diaries').get().content, '保留人工修改');
    assert.deepEqual(f.counts(), { ai_diary_registry: 1, probe_diaries: 1, probe_events: 1 });
  } finally { f.close(); }
});

test('事务已提交但返回丢失时查询永久登记确认结果，随后重试不再创建', async () => {
  const f = fixture();
  try {
    const packet = await source(f), actualBatch = f.db.batch.bind(f.db);
    let loseResponse = true;
    f.db.batch = async statements => {
      const result = await actualBatch(statements);
      if (statements.length === 4 && loseResponse) {
        loseResponse = false;
        throw new Error('Synthetic transport response lost after commit');
      }
      return result;
    };
    const confirmed = await publish(f, packet), retry = await publish(f, packet);
    assert.equal(confirmed.status, 200); assert.equal(retry.status, 200);
    assert.deepEqual(confirmed.receipt, retry.receipt);
    assert.deepEqual(f.counts(), { ai_diary_registry: 1, probe_diaries: 1, probe_events: 1 });
  } finally { f.close(); }
});

test('两个同时通过预检查的相同请求：一201一200，共用永久登记与文章', async () => {
  const f = fixture();
  try {
    const packet = await source(f), arrivals = f.simultaneousPublishes();
    const results = await Promise.all([publish(f, packet), publish(f, packet)]);
    assert.equal(arrivals(), 2);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 201]);
    assert.equal(results[0].receipt.postId, results[1].receipt.postId);
    assert.deepEqual(f.counts(), { ai_diary_registry: 1, probe_diaries: 1, probe_events: 1 });
  } finally { f.close(); }
});

test('两个同时通过预检查的不同请求：仅一篇发表，另一个409且不覆盖获胜正文', async () => {
  const f = fixture();
  try {
    const packet = await source(f), arrivals = f.simultaneousPublishes();
    const results = await Promise.allSettled([publish(f, packet, '正文甲'), publish(f, packet, '正文乙')]);
    assert.equal(arrivals(), 2);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const loser = results.find(result => result.status === 'rejected');
    assert.ok(errorIs(409, 'CONFLICT')(loser.reason));
    const winnerIndex = results.findIndex(result => result.status === 'fulfilled');
    assert.equal(f.sqlite.prepare('SELECT content FROM probe_diaries').get().content, ['正文甲', '正文乙'][winnerIndex]);
    assert.deepEqual(f.counts(), { ai_diary_registry: 1, probe_diaries: 1, probe_events: 1 });
  } finally { f.close(); }
});

test('迁移可重复运行，普通OAuth审计事件兼容默认约束', () => {
  const f = fixture();
  try {
    f.sqlite.exec(migration);
    f.sqlite.prepare('INSERT INTO probe_events(event_type,grant_id,request_id,created_at,metadata_json) VALUES (?,?,?,?,?)')
      .run('oauth_refresh', 'grant-test', 'request-test', NOW, JSON.stringify({ synthetic: true }));
    assert.equal(f.sqlite.prepare('SELECT invariant_ok FROM probe_events').get().invariant_ok, 1);
  } finally { f.close(); }
});
