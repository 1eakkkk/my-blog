import OAuthProvider, { AuthorizationError, CimdFetchError, GrantType, OAuthError } from '@cloudflare/workers-oauth-provider';

export const AUTH_USER_ID = 'diary-p0';
export const AUTH_PROPS = Object.freeze({ channel: 'diary-p0', authorId: 'ai-diary-p0' });
export const AUTH_SCOPES = Object.freeze(['diary:read', 'diary:publish', 'offline_access']);
export const ACCESS_TOKEN_TTL = 300;
export const REFRESH_IDLE_TTL = 30 * 24 * 60 * 60;
const DEFAULT_REDIRECTS = ['https://chatgpt.com/connector_platform_oauth_redirect'];
const DEFAULT_CLIENT_DOCUMENTS = ['https://chatgpt.com/oauth/client.json'];
const MAX_FORM_BYTES = 8192;

export function publicOrigin(env) {
  const value = env.PUBLIC_ORIGIN;
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (typeof value !== 'string' || ![url.origin, `${url.origin}/`].includes(value)
    || url.username || url.password || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) {
    throw new TypeError('PUBLIC_ORIGIN must be a canonical HTTPS origin (HTTP loopback is allowed locally).');
  }
  return url.origin;
}

function exactList(value, fallback, name) {
  const list = value === undefined ? fallback : JSON.parse(value);
  if (!Array.isArray(list) || list.length === 0 || list.length > 20
    || list.some(item => typeof item !== 'string' || item !== new URL(item).href)
    || new Set(list).size !== list.length) throw new TypeError(`${name} must be a JSON array of exact URLs.`);
  return new Set(list);
}

function policy(env, origin) {
  const localOrigin = new URL(origin);
  const allowLocalDcr = env.OAUTH_ALLOW_LOCAL_DCR === 'true';
  if (allowLocalDcr && !['127.0.0.1', 'localhost', '[::1]'].includes(localOrigin.hostname)) {
    throw new TypeError('OAUTH_ALLOW_LOCAL_DCR is only available on a loopback PUBLIC_ORIGIN.');
  }
  const redirects = exactList(env.OAUTH_REDIRECT_URIS, DEFAULT_REDIRECTS, 'OAUTH_REDIRECT_URIS');
  const clientDocuments = exactList(env.OAUTH_CLIENT_METADATA_URLS, DEFAULT_CLIENT_DOCUMENTS, 'OAUTH_CLIENT_METADATA_URLS');
  for (const value of redirects) {
    const url = new URL(value);
    const local = allowLocalDcr && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
      throw new TypeError('OAuth redirects must use HTTPS, except HTTP loopback in local tests.');
    }
    if (!local && (url.origin !== 'https://chatgpt.com' || url.search
      || !(url.pathname === '/connector_platform_oauth_redirect' || /^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(url.pathname)))) {
      throw new TypeError('Production redirects must be exact ChatGPT OAuth callback URLs.');
    }
  }
  for (const value of clientDocuments) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new TypeError('OAuth client metadata must use an exact HTTPS URL.');
    }
    if (url.origin !== 'https://chatgpt.com'
      || !(url.pathname === '/oauth/client.json' || /^\/oauth\/[A-Za-z0-9_-]+\/client\.json$/.test(url.pathname))) {
      throw new TypeError('Production client metadata must be an exact ChatGPT client document URL.');
    }
  }
  return { redirects, clientDocuments };
}

export function validateScopes(scope) {
  if (!Array.isArray(scope) || scope.length > AUTH_SCOPES.length
    || scope.some(value => !AUTH_SCOPES.includes(value)) || new Set(scope).size !== scope.length) {
    throw new TypeError('Unsupported OAuth scopes.');
  }
  return scope;
}

function hasToolScope(scope) {
  return scope.includes('diary:read') || scope.includes('diary:publish');
}

