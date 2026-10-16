import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// Only the Cloudflare platform import is stubbed. Requests exercise the actual
// installed MCP server and Web Standard HTTP transport, with an in-memory DB.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers') return {
    url: 'data:text/javascript,export class WorkerEntrypoint {}', shortCircuit: true,
  };
  return nextResolve(specifier, context);
} });
globalThis.Cloudflare = { compatibilityFlags: { global_fetch_strictly_public: true } };
const { apiHandler } = await import('../src/index.js');

const ORIGIN = 'https://diary-p0.example.test';
const READ = 'diary:read', WRITE = 'diary:publish';
const GRANT = 'trusted_test_grant';
const SECRET_MARKERS = ['synthetic_private_access_token', 'synthetic_private_refresh_token', 'synthetic_private_ticket'];
const DATE = new Date(Date.now() + 8 * 3600000 - 86400000).toISOString().slice(0, 10);
const migration = readFileSync(new URL('../migrations/0001_probe.sql', import.meta.url), 'utf8');
const authMigration = readFileSync(new URL('../migrations/0002_auth.sql', import.meta.url), 'utf8');

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(migration);
  sqlite.exec(authMigration);
  const queries = [];
  let afterGrantCheck;
  function prepare(sql, values = []) {
    return { sql, values,
      bind(...args) { return prepare(sql, args); },
      async first() {
        queries.push({ sql, values });
        const row = sqlite.prepare(sql).get(...values) || null;
        if (afterGrantCheck && sql === 'SELECT grant_id FROM revoked_grants WHERE grant_id=?') {
          const callback = afterGrantCheck;
          afterGrantCheck = null;
          callback();
        }
        return row;
      },
      async run() {
        queries.push({ sql, values });
        const result = sqlite.prepare(sql).run(...values);
        return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      }
    };
  }
  const db = { prepare,
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
  return { sqlite, db, queries, close: () => sqlite.close(),
    revoke(grantId) {
      sqlite.prepare('INSERT INTO revoked_grants (grant_id,revoked_at) VALUES (?,?)').run(grantId, Date.now());
    },
    afterGrantCheck(callback) { afterGrantCheck = callback; }
  };
}

function context(scopes, userId = 'diary-p0') {
  return {
    props: { channel: 'diary-p0', authorId: 'ai-diary-p0', grantId: GRANT },
    auth: { userId, scope: scopes, clientId: 'synthetic-client', token: SECRET_MARKERS[0],
      refreshToken: SECRET_MARKERS[1], ticket: SECRET_MARKERS[2] }
  };
}

async function rpc(f, ctx, method, params = {}) {
  const response = await apiHandler.fetch(new Request(`${ORIGIN}/mcp`, {
    method: 'POST', headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25',
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }), { PUBLIC_ORIGIN: ORIGIN, DB: f.db, PROBE_REQUEST_ID: 'synthetic-metadata-request' }, ctx);
  const body = await response.text();
  for (const marker of SECRET_MARKERS) assert.ok(!body.includes(marker), 'Response must not include credentials');
  assert.equal(response.status, 200, body);
  const wire = JSON.parse(body);
  assert.equal(wire.error, undefined, body);
  return wire.result;
}

function assertChallenge(result, scope, error = 'insufficient_scope') {
  assert.equal(result.isError, true);
  const challenges = result._meta?.['mcp/www_authenticate'];
  assert.equal(challenges?.length, 1);
  assert.equal(challenges[0], `Bearer error="${error}", error_description="${error === 'invalid_token'
    ? 'The diary test grant is unavailable or revoked.' : 'This diary tool requires the specified permission.'}", scope="${scope}", resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`);
  assert.ok(!challenges[0].includes('offline_access'));
}

test('tools/list emits exact per-tool OAuth scopes in the SDK compatibility mirror and truthful annotations', async () => {
  const f = fixture();
  try {
    const { tools } = await rpc(f, context([READ, WRITE]), 'tools/list');
    assert.equal(tools.length, 2);
    for (const [name, scope, readOnlyHint] of [
      ['get_diary_source_packet', READ, true], ['publish_diary', WRITE, false],
    ]) {
      const tool = tools.find(tool => tool.name === name);
      assert.deepEqual(tool._meta.securitySchemes, [{ type: 'oauth2', scopes: [scope] }]);
      if (tool.securitySchemes !== undefined) assert.deepEqual(tool.securitySchemes, tool._meta.securitySchemes);
      assert.deepEqual(tool.annotations, { readOnlyHint, destructiveHint: false, openWorldHint: false, idempotentHint: true });
      assert.ok(!Object.hasOwn(tool.inputSchema.properties, 'grantId'));
    }
    assert.equal(f.queries.length, 1);
  } finally { f.close(); }
});

