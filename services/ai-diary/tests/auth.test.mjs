import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// The package's WorkerEntrypoint type is its only platform import. These tests
// exercise object fetch handlers; real Workers execution is verified separately.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers') return {
    url: 'data:text/javascript,export class WorkerEntrypoint {}', shortCircuit: true,
  };
  return nextResolve(specifier, context);
} });
globalThis.Cloudflare = { compatibilityFlags: { global_fetch_strictly_public: true } };
const { AuthorizationError, CimdFetchError, GrantType, OAuthProvider } = await import('@cloudflare/workers-oauth-provider');
const {
  makeProvider, hashAuthTicket, consumeAuthTicket, validateGrantExchange, AUTH_PROPS,
  AUTH_SCOPES, AUTH_USER_ID, ACCESS_TOKEN_TTL, REFRESH_IDLE_TTL,
} = await import('../src/auth.js');
const { apiHandler } = await import('../src/index.js');

const ORIGIN = 'https://diary-p0.example.test';
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';

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
    return (options === 'json' || options?.type === 'json') ? JSON.parse(row.value) : row.value;
  }
  async delete(key) { this.rows.delete(key); }
  async list({ prefix = '' } = {}) {
    const keys = [...this.rows.entries()].filter(([key, row]) => key.startsWith(prefix) && row.expires > Date.now())
      .map(([name, row]) => ({ name, metadata: row.metadata }));
    return { keys, list_complete: true, cursor: '' };
  }
}

class MemoryDb {
  tickets = new Map();
  revoked = new Map();
  events = [];
  async batch(statements) { return Promise.all(statements.map(statement => statement.run())); }
  prepare(sql) {
    const db = this;
    return { bind(...args) {
      return {
        async first() {
          if (sql.includes('SELECT grant_id FROM revoked_grants')) {
            return db.revoked.has(args[0]) ? { grant_id: args[0] } : null;
          }
          assert.match(sql, /UPDATE auth_tickets SET consumed_at/);
          assert.match(sql, /consumed_at IS NULL AND expires_at > \? RETURNING token_hash/);
          const [now, hash, expiryNow] = args;
          const row = db.tickets.get(hash);
          if (!row || row.consumedAt !== null || row.expiresAt <= expiryNow) return null;
          row.consumedAt = now;
          return { token_hash: hash };
        },
        async run() {
          if (sql.includes('INSERT OR IGNORE INTO revoked_grants')) {
            db.revoked.set(args[0], args[1]);
            return { success: true };
          }
          assert.match(sql, /INSERT INTO diary_events/);
          if (sql.includes('VALUES (?,NULL,NULL,?,?,?)')) {
            db.events.push({ eventType: args[0], date: null, grantId: null, requestId: args[1],
              createdAt: args[2], metadata: JSON.parse(args[3]) });
            return { success: true };
          }
          db.events.push({ eventType: args[0], date: args[1], grantId: args[2], requestId: args[3],
            createdAt: args[4], metadata: JSON.parse(args[5]) });
          return { success: true };
        },
      };
    } };
  }
}

function fixture(extra = {}, handler) {
  const env = { PUBLIC_ORIGIN: ORIGIN, OAUTH_KV: new MemoryKv(), DB: new MemoryDb(), ...extra };
  const provider = makeProvider(env, handler || { fetch: async (_request, _env, ctx) => {
    if (!ctx.props.grantId || env.DB.revoked.has(ctx.props.grantId)) return new Response(null, { status: 401 });
    return Response.json({ props: ctx.props, audience: ctx.auth.audience, scope: ctx.auth.scope, userId: ctx.auth.userId });
  } });
  const ctx = () => ({ waitUntil() {}, passThroughOnException() {} });
  return { env, provider, dispatch: request => provider.fetch(request, env, ctx()) };
}

function jsonRequest(path, body, origin = ORIGIN) {
  return new Request(`${origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body) });
}

async function register(f, extra = {}) {
  const response = await f.dispatch(jsonRequest('/oauth/register', {
    client_name: '<script>alert(1)</script>', redirect_uris: [REDIRECT],
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
    token_endpoint_auth_method: 'none', ...extra,
  }, f.env.PUBLIC_ORIGIN));
  assert.equal(response.status, 201);
  return response.json();
}

async function authorization(f, client, extra = {}) {
  const verifier = 'a'.repeat(64);
  const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
  const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: client.redirect_uris[0],
    response_type: 'code', resource: `${f.env.PUBLIC_ORIGIN}/mcp`, state: 'synthetic-state',
    code_challenge: challenge, code_challenge_method: 'S256', ...extra });
  const response = await f.dispatch(new Request(`${f.env.PUBLIC_ORIGIN}/authorize?${query}`));
  const html = await response.text();
  return { response, html, verifier, handle: html.match(/name="handle" value="([^"]+)"/)?.[1],
    cookie: response.headers.get('Set-Cookie')?.split(';')[0] };
}

async function ticket(f, expiresAt = Date.now() + 600000) {
  const value = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const hash = await hashAuthTicket(value);
  f.env.DB.tickets.set(hash, { expiresAt, consumedAt: null });
  return { value, hash };
}

function formRequest(f, flow, authTicket, { scopes = [...AUTH_SCOPES], origin = f.env.PUBLIC_ORIGIN,
  cookie = flow.cookie, decision = 'approve', ...headers } = {}) {
  const body = new URLSearchParams({ handle: flow.handle || '', ticket: authTicket, decision });
  for (const scope of scopes) body.append('scope', scope);
  return new Request(`${f.env.PUBLIC_ORIGIN}/authorize`, { method: 'POST', body,
    headers: { Origin: origin, Cookie: cookie || '', 'Sec-Fetch-Site': 'same-origin', ...headers } });
}

async function tokenRequest(f, body) {
  return f.dispatch(new Request(`${f.env.PUBLIC_ORIGIN}/oauth/token`, {
    method: 'POST', body: new URLSearchParams(body),
  }));
}

async function authorizedCode(f, scopes = [...AUTH_SCOPES]) {
  const client = await register(f);
  const flow = await authorization(f, client);
  const issued = await ticket(f);
  const approved = await f.dispatch(formRequest(f, flow, issued.value, { scopes }));
  assert.equal(approved.status, 303);
  const location = new URL(approved.headers.get('Location'));
  assert.equal(location.origin, 'https://chatgpt.com');
  assert.equal(location.searchParams.get('state'), 'synthetic-state');
  assert.equal(location.searchParams.get('iss'), f.env.PUBLIC_ORIGIN);
  return { client, flow, issued, code: location.searchParams.get('code') };
}

test('provider uses canonical discovery and requires authentication for MCP', async () => {
  const f = fixture();
  assert.ok(f.provider instanceof OAuthProvider);
  const metadata = await (await f.dispatch(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`))).json();
  assert.equal(metadata.issuer, ORIGIN);
  assert.equal(metadata.authorization_endpoint, `${ORIGIN}/authorize`);
  assert.equal(metadata.token_endpoint, `${ORIGIN}/oauth/token`);
  assert.ok(metadata.code_challenge_methods_supported.includes('S256'));
  assert.equal(metadata.authorization_response_iss_parameter_supported, true);
  assert.equal(metadata.client_id_metadata_document_supported, true);
  assert.deepEqual(metadata.scopes_supported, [...AUTH_SCOPES]);
  const resourceResponse = await f.dispatch(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`));
  assert.equal(resourceResponse.status, 200);
  const resourceMetadata = await resourceResponse.json();
  assert.equal(resourceMetadata.resource, `${ORIGIN}/mcp`);
  assert.deepEqual(resourceMetadata.authorization_servers, [ORIGIN]);
  assert.deepEqual(resourceMetadata.scopes_supported, [...AUTH_SCOPES]);
  assert.deepEqual(resourceMetadata.bearer_methods_supported, ['header']);
  assert.equal((await f.dispatch(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`, { method: 'POST' }))).status, 405);
  const protectedResponse = await f.dispatch(new Request(`${ORIGIN}/mcp`));
  assert.equal(protectedResponse.status, 401);
  assert.match(protectedResponse.headers.get('WWW-Authenticate'), /resource_metadata=/);
  const unknownToken = await f.dispatch(new Request(`${ORIGIN}/mcp`, { headers: { Authorization: 'Bearer unknown' } }));
  assert.equal(unknownToken.status, 401);
});