function validateAuthorization(request, rules, origin) {
  if (!rules.redirects.has(request.redirectUri) || request.resource !== `${origin}/mcp`) {
    throw new TypeError('Unsupported OAuth client or resource.');
  }
  if (request.clientId.includes('://') && !rules.clientDocuments.has(request.clientId)) {
    throw new TypeError('Unsupported OAuth client metadata.');
  }
  validateScopes(request.scope);
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
}

function secureHeaders(extra, validatedRedirectUri) {
  const headers = new Headers(extra);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  // Only the validated consent page may follow its precise OAuth callback.
  // Server-side exact redirect validation remains authoritative on redirects.
  const formActions = validatedRedirectUri ? `'self' ${validatedRedirectUri}` : "'self'";
  headers.set('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; form-action ${formActions}; base-uri 'none'; frame-ancestors 'none'`);
  return headers;
}

function localError(status, message) {
  return new Response(message, { status, headers: secureHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }) });
}

function consentPage(details, handle) {
  const labels = {
    'diary:read': '读取固定、虚构的 P0 测试素材',
    'diary:publish': '以 AI 日记测试身份写入隔离测试区',
    offline_access: '在授权有效期内自动续期；可撤销授权',
  };
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI 日记 · 测试授权</title><style>body{font:16px/1.7 system-ui,sans-serif;background:#f4f5f7;color:#19212d;margin:0;padding:24px}main{max-width:560px;margin:48px auto;padding:32px;background:white;border-radius:20px}h1{font-size:24px}label{display:block;margin:16px 0}input[type=password]{box-sizing:border-box;width:100%;padding:12px;font:inherit}button{padding:12px 20px;font:inherit;margin:8px 8px 0 0}small{color:#576474;overflow-wrap:anywhere}</style></head><body><main><h1>允许此客户端进行日记测试？</h1><p>客户端：<strong>${escapeHtml(details.clientName)}</strong></p><p>${details.clientDomain ? `客户端声明域名：${escapeHtml(details.clientDomain)}` : '客户端名称由其自行声明。'}<br>授权结果将发送到：<strong>${escapeHtml(details.redirectHost)}</strong></p><p>仅使用虚构素材和隔离测试存储，不访问真实聊天或正式博客。请输入本次管理员签发的十分钟一次性票据，并明确选择授权：</p><form method="post" action="/authorize"><input type="hidden" name="handle" value="${escapeHtml(handle)}">${AUTH_SCOPES.map(scope => `<label><input type="checkbox" name="scope" value="${escapeHtml(scope)}" checked> ${labels[scope]}</label>`).join('')}<label>一次性授权票据<input type="password" name="ticket" autocomplete="off" spellcheck="false" minlength="43" maxlength="128"></label><button name="decision" value="approve" type="submit">同意测试授权</button><button name="decision" value="deny" type="submit">拒绝</button></form><small>票据只随此表单提交，不放入网址。授权失败时，请重新打开授权流程；票据已消费时可重新签发。</small></main></body></html>`;
}

async function readBoundedBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new TypeError('Missing authorization form.');
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_FORM_BYTES) {
      await reader.cancel();
      throw new TypeError('Authorization form is too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function readForm(request, origin) {
  if (request.headers.get('Origin') !== origin
    || (request.headers.has('Sec-Fetch-Site') && request.headers.get('Sec-Fetch-Site') !== 'same-origin')) {
    throw new TypeError('The authorization form must be submitted from the same origin.');
  }
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/x-www-form-urlencoded') {
    throw new TypeError('Unsupported authorization form.');
  }
  const form = new URLSearchParams(await readBoundedBody(request));
  if ([...form.keys()].some(key => !['handle', 'scope', 'ticket', 'decision'].includes(key))
    || ['handle', 'ticket', 'decision'].some(key => form.getAll(key).length > 1)) {
    throw new TypeError('Invalid authorization form.');
  }
  return form;
}

export async function hashAuthTicket(ticket) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ticket));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function consumeAuthTicket(db, ticket, now = Date.now()) {
  if (typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(ticket)) return false;
  const row = await db.prepare(`UPDATE auth_tickets SET consumed_at = ?
    WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ? RETURNING token_hash`)
    .bind(now, await hashAuthTicket(ticket), now).first();
  return Boolean(row);
}