test('read-only grant receives a write-only OAuth challenge and cannot publish through forged parameters', async () => {
  const f = fixture();
  try {
    const result = await rpc(f, context([READ]), 'tools/call', {
      name: 'publish_diary', arguments: {
        date: DATE, content: '【隔离测试】固定虚构日记。', sourceManifestId: 'synthetic-fixture',
        grantId: 'forged_grant', userId: 'diary-p0', scope: [WRITE],
      }, _meta: { securitySchemes: [{ type: 'oauth2', scopes: [WRITE] }] },
    });
    assert.deepEqual(result.structuredContent, { error: 'INSUFFICIENT_SCOPE', status: 403 });
    assertChallenge(result, WRITE);
    assert.equal(f.queries.length, 1, 'Scope denial must occur before any business query');
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM probe_diaries').get().n, 0);
  } finally { f.close(); }
});

test('missing read permission requests only the read scope', async () => {
  const f = fixture();
  try {
    const result = await rpc(f, context([WRITE]), 'tools/call', { name: 'get_diary_source_packet', arguments: { date: DATE } });
    assert.deepEqual(result.structuredContent, { error: 'INSUFFICIENT_SCOPE', status: 403 });
    assertChallenge(result, READ);
    assert.equal(f.queries.length, 1);
  } finally { f.close(); }
});

test('OAuth metadata does not bypass the fixed server-side author identity', async () => {
  const f = fixture();
  try {
    const result = await rpc(f, context([READ, WRITE], 'another-user'), 'tools/call', {
      name: 'publish_diary', arguments: { date: DATE, content: '固定虚构日记。', sourceManifestId: 'synthetic-fixture' },
    });
    assertChallenge(result, WRITE);
    assert.equal(f.queries.length, 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM probe_diaries').get().n, 0);
  } finally { f.close(); }
});

test('allowed publish uses the trusted context grant even when arguments supply a different grant', async () => {
  const f = fixture();
  try {
    const ctx = context([READ, WRITE]);
    const source = await rpc(f, ctx, 'tools/call', { name: 'get_diary_source_packet', arguments: { date: DATE } });
    assert.equal(source.isError, false);
    assert.equal(source._meta, undefined);
    f.revoke('forged_grant');
    const result = await rpc(f, ctx, 'tools/call', { name: 'publish_diary', arguments: {
      date: DATE, content: '【隔离测试】虚构人物整理植物。', sourceManifestId: source.structuredContent.sourceManifestId,
      grantId: 'forged_grant', authorId: 'another-author', scope: [],
    } });
    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.status, 201);
    assert.equal(result._meta, undefined);
    assert.equal(f.sqlite.prepare("SELECT grant_id FROM probe_events WHERE event_type='DIARY_PUBLISHED'").get().grant_id, GRANT);
    assert.ok(f.queries.filter(query => query.sql.includes('SELECT grant_id FROM revoked_grants'))
      .every(query => query.values[0] === GRANT));
  } finally { f.close(); }
});

test('grant revoked between route validation and publishing returns a tool-level invalid-token challenge', async () => {
  const f = fixture();
  try {
    const ctx = context([READ, WRITE]);
    const source = await rpc(f, ctx, 'tools/call', { name: 'get_diary_source_packet', arguments: { date: DATE } });
    f.afterGrantCheck(() => f.revoke(GRANT));
    const result = await rpc(f, ctx, 'tools/call', { name: 'publish_diary', arguments: {
      date: DATE, content: '【隔离测试】虚构人物整理植物。', sourceManifestId: source.structuredContent.sourceManifestId,
    } });
    assert.equal(result.structuredContent.error, 'AUTH_REQUIRED');
    assert.equal(result.structuredContent.status, 401);
    assertChallenge(result, WRITE, 'invalid_token');
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM probe_diaries').get().n, 0);
  } finally { f.close(); }
});