test('origin guard covers every provider route and local DCR cannot be enabled in production', async () => {
  const f = fixture();
  for (const path of ['/oauth/token', '/oauth/register', '/.well-known/oauth-authorization-server', '/mcp', '/authorize']) {
    assert.equal((await f.dispatch(new Request(`https://evil.example${path}`))).status, 400);
  }
  assert.equal((await f.dispatch(new Request(`${ORIGIN}/authorize`, { headers: { Host: 'evil.example' } }))).status, 400);
  assert.throws(() => fixture({ OAUTH_ALLOW_LOCAL_DCR: 'true' }), /loopback/);
  assert.throws(() => fixture({ PUBLIC_ORIGIN: 'http://public.example' }), /canonical HTTPS/);
  assert.throws(() => fixture({ PUBLIC_ORIGIN: `${ORIGIN}/changed` }), /canonical HTTPS/);
  assert.throws(() => fixture({ OAUTH_REDIRECT_URIS: JSON.stringify(['http://127.0.0.1:8978/callback']) }), /HTTPS/);
  assert.throws(() => fixture({ OAUTH_REDIRECT_URIS: JSON.stringify(['https://evil.example/callback']) }), /ChatGPT/);
  assert.throws(() => fixture({ OAUTH_CLIENT_METADATA_URLS: JSON.stringify(['https://evil.example/client.json']) }), /ChatGPT/);
});

test('explicit local DCR only accepts its exact loopback redirect', async () => {
  const origin = 'http://127.0.0.1:8978';
  const redirect = `${origin}/callback`;
  const f = fixture({ PUBLIC_ORIGIN: origin, OAUTH_ALLOW_LOCAL_DCR: 'true',
    OAUTH_REDIRECT_URIS: JSON.stringify([redirect]) });
  const client = await register(f, { redirect_uris: [redirect] });
  assert.equal((await authorization(f, client)).response.status, 200);
  const bad = await f.dispatch(jsonRequest('/oauth/register', {
    redirect_uris: [`${redirect}/unexpected`], token_endpoint_auth_method: 'none',
  }, origin));
  assert.equal(bad.status, 400);
});

test('DCR and authorization both reject redirects outside the exact allowlist', async () => {
  const f = fixture();
  for (const redirect of [`${REDIRECT}?evil=1`, 'https://chatgpt.com.evil.example/connector_platform_oauth_redirect',
    'https://evil.example/callback']) {
    const denied = await f.dispatch(jsonRequest('/oauth/register', { redirect_uris: [redirect],
      token_endpoint_auth_method: 'none' }));
    assert.equal(denied.status, 400);
  }
  const client = await register(f);
  const flow = await authorization(f, client, { redirect_uri: `${REDIRECT}?changed=1` });
  assert.equal(flow.response.status, 400);
  assert.equal(flow.response.headers.get('Location'), null);
});