export function validateGrantExchange(options, origin) {
  try {
    if (![GrantType.AUTHORIZATION_CODE, GrantType.REFRESH_TOKEN].includes(options.grantType)
      || options.userId !== AUTH_USER_ID || !options.grantId || !options.clientId
      || options.resource !== `${origin}/mcp` || options.props?.channel !== AUTH_PROPS.channel
      || options.props?.authorId !== AUTH_PROPS.authorId) throw new TypeError();
    if (options.grantType === GrantType.REFRESH_TOKEN && options.props.grantId !== options.grantId) {
      throw new TypeError();
    }
    validateScopes(options.scope);
    validateScopes(options.requestedScope);
    if (options.grantType === GrantType.REFRESH_TOKEN && !options.scope.includes('offline_access')) {
      throw new TypeError();
    }
    if (!hasToolScope(options.scope) || options.requestedScope.some(value => !options.scope.includes(value))) {
      throw new TypeError();
    }
  } catch {
    throw new OAuthError('invalid_grant', { description: 'This grant is not authorized for the diary P0 test.' });
  }
}

async function auditExchange(options, origin) {
  validateGrantExchange(options, origin);
  if (await options.env.DB.prepare('SELECT grant_id FROM revoked_grants WHERE grant_id = ?')
    .bind(options.grantId).first()) {
    throw new OAuthError('invalid_grant', { description: 'This authorization has been revoked.' });
  }
  const now = Date.now();
  const refreshGranted = options.scope.includes('offline_access');
  const date = new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await options.env.DB.prepare(`INSERT INTO probe_events
    (event_type, date, grant_id, request_id, created_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(options.grantType === GrantType.REFRESH_TOKEN ? 'oauth_refresh_token' : 'oauth_authorization_code',
      date, options.grantId, requestId(options.env), now, JSON.stringify({
        phase: 'validated_exchange', resource: options.resource, scopes: options.requestedScope,
        accessTokenTtlSeconds: ACCESS_TOKEN_TTL, refreshIdleTtlSeconds: refreshGranted ? REFRESH_IDLE_TTL : 0,
      })).run();
  return { newProps: { ...AUTH_PROPS, grantId: options.grantId },
    refreshTokenTTL: refreshGranted ? REFRESH_IDLE_TTL : 0 };
}

function requestId(env) {
  return typeof env.PROBE_REQUEST_ID === 'string' && env.PROBE_REQUEST_ID.length > 0
    && env.PROBE_REQUEST_ID.length <= 128 ? env.PROBE_REQUEST_ID : crypto.randomUUID();
}

async function listGrants(oauth) {
  const grants = [];
  const cursors = new Set();
  let cursor;
  do {
    const page = await oauth.listUserGrants(AUTH_USER_ID, { limit: 100, ...(cursor ? { cursor } : {}) });
    grants.push(...page.items);
    cursor = page.cursor;
    if (cursor && cursors.has(cursor)) throw new Error('Grant pagination did not advance.');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return grants;
}

async function revoke(request, env, origin) {
  if (request.method !== 'POST') return localError(405, 'Use POST for operator revocation.');
  if (new URL(request.url).search) return localError(400, 'Operator credentials must not be placed in URLs.');
  if ((request.headers.has('Origin') && request.headers.get('Origin') !== origin)
    || (request.headers.has('Sec-Fetch-Site') && !['same-origin', 'none'].includes(request.headers.get('Sec-Fetch-Site')))) {
    return localError(400, 'Invalid operator request origin.');
  }
  const bearer = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/i)?.[1];
  if (!bearer) return localError(401, 'An operator ticket is required.');
  try {
    if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') throw new TypeError();
    const command = JSON.parse(await readBoundedBody(request));
    if (!command || typeof command !== 'object' || Array.isArray(command) || Object.keys(command).length !== 1
      || !(command.all === true || (typeof command.grantId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(command.grantId)))) {
      throw new TypeError();
    }
    if (!await consumeAuthTicket(env.DB, bearer)) return localError(401, 'The operator ticket is invalid, expired, or used.');
    const oauth = env.OAUTH_PROVIDER;
    const grants = await listGrants(oauth);
    const grantIds = grants.filter(grant => command.all === true || grant.id === command.grantId).map(grant => grant.id);
    if (command.all !== true && grantIds.length === 0) return localError(404, 'No grant belonging to the P0 identity was found.');
    const now = Date.now();
    if (grantIds.length) {
      // D1 commits the entire denylist before any eventually-consistent KV deletion.
      await env.DB.batch(grantIds.map(grantId => env.DB.prepare(
        'INSERT OR IGNORE INTO revoked_grants (grant_id, revoked_at) VALUES (?, ?)').bind(grantId, now)));
      for (const grantId of grantIds) await oauth.revokeGrant(grantId, AUTH_USER_ID);
    }
    await env.DB.prepare(`INSERT INTO probe_events
      (event_type, date, grant_id, request_id, created_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind('oauth_operator_revoke', null, command.all === true ? null : command.grantId,
        requestId(env), now, JSON.stringify({ synthetic: true, revokedCount: grantIds.length })).run();
    return Response.json({ revokedCount: grantIds.length, grantIds }, { headers: secureHeaders() });
  } catch {
    return localError(400, 'Revocation could not be completed. Obtain a new operator ticket before retrying.');
  }
}

async function authorize(request, env, origin, rules) {
  const url = new URL(request.url);
  if (url.pathname === '/operator/revoke') return revoke(request, env, origin);
  if (url.pathname !== '/authorize') return localError(404, 'Not found.');
  if (url.searchParams.has('ticket')) return localError(400, 'Authorization tickets must only be submitted in the form.');
  const oauth = env.OAUTH_PROVIDER;
  if (!oauth) return localError(503, 'Authorization is unavailable.');
  let stage = 'client_policy';
  try {
    if (request.method === 'GET') {
      const clientId = url.searchParams.get('client_id') || '';
      if (clientId.includes('://') && !rules.clientDocuments.has(clientId)) throw new TypeError();
      stage = 'parse_request';
      const authRequest = await oauth.parseAuthRequest(request);
      stage = 'validate_policy';
      validateAuthorization(authRequest, rules, origin);
      stage = 'describe_consent';
      const details = await oauth.describeConsent(authRequest);
      stage = 'begin_consent';
      const transaction = await oauth.beginConsent(authRequest);
      const headers = secureHeaders(transaction.headers, authRequest.redirectUri);
      headers.set('Content-Type', 'text/html; charset=utf-8');
      return new Response(consentPage(details, transaction.handle), { headers });
    }
    if (request.method !== 'POST') return localError(405, 'Use GET or POST for authorization.');
    const form = await readForm(request, origin);
    if (form.get('decision') === 'deny') {
      const denied = await oauth.denyConsent(request, form.get('handle'));
      validateAuthorization(denied.request, rules, origin);
      return new Response(null, { status: 303, headers: secureHeaders(denied.headers) });
    }
    if (form.get('decision') !== 'approve') throw new TypeError();
    const scope = validateScopes(form.getAll('scope'));
    if (!hasToolScope(scope)) throw new TypeError();
    const approved = await oauth.approveConsent(request, form.get('handle'), { scope });
    validateAuthorization(approved.request, rules, origin);
    if (!await consumeAuthTicket(env.DB, form.get('ticket'))) {
      return localError(401, 'The authorization ticket is invalid, expired, or already used. Start authorization again.');
    }
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request, userId: AUTH_USER_ID, scope: approved.request.scope,
      metadata: { channel: 'diary-p0', synthetic: true }, props: { ...AUTH_PROPS },
    });
    approved.headers.set('Location', redirectTo);
    return new Response(null, { status: 303, headers: secureHeaders(approved.headers) });
  } catch (error) {
    if (request.method === 'GET') {
      const knownCodes = ['invalid_request', 'invalid_client', 'invalid_client_metadata', 'invalid_redirect_uri',
        'invalid_target', 'unauthorized_client', 'access_denied', 'unsupported_response_type',
        'invalid_scope', 'server_error', 'temporarily_unavailable'];
      const code = error instanceof CimdFetchError ? 'metadata_resolution_failed'
        : (error instanceof OAuthError || error instanceof AuthorizationError) && knownCodes.includes(error.code) ? error.code
        : error instanceof Error && error.message === "CIMD is enabled but 'global_fetch_strictly_public' compatibility flag is not set."
          ? 'cimd_compatibility_flag_missing'
          : error instanceof TypeError ? 'policy_rejected' : 'authorization_failed';
      const metadata = { stage, code };
      // Read only the library's exact HTTP-status detail; never retain its URL,
      // detail, message, description, state, redirect, or cause.
      if (error instanceof CimdFetchError && typeof error.detail === 'string') {
        const status = error.detail.match(/^Failed to fetch client metadata: HTTP ([1-5][0-9]{2})$/);
        if (status && status[0] === error.detail) metadata.metadataHttpStatus = Number(status[1]);
      }
      try {
        await env.DB.prepare(`INSERT INTO probe_events
          (event_type,date,grant_id,request_id,created_at,metadata_json) VALUES (?,NULL,NULL,?,?,?)`)
          .bind('oauth_authorize_failure', requestId(env), Date.now(), JSON.stringify(metadata)).run();
      } catch { /* Diagnostics never change authorization failure behavior. */ }
    }
    return localError(400, 'Authorization could not be completed. Start again and obtain a new ticket if the previous one was consumed.');
  }
}

