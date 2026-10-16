import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { fixture, sourceInput, NOW, DATE } from './integration-fixture.mjs';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export class WorkerEntrypoint {}', shortCircuit: true };
  return nextResolve(specifier, context);
} });
globalThis.Cloudflare = { compatibilityFlags: { global_fetch_strictly_public: true } };
const { apiHandler, READ, WRITE, configured, default: worker } = await import('../src/index.js');
const originalNow = Date.now;
Date.now = () => NOW;
test.after(() => { Date.now = originalNow; });
const GRANT = 'website-grant';
function context(scopes = [READ, WRITE]) {
  return { props: { channel: 'ai-diary', authorId: 'ChatGPT', grantId: GRANT },
    auth: { userId: 'blog-ai-diary', scope: scopes, clientId: 'fixture-client', token: 'private-token-sentinel' } };
}
async function rpc(f, ctx, method, params = {}) {
  const response = await apiHandler.fetch(new Request(`${f.env.PUBLIC_ORIGIN}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }), f.env, ctx);
  assert.equal(response.status, 200);
  const body = await response.text(); assert.ok(!body.includes('private-token-sentinel'));
  const wire = JSON.parse(body); assert.equal(wire.error, undefined, body); return wire.result;
}

test('actual MCP metadata honestly declares production writes and narrow OAuth scopes without configurable author/SQL', async () => {
  const f = fixture();
  try {
    const { tools } = await rpc(f, context(), 'tools/list');
    assert.equal(tools.length, 2);
    for (const [name, scope, readOnlyHint] of [['get_diary_source_packet', READ, true], ['publish_diary', WRITE, false]]) {
      const tool = tools.find(tool => tool.name === name);
      assert.deepEqual(tool._meta.securitySchemes, [{ type: 'oauth2', scopes: [scope] }]);
      assert.equal(tool.annotations.readOnlyHint, readOnlyHint);
      for (const key of ['authorId', 'grantId', 'channel', 'sql', 'database']) assert.equal(Object.hasOwn(tool.inputSchema.properties, key), false);
    }
    const publish = tools.find(tool => tool.name === 'publish_diary');
    assert.match(publish.description, /正式博客公开/); assert.match(publish.description, /test=true/);
    assert.equal(publish.annotations.openWorldHint, true);
    const read = tools.find(tool => tool.name === 'get_diary_source_packet');
    assert.ok(!read.inputSchema.required?.includes('date'));
    assert.equal(read.inputSchema.additionalProperties, false);
    assert.equal(read.inputSchema.properties.test.default, false);
    assert.ok(publish.inputSchema.required.includes('date'));
    assert.match(read.description, /省略 date/); assert.match(read.description, /真实时间/);
  } finally { f.close(); }
});

test('actual MCP omitted-date read returns the server-selected day and audits its resolved date and channel', async () => {
  const f = fixture();
  try {
    await f.insert();
    const { structuredContent: result } = await rpc(f, context(), 'tools/call', {
      name: 'get_diary_source_packet', arguments: {},
    });
    assert.equal(result.status, 'READY'); assert.equal(result.date, DATE);
    assert.equal(result.dateSelection, 'server_previous_day'); assert.equal(result.expectedDailyDate, DATE);
    assert.equal(result.serverTime, new Date(NOW).toISOString()); assert.equal(result.timeZone, 'Asia/Singapore');
    const audit = f.priv.sqlite.prepare("SELECT * FROM diary_events WHERE event_type='SOURCE_READ'").get();
    assert.equal(audit.date, DATE);
    assert.deepEqual(JSON.parse(audit.metadata_json), {
      channel: 'ai-diary', sourceManifestId: result.sourceManifestId, snapshotId: result.snapshotId,
      result: 'READY', clientId: 'fixture-client', serverTime: new Date(NOW).toISOString(),
      timeZone: 'Asia/Singapore', expectedDailyDate: DATE, dateSelection: 'server_previous_day',
    });
    assert.equal(audit.request_id, result.requestId);
  } finally { f.close(); }
});

test('actual MCP empty and explicit-test reads keep resolved audit dates and distinct channels', async () => {
  const f = fixture();
  try {
    const empty = await rpc(f, context(), 'tools/call', { name: 'get_diary_source_packet', arguments: {} });
    assert.equal(empty.structuredContent.status, 'SKIPPED_EMPTY');
    await f.insert(sourceInput({ test: true }));
    const testing = await rpc(f, context(), 'tools/call', { name: 'get_diary_source_packet', arguments: { test: true } });
    assert.equal(testing.structuredContent.channel, 'ai-diary-test');
    const audits = f.priv.sqlite.prepare('SELECT * FROM diary_events ORDER BY id').all();
    assert.equal(audits.length, 2);
    assert.ok(audits.every(row => row.date === DATE));
    assert.equal(audits[0].event_type, 'SKIPPED_EMPTY');
    assert.equal(JSON.parse(audits[0].metadata_json).channel, 'ai-diary');
    assert.equal(JSON.parse(audits[1].metadata_json).channel, 'ai-diary-test');
  } finally { f.close(); }
});

test('actual MCP strict read arguments reject a caller clock and invalid test flags without reading source data', async () => {
  const f = fixture();
  try {
    for (const arguments_ of [{ serverTime: new Date(NOW).toISOString() }, { date: DATE, authorId: 1 }, { test: 'true' }]) {
      const result = await rpc(f, context(), 'tools/call', { name: 'get_diary_source_packet', arguments: arguments_ });
      assert.equal(result.isError, true); assert.equal(result.structuredContent, undefined);
    }
    assert.equal(f.priv.sqlite.prepare('SELECT count(*) AS n FROM diary_events').get().n, 0);
    assert.equal(f.site.sqlite.prepare('SELECT count(*) AS n FROM ai_diary_registry').get().n, 0);
  } finally { f.close(); }
});

test('read-only permission and P0 identity cannot publish or select another author', async () => {
  const f = fixture();
  try {
    for (const ctx of [context([READ]), { ...context(), props: { channel: 'diary-p0', authorId: 'ai-diary-p0', grantId: GRANT } }]) {
      const result = await rpc(f, ctx, 'tools/call', { name: 'publish_diary', arguments: {
        date: DATE, title: '不应发出', content: '不应发出', sourceManifestId: 'absent', authorId: 1,
      } });
      assert.equal(result.isError, true); assert.equal(result.structuredContent.error, 'INSUFFICIENT_SCOPE');
      assert.match(result._meta['mcp/www_authenticate'][0], /scope="diary:site:publish"/);
    }
    assert.equal(f.site.sqlite.prepare('SELECT count(*) n FROM posts').get().n, 0);
    assert.equal(f.priv.sqlite.prepare('SELECT count(*) n FROM diary_source_packets').get().n, 0);
  } finally { f.close(); }
});

test('actual MCP read to publish creates one real-site-shaped post under the fixed account and reuses exact retry', async () => {
  const f = fixture();
  try {
    const row = await f.insert();
    const source = await rpc(f, context(), 'tools/call', { name: 'get_diary_source_packet', arguments: { date: DATE } });
    assert.equal(source.structuredContent.status, 'READY');
    const args = { date: DATE, title: '项目日记', content: '只总结人工提供的项目摘要。', sourceManifestId: row.id,
      authorId: 1, grantId: 'forged-grant' };
    const created = await rpc(f, context(), 'tools/call', { name: 'publish_diary', arguments: args });
    assert.equal(created.isError, false, JSON.stringify(created)); assert.equal(created.structuredContent.status, 201);
    const post = f.site.sqlite.prepare('SELECT * FROM posts').get(); assert.equal(post.user_id, 56);
    assert.equal(post.author_name, 'ChatGPT');
    const reused = await rpc(f, context(), 'tools/call', { name: 'publish_diary', arguments: args });
    assert.equal(reused.structuredContent.reused, true); assert.equal(reused.structuredContent.receipt.postId, post.id);
    assert.equal(f.site.sqlite.prepare('SELECT count(*) n FROM posts').get().n, 1);
    const logs = f.priv.sqlite.prepare('SELECT * FROM diary_events').all();
    assert.equal(logs.filter(row => row.event_type === 'MCP_PUBLISH_RECEIPT').length, 2);
    for (const forbidden of [args.content, args.title, 'private-token-sentinel', row.messages_json]) {
      assert.ok(!JSON.stringify(logs).includes(forbidden));
    }
    assert.ok(logs.every(row => row.grant_id === GRANT));
  } finally { f.close(); }
});

test('grant revoked after route validation is rejected before publication', async () => {
  const f = fixture();
  try {
    const row = await f.insert();
    const original = f.env.DB.prepare;
    let inject = true;
    f.env.DB.prepare = function(sql) {
      const prepared = original(sql);
      if (sql !== 'SELECT grant_id FROM revoked_grants WHERE grant_id=?') return prepared;
      return { bind(...args) {
        const bound = prepared.bind(...args);
        return { async first() {
          const value = await bound.first();
          if (inject) { inject = false; f.priv.sqlite.prepare('INSERT INTO revoked_grants VALUES (?,?)').run(GRANT, NOW); }
          return value;
        } };
      } };
    };
    const result = await rpc(f, context(), 'tools/call', { name: 'publish_diary', arguments: {
      date: DATE, title: '不应发出', content: '不应发出', sourceManifestId: row.id,
    } });
    assert.equal(result.structuredContent.error, 'AUTH_REQUIRED');
    assert.match(result._meta['mcp/www_authenticate'][0], /invalid_token/);
    assert.equal(f.site.sqlite.prepare('SELECT count(*) n FROM posts').get().n, 0);
  } finally { f.close(); }
});

test('missing/disabled/mixed bindings fail closed before any OAuth or site work', async () => {
  const f = fixture();
  try {
    assert.equal(configured(f.env), true);
    for (const override of [{ AI_AUTHOR_ID: '' }, { SITE_ORIGIN: 'https://evil.invalid/path' },
      { SITE_DB: f.env.DB }, { OAUTH_KV: undefined }, { SITE_PUBLISH_ENABLED: 'false' },
      { DIARY_ENVIRONMENT: 'synthetic-only' }, { PUBLIC_ORIGIN: 'http://publisher.example.test' }]) {
      const env = { ...f.env, ...override }; assert.equal(configured(env), false);
      const response = await worker.fetch(new Request(`${f.env.PUBLIC_ORIGIN}/oauth/register`), env, {});
      assert.equal(response.status, 503); assert.equal((await response.json()).error, 'PUBLISHER_NOT_CONFIGURED');
    }
    assert.equal(f.site.sqlite.prepare('SELECT count(*) n FROM posts').get().n, 0);
  } finally { f.close(); }
});

test('private retention still runs when site publishing is disabled', async () => {
  const f = fixture();
  try {
    f.priv.sqlite.prepare('INSERT INTO auth_tickets(token_hash,expires_at) VALUES (?,?)').run('expired', NOW);
    let pending;
    await worker.scheduled({}, { ...f.env, SITE_PUBLISH_ENABLED: 'false' }, { waitUntil(value) { pending = value; } });
    assert.ok(pending); await pending;
    assert.equal(f.priv.sqlite.prepare('SELECT count(*) n FROM auth_tickets').get().n, 0);
    assert.equal(f.site.sqlite.prepare('SELECT count(*) n FROM posts').get().n, 0);
  } finally { f.close(); }
});