test('CIMD allowlist rejects unknown documents before a network fetch', async () => {
  const f = fixture();
  const originalFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; throw new Error('A network fetch was not expected.'); };
  try {
    const flow = await authorization(f, { client_id: 'https://evil.example/client.json', redirect_uris: [REDIRECT] });
    assert.equal(flow.response.status, 400);
    assert.equal(fetched, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('allowlisted CIMD still validates the exact redirect against fetched client metadata', async () => {
  const f = fixture();
  const originalFetch = globalThis.fetch;
  let fetched = 0;
  const clientId = 'https://chatgpt.com/oauth/client.json';
  let redirects = [REDIRECT];
  globalThis.fetch = async input => {
    assert.equal(typeof input === 'string' ? input : input.url, clientId);
    fetched++;
    return Response.json({ client_id: clientId, client_name: 'Synthetic CIMD client',
      redirect_uris: redirects, token_endpoint_auth_methods_supported: ['none'],
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'] });
  };
  try {
    const client = { client_id: clientId, redirect_uris: [REDIRECT] };
    assert.equal((await authorization(f, client)).response.status, 200);
    redirects = ['https://evil.example/callback'];
    assert.equal((await authorization(f, client)).response.status, 400);
    assert.ok(fetched >= 2);
  } finally { globalThis.fetch = originalFetch; }
});

test('GET validates PKCE/scopes, escapes metadata, and creates browser-bound consent', async () => {
  const f = fixture();
  const client = await register(f);
  for (const extra of [{ code_challenge: '', code_challenge_method: '' },
    { code_challenge_method: 'plain' }, { scope: 'diary:admin' }, { ticket: 'never-in-the-url' }]) {
    assert.equal((await authorization(f, client, extra)).response.status, 400);
  }
  const flow = await authorization(f, client);
  assert.equal(flow.response.status, 200);
  assert.match(flow.html, /&#60;script&#62;/);
  assert.doesNotMatch(flow.html, /<script>/);
  assert.ok(flow.handle);
  const cookie = flow.response.headers.get('Set-Cookie');
  assert.match(cookie, /__Host-oauth-consent-/);
  assert.match(cookie, /Secure; HttpOnly; SameSite=Lax; Max-Age=600/);
  assert.match(flow.response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.equal(flow.response.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(flow.response.headers.get('Cache-Control'), 'no-store');
});

test('CSRF, missing binding cookie, scope escalation, and oversized forms do not consume tickets', async () => {
  const f = fixture();
  const client = await register(f);
  const issued = await ticket(f);
  for (const options of [{ origin: 'https://evil.example' }, { cookie: '' },
    { scopes: ['diary:source:read', 'diary:admin'] }, { scopes: ['offline_access'] },
    { 'Sec-Fetch-Site': 'cross-site' }]) {
    const flow = await authorization(f, client);
    assert.equal((await f.dispatch(formRequest(f, flow, issued.value, options))).status, 400);
    assert.equal(f.env.DB.tickets.get(issued.hash).consumedAt, null);
  }
  const flow = await authorization(f, client);
  assert.equal((await f.dispatch(formRequest(f, flow, 'a'.repeat(9000)))).status, 400);
  assert.equal(f.env.DB.tickets.get(issued.hash).consumedAt, null);
});

test('expired and reused tickets fail; atomic consumption allows one concurrent winner', async () => {
  const f = fixture();
  const client = await register(f);
  const expired = await ticket(f, Date.now() - 1);
  assert.equal((await f.dispatch(formRequest(f, await authorization(f, client), expired.value))).status, 401);
  const issued = await ticket(f);
  const first = await f.dispatch(formRequest(f, await authorization(f, client), issued.value));
  assert.equal(first.status, 303);
  const second = await f.dispatch(formRequest(f, await authorization(f, client), issued.value));
  assert.equal(second.status, 401);
  const concurrent = await ticket(f);
  const winners = await Promise.all([consumeAuthTicket(f.env.DB, concurrent.value), consumeAuthTicket(f.env.DB, concurrent.value)]);
  assert.deepEqual(winners.sort(), [false, true]);
});

test('consent handles cannot be reused with a fresh valid ticket', async () => {
  const f = fixture();
  const client = await register(f);
  const flow = await authorization(f, client);
  const firstTicket = await ticket(f);
  assert.equal((await f.dispatch(formRequest(f, flow, firstTicket.value))).status, 303);
  const nextTicket = await ticket(f);
  assert.equal((await f.dispatch(formRequest(f, flow, nextTicket.value))).status, 400);
  assert.equal(f.env.DB.tickets.get(nextTicket.hash).consumedAt, null);
});

test('a failed completion consumes only that ticket and a newly minted ticket can retry', async () => {
  const f = fixture();
  const client = await register(f);
  const flow = await authorization(f, client);
  const issued = await ticket(f);
  const originalComplete = f.env.OAUTH_PROVIDER.completeAuthorization;
  f.env.OAUTH_PROVIDER.completeAuthorization = async () => { throw new Error('Synthetic storage outage.'); };
  assert.equal((await f.dispatch(formRequest(f, flow, issued.value))).status, 400);
  assert.ok(f.env.DB.tickets.get(issued.hash).consumedAt);
  assert.deepEqual(f.env.DB.events.at(-1).metadata,
    { stage: 'post_complete_authorization', code: 'authorization_failed', method: 'POST' });
  f.env.OAUTH_PROVIDER.completeAuthorization = originalComplete;
  const retry = await ticket(f);
  assert.equal((await f.dispatch(formRequest(f, await authorization(f, client), retry.value))).status, 303);
});

test('missing/foreign grant metadata is rejected before issuance', () => {
  const valid = { grantType: GrantType.AUTHORIZATION_CODE, userId: AUTH_USER_ID, grantId: 'synthetic-grant',
    clientId: 'synthetic-client', resource: `${ORIGIN}/mcp`, props: { ...AUTH_PROPS },
    scope: [...AUTH_SCOPES], requestedScope: [...AUTH_SCOPES] };
  assert.doesNotThrow(() => validateGrantExchange(valid, ORIGIN));
  for (const changed of [{ grantId: '' }, { userId: 'admin' }, { props: { channel: 'wrong' } },
    { resource: `${ORIGIN}/wrong` }, { scope: ['diary:source:read', 'admin'] }, { requestedScope: ['admin'] },
    { scope: ['offline_access'], requestedScope: ['offline_access'] }, { scope: [], requestedScope: [] }]) {
    assert.throws(() => validateGrantExchange({ ...valid, ...changed }, ORIGIN), /not authorized/);
  }
});

test('real provider issues code/access/refresh, rotates, revokes, and audits without credentials', async () => {
  const f = fixture();
  const { client, flow, issued, code } = await authorizedCode(f);
  const exchanged = await tokenRequest(f, { grant_type: 'authorization_code', code, client_id: client.client_id,
    code_verifier: flow.verifier, redirect_uri: REDIRECT, resource: `${ORIGIN}/mcp` });
  assert.equal(exchanged.status, 200);
  const initial = await exchanged.json();
  assert.equal(initial.expires_in, ACCESS_TOKEN_TTL);
  assert.ok(initial.refresh_token);
  assert.deepEqual(initial.scope.split(' '), [...AUTH_SCOPES]);
  const invoke = token => f.dispatch(new Request(`${ORIGIN}/mcp`, { headers: { Authorization: `Bearer ${token}` } }));
  const invoked = await invoke(initial.access_token);
  assert.equal(invoked.status, 200);
  const props = (await invoked.json()).props;
  assert.equal(props.channel, AUTH_PROPS.channel);
  assert.equal(props.authorId, AUTH_PROPS.authorId);
  assert.ok(props.grantId);
  const refresh = value => tokenRequest(f, { grant_type: 'refresh_token', refresh_token: value,
    client_id: client.client_id, resource: `${ORIGIN}/mcp` });
  const firstRefresh = await refresh(initial.refresh_token);
  assert.equal(firstRefresh.status, 200);
  const first = await firstRefresh.json();
  const secondRefresh = await refresh(first.refresh_token);
  assert.equal(secondRefresh.status, 200);
  const second = await secondRefresh.json();
  assert.equal((await refresh(initial.refresh_token)).status, 400);
  assert.equal(f.env.DB.events.length, 3);
  assert.deepEqual(f.env.DB.events.map(event => event.eventType),
    ['oauth_authorization_code', 'oauth_refresh_token', 'oauth_refresh_token']);
  const audit = JSON.stringify(f.env.DB.events);
  for (const secret of [code, issued.value, initial.access_token, initial.refresh_token,
    first.access_token, first.refresh_token, second.access_token, second.refresh_token]) assert.equal(audit.includes(secret), false);
  assert.ok(f.env.DB.events.every(event => event.metadata.refreshIdleTtlSeconds === REFRESH_IDLE_TTL));
  const revoked = await tokenRequest(f, { token: second.refresh_token, token_type_hint: 'refresh_token', client_id: client.client_id });
  assert.equal(revoked.status, 200);
  assert.equal((await invoke(second.access_token)).status, 401);
  assert.equal((await refresh(second.refresh_token)).status, 400);
});

test('operator tickets cannot authenticate MCP; MCP tokens cannot invoke operator revocation', async () => {
  const f = fixture();
  const issued = await ticket(f);
  const response = await f.dispatch(new Request(`${ORIGIN}/mcp`, {
    headers: { Authorization: `Bearer ${issued.value}` },
  }));
  assert.equal(response.status, 401);
  const { client, flow, code } = await authorizedCode(f);
  const exchanged = await tokenRequest(f, { grant_type: 'authorization_code', code, client_id: client.client_id,
    code_verifier: flow.verifier, redirect_uri: REDIRECT });
  const tokens = await exchanged.json();
  const operator = jsonRequest('/operator/revoke', { all: true });
  operator.headers.set('Authorization', `Bearer ${tokens.access_token}`);
  assert.equal((await f.dispatch(operator)).status, 401);
  assert.equal(f.env.DB.tickets.get(issued.hash).consumedAt, null);
});

test('operator rejects missing/expired tickets, bad bodies, unknown grants, and cross-origin requests', async () => {
  const f = fixture();
  assert.equal((await f.dispatch(jsonRequest('/operator/revoke', { all: true }))).status, 401);
  const expired = await ticket(f, Date.now() - 1);
  const expiryRequest = jsonRequest('/operator/revoke', { all: true });
  expiryRequest.headers.set('Authorization', `Bearer ${expired.value}`);
  assert.equal((await f.dispatch(expiryRequest)).status, 401);
  const issued = await ticket(f);
  for (const body of [{ all: true, userId: 'admin' }, { grantId: 'secret:token' }, { all: false }]) {
    const request = jsonRequest('/operator/revoke', body);
    request.headers.set('Authorization', `Bearer ${issued.value}`);
    assert.equal((await f.dispatch(request)).status, 400);
  }
  const crossSite = jsonRequest('/operator/revoke', { all: true });
  crossSite.headers.set('Authorization', `Bearer ${issued.value}`);
  crossSite.headers.set('Origin', 'https://evil.example');
  assert.equal((await f.dispatch(crossSite)).status, 400);
  assert.equal(f.env.DB.tickets.get(issued.hash).consumedAt, null);
  const unknown = jsonRequest('/operator/revoke', { grantId: 'unknown-grant' });
  unknown.headers.set('Authorization', `Bearer ${issued.value}`);
  assert.equal((await f.dispatch(unknown)).status, 404);
  assert.ok(f.env.DB.tickets.get(issued.hash).consumedAt);
});

test('operator paginates fixed identity and deny-lists every grant before KV revocation', async () => {
  const f = fixture({ DIARY_REQUEST_ID: 'synthetic-request-id' });
  const issued = await ticket(f);
  const pages = [];
  const removed = [];
  f.env.OAUTH_PROVIDER = {
    async listUserGrants(userId, options) {
      assert.equal(userId, AUTH_USER_ID);
      pages.push(options.cursor);
      return options.cursor ? { items: [{ id: 'grant-b' }] } : { items: [{ id: 'grant-a' }], cursor: 'page-2' };
    },
    async revokeGrant(grantId, userId) {
      assert.equal(userId, AUTH_USER_ID);
      assert.deepEqual([...f.env.DB.revoked.keys()], ['grant-a', 'grant-b']);
      removed.push(grantId);
    },
  };
  const request = jsonRequest('/operator/revoke', { all: true });
  request.headers.set('Authorization', `Bearer ${issued.value}`);
  const response = await f.dispatch(request);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { revokedCount: 2, grantIds: ['grant-a', 'grant-b'] });
  assert.deepEqual(pages, [undefined, 'page-2']);
  assert.deepEqual(removed, ['grant-a', 'grant-b']);
  assert.equal(f.env.DB.events.at(-1).requestId, 'synthetic-request-id');
  const replay = jsonRequest('/operator/revoke', { all: true });
  replay.headers.set('Authorization', `Bearer ${issued.value}`);
  assert.equal((await f.dispatch(replay)).status, 401);
});

test('D1 revocation blocks refresh and invocation even with stale cached KV records', async () => {
  const f = fixture({ DIARY_REQUEST_ID: 'synthetic-oauth-request' });
  const { client, flow, code } = await authorizedCode(f);
  const exchanged = await tokenRequest(f, { grant_type: 'authorization_code', code, client_id: client.client_id,
    code_verifier: flow.verifier, redirect_uri: REDIRECT });
  const tokens = await exchanged.json();
  const invoke = () => f.dispatch(new Request(`${ORIGIN}/mcp`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  }));
  const props = (await (await invoke()).json()).props;
  const cachedRows = new Map(f.env.OAUTH_KV.rows);
  const issued = await ticket(f);
  const request = jsonRequest('/operator/revoke', { grantId: props.grantId });
  request.headers.set('Authorization', `Bearer ${issued.value}`);
  const revoked = await f.dispatch(request);
  assert.equal(revoked.status, 200);
  assert.deepEqual(await revoked.json(), { revokedCount: 1, grantIds: [props.grantId] });
  f.env.OAUTH_KV.rows = cachedRows;
  assert.equal((await invoke()).status, 401);
  const refreshed = await tokenRequest(f, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token,
    client_id: client.client_id });
  assert.equal(refreshed.status, 400);
  assert.equal((await refreshed.json()).error, 'invalid_grant');
  assert.equal(f.env.DB.events[0].requestId, 'synthetic-oauth-request');
});

test('read-only consent stays read-only after token exchange and refresh', async () => {
  const f = fixture();
  const { client, flow, code } = await authorizedCode(f, ['diary:source:read', 'offline_access']);
  const response = await tokenRequest(f, { grant_type: 'authorization_code', code, client_id: client.client_id,
    code_verifier: flow.verifier, redirect_uri: REDIRECT });
  assert.equal(response.status, 200);
  const tokens = await response.json();
  assert.equal(tokens.scope, 'diary:source:read offline_access');
  const refresh = await tokenRequest(f, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token,
    client_id: client.client_id, scope: 'diary:site:publish' });
  assert.equal(refresh.status, 400);
  const correct = await tokenRequest(f, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token,
    client_id: client.client_id });
  assert.equal(correct.status, 200);
  assert.equal((await correct.json()).scope, 'diary:source:read offline_access');
});

test('publish-only consent remains narrow through issuance, routing, refresh, and revocation', async () => {
  const f = fixture();
  const { client, flow, code } = await authorizedCode(f, ['diary:site:publish', 'offline_access']);
  const exchanged = await tokenRequest(f, { grant_type: 'authorization_code', code, client_id: client.client_id,
    code_verifier: flow.verifier, redirect_uri: REDIRECT });
  assert.equal(exchanged.status, 200);
  const tokens = await exchanged.json();
  assert.equal(tokens.scope, 'diary:site:publish offline_access');
  const invoke = accessToken => f.dispatch(new Request(`${ORIGIN}/mcp`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }));
  const invoked = await invoke(tokens.access_token);
  assert.equal(invoked.status, 200, 'Routing must not require an unrelated read scope');
  const principal = await invoked.json();
  assert.deepEqual(principal.scope, ['diary:site:publish', 'offline_access']);
  assert.equal(principal.userId, AUTH_USER_ID);
  assert.deepEqual(principal.props, { ...AUTH_PROPS, grantId: principal.props.grantId });
  const unavailable = await tokenRequest(f, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token,
    client_id: client.client_id, scope: 'diary:source:read' });
  assert.equal(unavailable.status, 400);
  const widened = await tokenRequest(f, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token,
    client_id: client.client_id, scope: 'diary:source:read diary:site:publish' });
  // The library intersects mixed requests with the approved grant rather than
  // rejecting them; its token must still contain only the original write scope.
  assert.equal(widened.status, 200);
  const narrowed = await widened.json();
  assert.equal(narrowed.scope, 'diary:site:publish');
  const refreshed = await tokenRequest(f, { grant_type: 'refresh_token', refresh_token: narrowed.refresh_token,
    client_id: client.client_id });
  assert.equal(refreshed.status, 200);
  const rotated = await refreshed.json();
  assert.equal(rotated.scope, 'diary:site:publish offline_access');
  assert.equal((await invoke(rotated.access_token)).status, 200);
  f.env.DB.revoked.set(principal.props.grantId, Date.now());
  assert.equal((await invoke(rotated.access_token)).status, 401);
  const revokedRefresh = await tokenRequest(f, { grant_type: 'refresh_token', refresh_token: rotated.refresh_token,
    client_id: client.client_id });
  assert.equal(revokedRefresh.status, 400);
  assert.equal((await revokedRefresh.json()).error, 'invalid_grant');
  const auditText = JSON.stringify(f.env.DB.events);
  for (const secret of [code, tokens.access_token, tokens.refresh_token, narrowed.access_token,
    narrowed.refresh_token, rotated.access_token, rotated.refresh_token]) {
    assert.ok(!auditText.includes(secret));
  }
});