class OriginBoundProvider extends OAuthProvider {
  constructor(options, origin) { super(options); this.publicOrigin = origin; }
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.origin !== this.publicOrigin
      || (request.headers.has('Host') && request.headers.get('Host') !== url.host)) {
      return localError(400, 'Invalid request origin.');
    }
    const response = await super.fetch(request, env, ctx);
    if (request.method === 'GET' && response.status === 200
      && ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'].includes(url.pathname)) {
      // Provider 1.2.3 conflates resourceMetadata.scopes_supported with mandatory
      // route scopes. Adapt discovery only; token verification remains untouched.
      const metadata = await response.json();
      return new Response(JSON.stringify({ ...metadata, scopes_supported: [...AUTH_SCOPES] }), {
        status: response.status, headers: response.headers,
      });
    }
    return response;
  }
}

export function makeProvider(env, apiHandler) {
  const origin = publicOrigin(env);
  const rules = policy(env, origin);
  return new OriginBoundProvider({
    apiRoute: '/mcp', apiHandler,
    defaultHandler: { fetch: (request, runtimeEnv) => authorize(request, runtimeEnv, origin, rules) },
    authorizeEndpoint: `${origin}/authorize`, tokenEndpoint: `${origin}/oauth/token`,
    clientRegistrationEndpoint: `${origin}/oauth/register`,
    resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin], resource_name: 'AI 日记 P0 测试' },
    // Authentication is still required; each tool enforces its own narrow scope.
    requiredScopes: [], scopesSupported: [...AUTH_SCOPES],
    accessTokenTTL: ACCESS_TOKEN_TTL, refreshTokenTTL: REFRESH_IDLE_TTL, refreshTokenIdleTTL: REFRESH_IDLE_TTL,
    clientIdMetadataDocumentEnabled: true,
    clientRegistrationCallback: ({ clientMetadata }) => {
      if (!Array.isArray(clientMetadata.redirect_uris) || clientMetadata.redirect_uris.length === 0
        || clientMetadata.redirect_uris.some(uri => !rules.redirects.has(uri))) {
        return { code: 'invalid_client_metadata', description: 'The exact redirect URI is not allowed.' };
      }
      if (clientMetadata.scope !== undefined) {
        try { validateScopes(String(clientMetadata.scope).split(' ').filter(Boolean)); }
        catch { return { code: 'invalid_client_metadata', description: 'Unsupported OAuth scopes.' }; }
      }
    },
    tokenExchangeCallback: options => auditExchange(options, origin),
    onError: () => {},
  }, origin);
}
