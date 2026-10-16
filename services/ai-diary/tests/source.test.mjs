import test from 'node:test';
import assert from 'node:assert/strict';
import { getSourcePacket, freezeSourcePacket, loadValidatedSourcePacket, purgeExpiredPrivateData } from '../src/source.js';
import { fixture, sourceInput, NOW, DATE } from './integration-fixture.mjs';

test('source packet carries received-only coverage and fixed daily channel with a verified frozen digest', async () => {
  const f = fixture();
  try {
    const row = await f.insert();
    const result = await getSourcePacket(f.env, { date: DATE, test: false }, NOW);
    assert.equal(result.status, 'READY'); assert.equal(result.channel, 'ai-diary');
    assert.equal(result.sourceManifestId, row.id); assert.equal(result.sourceManifest.messageCount, 1);
    assert.equal(result.sourceManifest.sources[0].verification, 'received-data-consistency-only');
    assert.equal(result.previousReceipt, null);
    assert.equal(result.serverTime, new Date(NOW).toISOString());
    assert.equal(result.timeZone, 'Asia/Singapore');
    assert.equal(result.expectedDailyDate, DATE); assert.equal(result.dateSelection, 'explicit');
    assert.throws(() => f.priv.sqlite.prepare('UPDATE diary_source_packets SET messages_json=?').run('[]'), /cannot be overwritten/);
  } finally { f.close(); }
});

test('omitted date uses the server previous UTC+8 day and returns authoritative selection metadata', async () => {
  const f = fixture();
  try {
    await f.insert();
    for (const input of [{}, undefined]) {
      const result = await getSourcePacket(f.env, input, NOW);
      assert.equal(result.status, 'READY'); assert.equal(result.date, DATE);
      assert.equal(result.serverTime, '2026-10-15T00:00:00.000Z');
      assert.equal(result.timeZone, 'Asia/Singapore'); assert.equal(result.expectedDailyDate, DATE);
      assert.equal(result.dateSelection, 'server_previous_day'); assert.equal(result.channel, 'ai-diary');
    }
  } finally { f.close(); }
});

test('server date selection changes exactly at local midnight, including year and leap-day boundaries', async () => {
  const f = fixture();
  try {
    for (const [time, expected] of [
      ['2026-10-15T23:59:59.999+08:00', '2026-10-14'],
      ['2026-10-16T00:00:00.000+08:00', '2026-10-15'],
      ['2026-12-31T23:59:59.999+08:00', '2026-12-30'],
      ['2027-01-01T00:00:00.000+08:00', '2026-12-31'],
      ['2024-03-01T00:00:00.000+08:00', '2024-02-29'],
      ['2024-03-02T00:00:00.000+08:00', '2024-03-01'],
      ['2025-03-01T00:00:00.000+08:00', '2025-02-28'],
    ]) {
      const now = Date.parse(time), result = await getSourcePacket(f.env, {}, now);
      assert.equal(result.status, 'SKIPPED_EMPTY'); assert.equal(result.date, expected, time);
      assert.equal(result.expectedDailyDate, expected); assert.equal(result.serverTime, new Date(now).toISOString());
      assert.equal(result.dateSelection, 'server_previous_day');
    }
  } finally { f.close(); }
});

test('a stale conversation date cannot select a source unless explicitly supplied for backfill', async () => {
  const f = fixture();
  try {
    await f.insert();
    const now = Date.parse('2026-10-16T00:02:00+08:00');
    const stale = await getSourcePacket(f.env, { date: DATE }, now);
    assert.equal(stale.status, 'READY'); assert.equal(stale.date, '2026-10-14');
    assert.equal(stale.expectedDailyDate, '2026-10-15'); assert.equal(stale.dateSelection, 'explicit');
    const daily = await getSourcePacket(f.env, {}, now);
    assert.equal(daily.date, '2026-10-15'); assert.equal(daily.status, 'SKIPPED_EMPTY');
    assert.equal(daily.previousReceipt, null); assert.equal(daily.dateSelection, 'server_previous_day');
  } finally { f.close(); }
});