test('real provider authenticates publish-only tokens before actual MCP tool-specific authorization', async () => {
  const f = fixture({}, apiHandler);
  const { client, flow, code } = await authorizedCode(f, ['diary:site:publish']);
  const exchanged = await tokenRequest(f, { grant_type: 'authorization_code', code, client_id: client.client_id,
    code_verifier: flow.verifier, redirect_uri: REDIRECT });
  assert.equal(exchanged.status, 200);
  const tokens = await exchanged.json();
  assert.equal(tokens.refresh_token, undefined);
  async function rpc(method, params) {
    const response = await f.dispatch(new Request(`${ORIGIN}/mcp`, {
      method: 'POST', headers: {
        Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25',
      }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }));
    assert.equal(response.status, 200);
    const wire = await response.json();
    assert.equal(wire.error, undefined);
    return wire.result;
  }
  const listed = await rpc('tools/list', {});
  assert.deepEqual(listed.tools.find(tool => tool.name === 'publish_diary')._meta.securitySchemes,
    [{ type: 'oauth2', scopes: ['diary:site:publish'] }]);
  const deniedRead = await rpc('tools/call', { name: 'get_diary_source_packet', arguments: { date: '2026-10-13' } });
  assert.equal(deniedRead.isError, true);
  assert.deepEqual(deniedRead.structuredContent, { error: 'INSUFFICIENT_SCOPE', status: 403 });
  assert.match(deniedRead._meta['mcp/www_authenticate'][0], /scope="diary:source:read"/);
  assert.equal(f.env.DB.events.filter(event => event.eventType === 'SOURCE_READ').length, 0);
});

