import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

// Exercise the exported Worker and its outer response wrapper, not just the
// provider. Only Cloudflare's platform base class is replaced in Node.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers') return {
    url: 'data:text/javascript,export class WorkerEntrypoint {}', shortCircuit: true,
  };
  return nextResolve(specifier, context);
} });
globalThis.Cloudflare = { compatibilityFlags: { global_fetch_strictly_public: true } };
// No request in this file may leave the in-memory Worker fixture.
globalThis.fetch = async () => { throw new Error('Worker response tests prohibit external requests'); };
const { default: worker } = await import('../src/index.js');

const ORIGIN = 'https://diary-p0.example.test';
const CALLBACK = 'https://chatgpt.com/connector_platform_oauth_redirect';
const SCOPES = ['diary:source:read', 'diary:site:publish', 'offline_access'];
const hash = value => createHash('sha256').update(value).digest('hex');

class MemoryKv {
  rows = new Map();
  async put(key, value, options = {}) {
    this.rows.set(key, { value, metadata: options.metadata,
      expires: options.expiration ? options.expiration * 1000
        : options.expirationTtl ? Date.now() + options.expirationTtl * 1000 : Infinity });
  }
  async get(key, options) {
    const row = this.rows.get(key);
    if (!row || row.expires <= Date.now()) { this.rows.delete(key); return null; }
    return options === 'json' || options?.type === 'json' ? JSON.parse(row.value) : row.value;
  }
  async delete(key) { this.rows.delete(key); }
  async list({ prefix = '' } = {}) {
    return { keys: [...this.rows].filter(([name, row]) => name.startsWith(prefix) && row.expires > Date.now())
      .map(([name, row]) => ({ name, metadata: row.metadata })), list_complete: true, cursor: '' };
  }
}