test('explicit daily backfill allows the seventh previous day but rejects today, future and older dates', async () => {
  const f = fixture();
  try {
    const now = Date.parse('2026-10-16T00:00:00+08:00');
    for (const date of ['2026-10-09', '2026-10-15']) {
      const result = await getSourcePacket(f.env, { date }, now);
      assert.equal(result.date, date); assert.equal(result.dateSelection, 'explicit');
      assert.equal(result.expectedDailyDate, '2026-10-15');
    }
    for (const date of ['2026-10-08', '2026-10-16', '2026-10-17']) {
      await assert.rejects(getSourcePacket(f.env, { date }, now), error => error.code === 'DATE_OUT_OF_RANGE');
    }
    await assert.rejects(getSourcePacket(f.env, { date: '2026-02-30' }, now), error => error.code === 'INVALID_DATE');
  } finally { f.close(); }
});

test('date selection rejects unknown fields, coercible test flags and invalid server clocks before reading data', async () => {
  const env = { DB: { prepare() { assert.fail('invalid input must not touch the private database'); } } };
  for (const input of [null, [], '2026-10-14', { authorId: 56 }, { now: NOW }, { test: 'true' },
    { test: 1 }, { test: null }]) {
    await assert.rejects(getSourcePacket(env, input, NOW), error => error.code === 'INVALID_INPUT');
  }
  for (const now of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER]) {
    await assert.rejects(getSourcePacket(env, {}, now), error => error.code === 'INVALID_CLOCK');
  }
  for (const date of [null, '', 1792022400000]) {
    await assert.rejects(getSourcePacket(env, { date }, NOW), error => error.code === 'INVALID_DATE');
  }
});

test('omitting a date never promotes test material into the daily channel or reserves either publication date', async () => {
  const f = fixture();
  try {
    await f.insert(sourceInput({ test: true }));
    const daily = await getSourcePacket(f.env, {}, NOW);
    assert.equal(daily.status, 'SKIPPED_EMPTY'); assert.equal(daily.channel, 'ai-diary');
    const testing = await getSourcePacket(f.env, { test: true }, NOW);
    assert.equal(testing.status, 'READY'); assert.equal(testing.channel, 'ai-diary-test');
    assert.equal(testing.date, DATE); assert.equal(testing.dateSelection, 'server_previous_day');
    assert.equal(f.site.sqlite.prepare('SELECT count(*) AS n FROM ai_diary_registry').get().n, 0);
  } finally { f.close(); }
});

test('missing source and successful empty source are skipped without reserving publication dates', async () => {
  const f = fixture();
  try {
    assert.equal((await getSourcePacket(f.env, { date: DATE }, NOW)).status, 'SKIPPED_EMPTY');
    const input = sourceInput({ messages: [] }); input.sources[0].messageCount = 0; input.sources[0].readStatus = 'SUCCESS';
    await f.insert(input);
    assert.equal((await getSourcePacket(f.env, { date: DATE }, NOW)).status, 'SKIPPED_EMPTY');
    assert.equal(f.site.sqlite.prepare('SELECT count(*) AS n FROM ai_diary_registry').get().n, 0);
  } finally { f.close(); }
});

test('all failed/unavailable sources are SOURCE_FAILED, distinct from genuine empty input', async () => {
  for (const readStatus of ['FAILED', 'UNAVAILABLE']) {
    const input = sourceInput({ messages: [] }); input.sources[0].messageCount = 0; input.sources[0].readStatus = readStatus;
    await assert.rejects(freezeSourcePacket(input, NOW), error => error.code === 'SOURCE_FAILED');
  }
});