for (const scope of ['diary:source:read', 'diary:site:publish']) {
  test(`access-only ${scope} consent expires after 300 seconds and never receives a refresh token`, async () => {
    const f = fixture();
    const { client, flow, code } = await authorizedCode(f, [scope]);
    const response = await tokenRequest(f, { grant_type: 'authorization_code', code, client_id: client.client_id,
      code_verifier: flow.verifier, redirect_uri: REDIRECT });
    assert.equal(response.status, 200);
    const tokens = await response.json();
    assert.equal(tokens.scope, scope);
    assert.equal(tokens.expires_in, 300);
    assert.equal(tokens.refresh_token, undefined);
    const invoke = () => f.dispatch(new Request(`${ORIGIN}/mcp`, { headers: { Authorization: `Bearer ${tokens.access_token}` } }));
    const initial = await invoke();
    assert.equal(initial.status, 200);
    assert.deepEqual((await initial.json()).scope, [scope]);
    assert.equal(f.env.DB.events[0].metadata.refreshIdleTtlSeconds, 0);
    const grant = [...f.env.OAUTH_KV.rows.entries()].find(([key]) => key.startsWith('grant:'))[1];
    assert.ok(grant.expires <= Date.now() + 300000);
    // Expire every KV record to avoid depending on wall-clock waits.
    for (const row of f.env.OAUTH_KV.rows.values()) row.expires = Date.now() - 1;
    assert.equal((await invoke()).status, 401);
  });
}