function fixture(extra = {}) {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0001_private.sql']) {
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  function prepare(sql, values = []) {
    return { sql, values, bind(...args) { return prepare(sql, args); },
      first: async () => sqlite.prepare(sql).get(...values) || null,
      all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
      run: async () => {
        const result = sqlite.prepare(sql).run(...values);
        return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      } };
  }
  const db = { prepare, async batch(statements) {
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(({ sql, values }) => {
        const result = sqlite.prepare(sql).run(...values);
        return { success: true, meta: { changes: Number(result.changes) } };
      });
      sqlite.exec('COMMIT'); return results;
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  const env = { PUBLIC_ORIGIN: ORIGIN, DIARY_ENVIRONMENT: 'site-publisher', SITE_PUBLISH_ENABLED: 'true', SITE_ORIGIN: 'https://blog.example.test', AI_AUTHOR_ID: '56', SITE_DB: { prepare() {}, batch() {} }, OAUTH_KV: new MemoryKv(), DB: db, ...extra };
  return { env, sqlite,
    dispatch: request => worker.fetch(request, env, { waitUntil() {}, passThroughOnException() {} }),
    close: () => sqlite.close() };
}

function defaultSecurity(response, policy = 'no-referrer') {
  assert.equal(response.headers.get('Referrer-Policy'), policy);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
}

async function register(f) {
  const response = await f.dispatch(new Request(`${ORIGIN}/oauth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      client_name: 'Synthetic Worker response regression', redirect_uris: [CALLBACK],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: 'none', scope: SCOPES.join(' ')
    })
  }));
  assert.equal(response.status, 201); defaultSecurity(response);
  return response.json();
}

async function consent(f, client, extra = {}) {
  const verifier = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({ response_type: 'code', client_id: client.client_id,
    redirect_uri: CALLBACK, resource: `${ORIGIN}/mcp`, scope: SCOPES.join(' '),
    state: 'synthetic-worker-response-state', code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), ...extra });
  const response = await f.dispatch(new Request(`${ORIGIN}/authorize?${query}`));
  const html = await response.text();
  return { response, html, handle: html.match(/name="handle" value="([^"]+)"/)?.[1],
    cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
}

function ticket(f) {
  const value = randomBytes(32).toString('base64url'), tokenHash = hash(value);
  f.sqlite.prepare('INSERT INTO auth_tickets(token_hash,expires_at,consumed_at) VALUES (?,?,NULL)')
    .run(tokenHash, Date.now() + 600000);
  return { value, hash: tokenHash };
}

function approval(flow, issued, extraHeaders = {}) {
  const body = new URLSearchParams({ handle: flow.handle, ticket: issued.value, decision: 'approve' });
  SCOPES.forEach(scope => body.append('scope', scope));
  const headers = new Headers({ Origin: ORIGIN, Cookie: flow.cookie, 'Sec-Fetch-Site': 'same-origin', ...extraHeaders });
  if (extraHeaders.Origin === undefined && Object.hasOwn(extraHeaders, 'Origin')) headers.delete('Origin');
  return new Request(`${ORIGIN}/authorize`, { method: 'POST', body, headers });
}

test('真实Worker入口保留成功GET授权HTML的same-origin，完整响应包装不再覆盖', async () => {
  const f = fixture();
  try {
    const client = await register(f), flow = await consent(f, client);
    assert.equal(flow.response.status, 200);
    defaultSecurity(flow.response, 'same-origin');
    assert.match(flow.response.headers.get('Content-Type'), /^text\/html/);
    assert.ok(flow.handle); assert.ok(flow.cookie);
    assert.match(flow.html, /<form method="post" action="\/authorize">/);
    assert.ok(flow.response.headers.get('Content-Security-Policy').includes(`form-action 'self' ${CALLBACK};`));
  } finally { f.close(); }
});

test('metadata、匿名MCP和无关/非法授权页均保持no-referrer', async () => {
  const f = fixture();
  try {
    for (const [route, status] of [
      ['/.well-known/oauth-protected-resource', 404],
      ['/.well-known/oauth-protected-resource/mcp', 200],
      ['/.well-known/oauth-authorization-server', 200],
      ['/mcp', 401], ['/not-found', 404], ['/authorize?ticket=synthetic-only', 400]
    ]) {
      const response = await f.dispatch(new Request(`${ORIGIN}${route}`));
      assert.equal(response.status, status, route); defaultSecurity(response);
    }
    const client = await register(f);
    const invalid = await consent(f, client, { redirect_uri: 'https://attacker.invalid/callback' });
    assert.equal(invalid.response.status, 400); defaultSecurity(invalid.response);
    assert.equal(invalid.response.headers.get('Location'), null);
    assert.ok(!invalid.response.headers.get('Content-Security-Policy').includes('attacker.invalid'));
  } finally { f.close(); }
});

test('最外层环境/异常错误和非授权POST响应保持no-referrer', async () => {
  const isolated = fixture({ DIARY_ENVIRONMENT: 'invalid-environment' });
  const broken = fixture({ PUBLIC_ORIGIN: `${ORIGIN}?invalid=1` });
  const f = fixture();
  try {
    for (const environment of [isolated, broken]) {
      const response = await environment.dispatch(new Request(`${ORIGIN}/authorize`));
      assert.equal(response.status, 503); defaultSecurity(response);
    }
    const revoked = await f.dispatch(new Request(`${ORIGIN}/operator/revoke`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grantId: 'synthetic-only' })
    }));
    assert.equal(revoked.status, 401); defaultSecurity(revoked);
    const tokenError = await f.dispatch(new Request(`${ORIGIN}/oauth/token`, {
      method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code' })
    }));
    assert.equal(tokenError.status, 401); defaultSecurity(tokenError);
  } finally { isolated.close(); broken.close(); f.close(); }
});

test('Origin:null经真实Worker仍拒绝且有效票据未消费，合法同源重试才能消费', async () => {
  const f = fixture();
  try {
    const client = await register(f), flow = await consent(f, client), issued = ticket(f);
    const rejected = await f.dispatch(approval(flow, issued, { Origin: 'null' }));
    assert.equal(rejected.status, 400); defaultSecurity(rejected);
    assert.equal(f.sqlite.prepare('SELECT consumed_at FROM auth_tickets WHERE token_hash=?').get(issued.hash).consumed_at, null);
    const event = f.sqlite.prepare("SELECT metadata_json FROM diary_events WHERE event_type='oauth_authorize_failure' ORDER BY id DESC LIMIT 1").get();
    assert.deepEqual(JSON.parse(event.metadata_json), { stage: 'post_origin', code: 'origin_mismatch', method: 'POST' });
    for (const forbidden of [issued.value, issued.hash, flow.handle, flow.cookie, client.client_id]) {
      assert.ok(!event.metadata_json.includes(forbidden));
    }
    const approved = await f.dispatch(approval(flow, issued));
    assert.equal(approved.status, 303); defaultSecurity(approved);
    assert.ok(f.sqlite.prepare('SELECT consumed_at FROM auth_tickets WHERE token_hash=?').get(issued.hash).consumed_at);
  } finally { f.close(); }
});

test('未提供Origin、跨站Origin或Fetch-Site仍拒绝，没有扩大POST允许来源', async () => {
  const f = fixture();
  try {
    const client = await register(f), issued = ticket(f);
    for (const headers of [{ Origin: undefined }, { Origin: 'https://chatgpt.com' },
      { Origin: 'https://attacker.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      const flow = await consent(f, client);
      const rejected = await f.dispatch(approval(flow, issued, headers));
      assert.equal(rejected.status, 400); defaultSecurity(rejected);
      assert.equal(f.sqlite.prepare('SELECT consumed_at FROM auth_tickets WHERE token_hash=?').get(issued.hash).consumed_at, null);
    }
  } finally { f.close(); }
});

test('成功授权303回调响应恢复no-referrer，外跳仅为已验证的精确ChatGPT回调', async () => {
  const f = fixture();
  try {
    const client = await register(f), flow = await consent(f, client), issued = ticket(f);
    const response = await f.dispatch(approval(flow, issued));
    assert.equal(response.status, 303); defaultSecurity(response);
    const location = new URL(response.headers.get('Location'));
    assert.equal(location.origin + location.pathname, CALLBACK);
    assert.equal(location.searchParams.get('state'), 'synthetic-worker-response-state');
    assert.ok(location.searchParams.has('code'));
    assert.ok(!location.href.includes(issued.value));
    assert.equal(response.headers.get('Content-Security-Policy').split(';')
      .map(value => value.trim()).find(value => value.startsWith('form-action ')), "form-action 'self'");
  } finally { f.close(); }
});