test('source corruption or database errors fail closed and never masquerade as no material', async () => {
  const f = fixture();
  try {
    await f.insert();
    f.priv.sqlite.exec('DROP TRIGGER diary_source_packet_immutable');
    f.priv.sqlite.prepare('UPDATE diary_source_packets SET messages_json=?').run(JSON.stringify(sourceInput().messages.map(m => ({ ...m, content: 'corrupt' }))));
    await assert.rejects(loadValidatedSourcePacket(f.env.DB, { date: DATE }, NOW), error => error.code === 'SOURCE_FAILED');
    await assert.rejects(loadValidatedSourcePacket({ prepare() { throw new Error('private sentinel'); } }, { date: DATE }, NOW), error => error.code === 'SOURCE_FAILED' && !error.message.includes('sentinel'));
  } finally { f.close(); }
});

test('today needs explicit test mode and cannot borrow a source from the daily channel', async () => {
  const f = fixture();
  try {
    await assert.rejects(loadValidatedSourcePacket(f.env.DB, { date: '2026-10-15' }, NOW), error => error.code === 'DATE_OUT_OF_RANGE');
    const input = sourceInput({ date: '2026-10-15', test: true, snapshotId: 'project:2026-10-15:test' });
    input.messages[0].createdAt = Date.parse('2026-10-15T07:00:00+08:00');
    input.sources[0].coverageUntil = input.messages[0].createdAt;
    await f.insert(input);
    assert.equal((await getSourcePacket(f.env, { date: '2026-10-15', test: true }, NOW)).channel, 'ai-diary-test');
    assert.equal(await loadValidatedSourcePacket(f.env.DB, { date: DATE, test: true }, NOW), null);
  } finally { f.close(); }
});

test('ChatGPT coverage is explicitly a task report and never an assertion of complete collection', async () => {
  const input = sourceInput(); input.sources[0].type = 'chatgpt_task_report';
  await assert.rejects(freezeSourcePacket(input, NOW), error => error.code === 'SOURCE_FAILED');
  input.sources[0].coverageProof = 'task_report';
  const row = await freezeSourcePacket(input, NOW);
  assert.equal(JSON.parse(row.manifest_json).sources[0].coverageProof, 'task_report');
});

test('operator can freeze today daily material but it remains unreadable until the next day', async () => {
  const f = fixture();
  try {
    const input = sourceInput({ date: '2026-10-15', test: false, snapshotId: 'project:2026-10-15:daily' });
    input.messages[0].createdAt = Date.parse('2026-10-15T07:00:00+08:00');
    input.sources[0].coverageUntil = input.messages[0].createdAt;
    const row = await f.insert(input);
    assert.equal(row.channel, 'ai-diary');
    await assert.rejects(getSourcePacket(f.env, { date: input.date }, NOW), error => error.code === 'DATE_OUT_OF_RANGE');
    const result = await getSourcePacket(f.env, { date: input.date }, Date.parse('2026-10-16T00:00:00+08:00'));
    assert.equal(result.status, 'READY'); assert.equal(result.sourceManifest.sources[0].coverageUntil, input.messages[0].createdAt);
  } finally { f.close(); }
});

test('retention cleanup deletes only expired private sources/tickets/old metadata and leaves site registry alone', async () => {
  const f = fixture();
  try {
    const row = await f.insert();
    f.priv.sqlite.prepare('INSERT INTO auth_tickets(token_hash,expires_at) VALUES (?,?)').run('expired', NOW);
    f.priv.sqlite.prepare('INSERT INTO diary_events(event_type,created_at) VALUES (?,?)').run('OLD', NOW - 31 * 86400000);
    await purgeExpiredPrivateData(f.env, row.expires_at);
    assert.equal(f.priv.sqlite.prepare('SELECT count(*) AS n FROM diary_source_packets').get().n, 0);
    assert.equal(f.priv.sqlite.prepare('SELECT count(*) AS n FROM auth_tickets').get().n, 0);
    assert.equal(f.priv.sqlite.prepare('SELECT count(*) AS n FROM diary_events').get().n, 0);
    assert.ok(f.site.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='ai_diary_registry'").get());
  } finally { f.close(); }
});