test('an older refresh token granted without offline_access is rejected by the current provider', async () => {
  const f = fixture();
  const { client, flow, code } = await authorizedCode(f, ['diary:source:read']);
  // Mint the legacy behavior using the real library, not a forged token/KV row.
  const legacy = new OAuthProvider({
    apiRoute: '/mcp', apiHandler: { fetch: () => new Response(null) },
    defaultHandler: { fetch: () => new Response(null, { status: 404 }) },
    authorizeEndpoint: `${ORIGIN}/authorize`, tokenEndpoint: `${ORIGIN}/oauth/token`,
    resourceMetadata: { resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN] },
    requiredScopes: [], scopesSupported: [...AUTH_SCOPES], accessTokenTTL: ACCESS_TOKEN_TTL,
    refreshTokenTTL: REFRESH_IDLE_TTL,
    tokenExchangeCallback: options => ({ newProps: { ...AUTH_PROPS, grantId: options.grantId } }), onError: () => {},
  });
  const exchanged = await legacy.fetch(new Request(`${ORIGIN}/oauth/token`, { method: 'POST', body: new URLSearchParams({
    grant_type: 'authorization_code', code, client_id: client.client_id, code_verifier: flow.verifier, redirect_uri: REDIRECT,
  }) }), f.env, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(exchanged.status, 200);
  const old = await exchanged.json();
  assert.ok(old.refresh_token);
  const refreshed = await tokenRequest(f, { grant_type: 'refresh_token', refresh_token: old.refresh_token, client_id: client.client_id });
  assert.equal(refreshed.status, 400);
  assert.equal((await refreshed.json()).error, 'invalid_grant');
  assert.equal(f.env.DB.events.filter(event => event.eventType === 'oauth_refresh_token').length, 0);
});

test('authorization failure diagnostics identify fixed stages without retaining error messages, URLs, or credentials', async () => {
  const secret = 'synthetic-private-ticket-and-token-sentinel';
  const cases = ['client_policy', 'parse_request', 'validate_policy', 'describe_consent', 'begin_consent'];
  const originalFetch = globalThis.fetch;
  try {
    for (const stage of cases) {
      const f = fixture({ DIARY_REQUEST_ID: 'synthetic-diagnostic-request' });
      const client = await register(f);
      const extra = {};
      let requestClient = client;
      if (stage === 'client_policy') requestClient = { client_id: `https://evil.example/${secret}.json`, redirect_uris: [REDIRECT] };
      if (stage === 'parse_request') {
        requestClient = { client_id: 'https://chatgpt.com/oauth/client.json', redirect_uris: [REDIRECT] };
        globalThis.fetch = async () => new Response(JSON.stringify({ diagnostic: secret }), { status: 503 });
      }
      if (['validate_policy', 'describe_consent', 'begin_consent'].includes(stage)) {
        assert.equal((await authorization(f, client)).response.status, 200);
        if (stage === 'validate_policy') {
          const parse = f.env.OAUTH_PROVIDER.parseAuthRequest.bind(f.env.OAUTH_PROVIDER);
          f.env.OAUTH_PROVIDER.parseAuthRequest = async request => ({ ...await parse(request), resource: `${ORIGIN}/wrong-${secret}` });
        } else {
          f.env.OAUTH_PROVIDER[stage === 'describe_consent' ? 'describeConsent' : 'beginConsent'] = async () => { throw new Error(secret); };
        }
      }
      const flow = await authorization(f, requestClient, extra);
      globalThis.fetch = originalFetch;
      assert.equal(flow.response.status, 400);
      assert.ok(!flow.html.includes(secret));
      const event = f.env.DB.events.find(event => event.eventType === 'oauth_authorize_failure');
      assert.ok(event, stage);
      assert.equal(event.requestId, 'synthetic-diagnostic-request');
      assert.equal(event.metadata.stage, stage);
      assert.deepEqual(Object.keys(event.metadata).sort(), stage === 'parse_request'
        ? ['code', 'metadataHttpStatus', 'stage'] : ['code', 'stage']);
      if (stage === 'parse_request') assert.equal(event.metadata.metadataHttpStatus, 503);
      assert.ok(['invalid_request', 'invalid_client', 'invalid_client_metadata', 'invalid_redirect_uri',
        'invalid_target', 'unauthorized_client', 'access_denied', 'unsupported_response_type',
        'invalid_scope', 'server_error', 'temporarily_unavailable', 'policy_rejected', 'authorization_failed',
        'metadata_resolution_failed', 'cimd_compatibility_flag_missing'].includes(event.metadata.code));
      const diagnosticText = JSON.stringify(event);
      for (const forbidden of [secret, ORIGIN, requestClient.client_id, client.client_id, flow.handle]) {
        if (forbidden) assert.ok(!diagnosticText.includes(forbidden));
      }
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('exported authorization and CIMD errors produce fixed codes and only exact numeric HTTP-status metadata', async () => {
  const secret = 'synthetic-private-error-message-and-url-sentinel';
  const failures = [
    [new AuthorizationError('invalid_target', { description: secret, state: secret, redirectUri: `https://evil.example/${secret}` }),
      { stage: 'parse_request', code: 'invalid_target' }],
    [new CimdFetchError(`https://evil.example/${secret}`, new Error('Failed to fetch client metadata: HTTP 403')),
      { stage: 'parse_request', code: 'metadata_resolution_failed', metadataHttpStatus: 403 }],
    [new CimdFetchError(`https://evil.example/${secret}`, new Error(`Failed to fetch client metadata: HTTP 403 ${secret}`)),
      { stage: 'parse_request', code: 'metadata_resolution_failed' }],
    [new CimdFetchError(`https://evil.example/${secret}`, new Error('Failed to fetch client metadata: HTTP 403\n')),
      { stage: 'parse_request', code: 'metadata_resolution_failed' }],
    [new CimdFetchError(`https://evil.example/${secret}`, new Error('Failed to fetch client metadata: HTTP 999')),
      { stage: 'parse_request', code: 'metadata_resolution_failed' }],
    [new Error("CIMD is enabled but 'global_fetch_strictly_public' compatibility flag is not set."),
      { stage: 'parse_request', code: 'cimd_compatibility_flag_missing' }],
    [new Error(`CIMD is enabled but 'global_fetch_strictly_public' compatibility flag is not set. ${secret}`),
      { stage: 'parse_request', code: 'authorization_failed' }],
  ];
  for (const [error, expected] of failures) {
    const f = fixture();
    const client = await register(f);
    assert.equal((await authorization(f, client)).response.status, 200);
    f.env.OAUTH_PROVIDER.parseAuthRequest = async () => { throw error; };
    const flow = await authorization(f, client);
    assert.equal(flow.response.status, 400);
    const event = f.env.DB.events.find(event => event.eventType === 'oauth_authorize_failure');
    assert.deepEqual(event.metadata, expected);
    assert.ok(!JSON.stringify(event).includes(secret));
    assert.ok(!flow.html.includes(secret));
  }
});

test('HTTPS DCR with the exact ChatGPT callback uses PKCE and never fetches unavailable CIMD metadata', async () => {
  const originalFetch = globalThis.fetch;
  let externalFetches = 0;
  globalThis.fetch = async () => { externalFetches++; return new Response(null, { status: 403 }); };
  try {
    const f = fixture();
    assert.ok(f.env.PUBLIC_ORIGIN.startsWith('https://'));
    assert.equal(f.env.OAUTH_ALLOW_LOCAL_DCR, undefined);
    const metadata = await (await f.dispatch(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`))).json();
    assert.equal(metadata.registration_endpoint, `${ORIGIN}/oauth/register`);
    assert.ok(metadata.token_endpoint_auth_methods_supported.includes('none'));
    const client = await register(f);
    assert.ok(!client.client_id.includes('://'));
    for (const redirect of [`${REDIRECT}?changed=1`, 'http://127.0.0.1:8978/callback']) {
      const rejected = await f.dispatch(jsonRequest('/oauth/register', { redirect_uris: [redirect], token_endpoint_auth_method: 'none' }));
      assert.equal(rejected.status, 400);
    }
    assert.equal((await authorization(f, client, { code_challenge: '', code_challenge_method: '' })).response.status, 400);
    assert.equal((await authorization(f, client, { code_challenge_method: 'plain' })).response.status, 400);
    const flow = await authorization(f, client, { scope: AUTH_SCOPES.join(' ') });
    assert.equal(flow.response.status, 200);
    const issued = await ticket(f);
    const approved = await f.dispatch(formRequest(f, flow, issued.value));
    assert.equal(approved.status, 303);
    const location = new URL(approved.headers.get('Location'));
    assert.equal(location.origin + location.pathname, REDIRECT);
    assert.equal(location.searchParams.get('iss'), ORIGIN);
    const code = location.searchParams.get('code');
    const failedPkce = await tokenRequest(f, { grant_type: 'authorization_code', code, client_id: client.client_id,
      code_verifier: 'b'.repeat(64), redirect_uri: REDIRECT, resource: `${ORIGIN}/mcp` });
    assert.equal(failedPkce.status, 400);
    const exchanged = await tokenRequest(f, { grant_type: 'authorization_code', code, client_id: client.client_id,
      code_verifier: flow.verifier, redirect_uri: REDIRECT, resource: `${ORIGIN}/mcp` });
    assert.equal(exchanged.status, 200);
    const tokens = await exchanged.json();
    assert.equal(tokens.expires_in, 300);
    assert.ok(tokens.refresh_token);
    assert.deepEqual(tokens.scope.split(' '), [...AUTH_SCOPES]);
    const invocation = await f.dispatch(new Request(`${ORIGIN}/mcp`, { headers: { Authorization: `Bearer ${tokens.access_token}` } }));
    assert.equal(invocation.status, 200);
    const principal = await invocation.json();
    assert.equal(principal.userId, AUTH_USER_ID);
    assert.equal(principal.audience, `${ORIGIN}/mcp`);
    assert.deepEqual(principal.props, { ...AUTH_PROPS, grantId: principal.props.grantId });
    const refreshed = await tokenRequest(f, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token,
      client_id: client.client_id, resource: `${ORIGIN}/mcp` });
    assert.equal(refreshed.status, 200);
    const rotated = await refreshed.json();
    assert.equal(rotated.expires_in, 300);
    assert.deepEqual(rotated.scope.split(' '), [...AUTH_SCOPES]);
    assert.equal(externalFetches, 0, 'DCR must resolve its registered client from KV without fetching CIMD/JWKS');
  } finally { globalThis.fetch = originalFetch; }
});

test('consent CSP permits only self and the exact validated callback while errors remain self-only', async () => {
  const formAction = response => response.headers.get('Content-Security-Policy')?.split(';')
    .map(directive => directive.trim()).find(directive => directive.startsWith('form-action '));
  for (const redirect of [REDIRECT, 'https://chatgpt.com/connector/oauth/synthetic_callback_id']) {
    const f = fixture({ OAUTH_REDIRECT_URIS: JSON.stringify([redirect]) });
    const client = await register(f, { redirect_uris: [redirect] });
    const flow = await authorization(f, client);
    assert.equal(flow.response.status, 200);
    assert.equal(formAction(flow.response), `form-action 'self' ${redirect}`);
    assert.equal(flow.response.headers.get('Referrer-Policy'), 'same-origin');
    assert.match(flow.response.headers.get('Content-Security-Policy'), /default-src 'none'/);
    assert.match(flow.response.headers.get('Content-Security-Policy'), /base-uri 'none'; frame-ancestors 'none'/);
    assert.match(flow.html, /<form method="post" action="\/authorize">/);
    for (const badRedirect of [`${redirect}?unvalidated=1`, 'https://chatgpt.com.evil.example/callback', 'https://evil.example/callback']) {
      const rejected = await authorization(f, client, { redirect_uri: badRedirect });
      assert.equal(rejected.response.status, 400);
      assert.equal(rejected.response.headers.get('Location'), null);
      assert.equal(formAction(rejected.response), "form-action 'self'");
      assert.equal(rejected.response.headers.get('Referrer-Policy'), 'no-referrer');
      assert.ok(!rejected.response.headers.get('Content-Security-Policy').includes(badRedirect));
    }
    for (const path of ['/not-found', '/authorize?ticket=synthetic-only']) {
      const response = await f.dispatch(new Request(`${ORIGIN}${path}`));
      assert.ok(response.status >= 400);
      assert.equal(formAction(response), "form-action 'self'");
      assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
    }
    const operatorError = await f.dispatch(jsonRequest('/operator/revoke', { all: true }));
    assert.equal(operatorError.status, 401);
    assert.equal(formAction(operatorError), "form-action 'self'");
    assert.equal(operatorError.headers.get('Referrer-Policy'), 'no-referrer');
    const issued = await ticket(f);
    const approved = await f.dispatch(formRequest(f, flow, issued.value));
    assert.equal(approved.status, 303);
    const location = new URL(approved.headers.get('Location'));
    assert.equal(location.origin + location.pathname, redirect);
    assert.ok(!location.searchParams.has('ticket'));
    assert.equal(formAction(approved), "form-action 'self'", 'The redirect response must not relax unrelated pages');
    assert.equal(approved.headers.get('Referrer-Policy'), 'no-referrer');
  }
});

test('POST diagnostics distinguish form and consent rejection without consuming valid tickets or retaining credentials', async () => {
  const secret = 'synthetic-private-post-body-cookie-and-header-sentinel';
  const cases = [
    ['post_origin', 'origin_missing', (_body, headers) => headers.delete('Origin')],
    ['post_origin', 'origin_mismatch', (_body, headers) => headers.set('Origin', 'null')],
    ['post_fetch_site', 'fetch_site_mismatch', (_body, headers) => headers.set('Sec-Fetch-Site', 'cross-site')],
    ['post_content_type', 'unsupported_content_type', (_body, headers) => headers.set('Content-Type', 'application/json')],
    ['post_fields', 'invalid_form_fields', body => body.set('unknown', secret)],
    ['post_decision', 'invalid_decision', body => body.set('decision', secret)],
    ['post_scopes', 'policy_rejected', body => { body.delete('scope'); body.append('scope', 'offline_access'); }],
    ['post_approve_consent', 'consent_handle_missing', body => body.delete('handle')],
    ['post_approve_consent', 'consent_cookie_missing', (_body, headers) => headers.delete('Cookie')],
    ['post_approve_consent', 'consent_binding_mismatch', (_body, headers) => headers.set('Cookie', `${headers.get('Cookie').split('=')[0]}=${secret}`)],
    ['post_approve_consent', 'consent_expired_or_reused', (_body, _headers, f) => {
      for (const [key, row] of f.env.OAUTH_KV.rows) if (key.startsWith('transaction:')) row.expires = Date.now() - 1;
    }],
    ['post_validate_policy', 'policy_rejected', (_body, _headers, f) => {
      const approve = f.env.OAUTH_PROVIDER.approveConsent.bind(f.env.OAUTH_PROVIDER);
      f.env.OAUTH_PROVIDER.approveConsent = async (...args) => {
        const approved = await approve(...args);
        return { ...approved, request: { ...approved.request, resource: `${ORIGIN}/wrong` } };
      };
    }],
  ];
  for (const [stage, code, mutate] of cases) {
    const f = fixture({ DIARY_REQUEST_ID: 'synthetic-post-diagnostic-request' });
    const client = await register(f);
    const flow = await authorization(f, client);
    const issued = await ticket(f);
    const request = formRequest(f, flow, issued.value);
    const headers = new Headers(request.headers);
    const body = new URLSearchParams(await request.text());
    mutate(body, headers, f);
    const response = await f.dispatch(new Request(`${ORIGIN}/authorize`, { method: 'POST', headers, body }));
    assert.equal(response.status, 400, `${stage}/${code}`);
    assert.equal(f.env.DB.tickets.get(issued.hash).consumedAt, null);
    const event = f.env.DB.events.find(event => event.eventType === 'oauth_authorize_failure');
    assert.ok(event, `${stage}/${code}`);
    assert.deepEqual(event.metadata, { stage, code, method: 'POST' });
    assert.equal(event.requestId, 'synthetic-post-diagnostic-request');
    const diagnosticText = JSON.stringify(event);
    for (const forbidden of [secret, issued.value, issued.hash, flow.handle, flow.cookie, client.client_id, ORIGIN]) {
      assert.ok(!diagnosticText.includes(forbidden));
    }
    assert.ok(!(await response.text()).includes(secret));
  }
});
