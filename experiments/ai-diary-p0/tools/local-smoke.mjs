import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const wrangler = resolve(cwd, 'node_modules/wrangler/bin/wrangler.js');
const exec = promisify(execFile);
const origin = 'http://127.0.0.1:8787';
const callback = 'http://127.0.0.1:8978/callback';
const hash = value => createHash('sha256').update(value).digest('hex');
const evidence = { environment: 'LOCAL_WORKER_SYNTHETIC', checkedAt: new Date().toISOString(), checks: [],
  chatgptScheduled: 'UNVERIFIED', computerOffline: 'UNVERIFIED', pushDelivery: 'UNVERIFIED' };
const check = (name, details = {}) => evidence.checks.push({ name, result: 'PASS', ...details });

async function sql(command) {
  const { stdout } = await exec(process.execPath, [wrangler, 'd1', 'execute', 'DB', '--local', '--command', command, '--json'],
    { cwd, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  return JSON.parse(stdout);
}

async function json(path, init = {}) {
  const response = await fetch(origin + path, { ...init, redirect: 'manual' });
  const value = await response.json();
  assert.ok((path === '/oauth/register' ? [200, 201] : [200]).includes(response.status), `Unexpected HTTP status for ${path}: ${response.status}`);
  return value;
}

async function authorize(scope) {
  const client = await json('/oauth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      client_name: 'P0 local integration test', redirect_uris: [callback],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: 'none', scope: scope.join(' '),
    }),
  });
  const verifier = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({ response_type: 'code', client_id: client.client_id,
    redirect_uri: callback, resource: origin + '/mcp', scope: scope.join(' '), state: randomBytes(16).toString('hex'),
    code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') });
  const page = await fetch(origin + '/authorize?' + params, { redirect: 'manual' });
  assert.equal(page.status, 200, 'Authorization form must be available');
  const html = await page.text();
  const handle = html.match(/name="handle" value="([^"]+)"/)?.[1];
  assert.ok(handle, 'Consent handle must exist');
  const cookie = page.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const ticket = randomBytes(32).toString('base64url');
  await sql(`INSERT INTO auth_tickets(token_hash,expires_at) VALUES ('${hash(ticket)}',${Date.now() + 600000})`);
  const form = new URLSearchParams({ handle, ticket, decision: 'approve' });
  scope.forEach(value => form.append('scope', value));
  const approved = await fetch(origin + '/authorize', { method: 'POST', redirect: 'manual', body: form,
    headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', Cookie: cookie } });
  assert.equal(approved.status, 303, 'Consent must produce a validated redirect');
  const redirect = new URL(approved.headers.get('Location'));
  assert.equal(redirect.origin + redirect.pathname, callback);
  assert.equal(redirect.searchParams.get('state'), params.get('state'));
  const tokens = await json('/oauth/token', { method: 'POST', body: new URLSearchParams({
    grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: callback,
    code_verifier: verifier, code: redirect.searchParams.get('code'), resource: origin + '/mcp' }) });
  assert.equal(tokens.expires_in, 300);
  assert.ok(tokens.refresh_token, 'Offline renewal credential must be present');
  return { tokens, clientId: client.client_id };
}

let requestId = 0;
async function rpc(tokens, method, params) {
  const response = await fetch(origin + '/mcp', { method: 'POST', redirect: 'manual', headers: {
    Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }) });
  const body = await response.json();
  assert.equal(response.status, 200, `MCP ${method} status ${response.status}`);
  assert.equal(body.error, undefined, `MCP ${method} must not produce a protocol error`);
  return body.result;
}

async function call(tokens, name, args) {
  const result = await rpc(tokens, 'tools/call', { name, arguments: args });
  return { ...result.structuredContent, isError: result.isError || false, _meta: result._meta };
}

try {
  const unauthorized = await fetch(origin + '/mcp');
  assert.equal(unauthorized.status, 401);
  assert.ok(unauthorized.headers.get('WWW-Authenticate')?.includes('resource_metadata'));
  check('anonymous_mcp_rejected');
  const metadata = await json('/.well-known/oauth-protected-resource/mcp');
  assert.equal(metadata.resource, origin + '/mcp');
  check('standard_resource_discovery');
  const identity = await authorize(['diary:read', 'diary:publish', 'offline_access']);
  const init = await rpc(identity.tokens, 'initialize', { protocolVersion: '2025-11-25', capabilities: {},
    clientInfo: { name: 'local-p0-smoke', version: '1.0.0' } });
  assert.ok(init.serverInfo);
  const tools = await rpc(identity.tokens, 'tools/list', {});
  assert.deepEqual(tools.tools.map(item => item.name).sort(), ['get_diary_source_packet', 'publish_diary']);
  assert.equal(tools.tools.find(item => item.name === 'publish_diary').annotations.readOnlyHint, false);
  for (const [name, scope] of [['get_diary_source_packet', 'diary:read'], ['publish_diary', 'diary:publish']]) {
    const tool = tools.tools.find(item => item.name === name);
    assert.deepEqual(tool._meta?.securitySchemes, [{ type: 'oauth2', scopes: [scope] }], `${name} must advertise its OAuth scope on the wire`);
    if (tool.securitySchemes) assert.deepEqual(tool.securitySchemes, tool._meta.securitySchemes);
  }
  check('oauth_and_honest_mcp_tool_metadata');

  let date, packet;
  for (let offset = 1; offset <= 7; offset++) {
    const candidate = new Date(Date.now() + 8 * 3600000 - offset * 86400000).toISOString().slice(0, 10);
    const value = await call(identity.tokens, 'get_diary_source_packet', { date: candidate });
    assert.equal(value.isError, false);
    if (!value.previousReceipt) { date = candidate; packet = value; break; }
  }
  assert.ok(packet, 'Local test date slots are occupied; use an isolated fresh local DB rather than deleting the registry');
  assert.equal(packet.isError, false);
  assert.equal(packet.synthetic, true);
  assert.equal(packet.sourceManifest.messageCount, 3);
  const input = { date, sourceManifestId: packet.sourceManifestId,
    content: packet.previousContent || '# 虚构日记\n\n他整理阳台植物，讨论读书笔记的章节安排，并决定明天继续阅读。本篇只记录固定虚构样本。' };
  const created = await call(identity.tokens, 'publish_diary', input);
  assert.equal(created.isError, false);
  const repeated = await call(identity.tokens, 'publish_diary', input);
  assert.equal(repeated.status, 200);
  assert.equal(repeated.receipt.postId, created.receipt.postId);
  const conflict = await call(identity.tokens, 'publish_diary', { ...input, content: input.content + '\n不同请求。' });
  assert.equal(conflict.error, 'CONFLICT');
  check('read_publish_duplicate_and_conflict', { date, postId: created.receipt.postId,
    snapshotId: packet.snapshotId, requestHash: created.receipt.requestHash });

  const renewed = await json('/oauth/token', { method: 'POST', body: new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: identity.tokens.refresh_token,
    client_id: identity.clientId, resource: origin + '/mcp' }) });
  assert.notEqual(renewed.refresh_token, identity.tokens.refresh_token);
  const renewedPacket = await call(renewed, 'get_diary_source_packet', { date });
  assert.equal(renewedPacket.isError, false);
  check('explicit_refresh_rotation_and_new_token_use', { note: 'Explicit local refresh; scheduled expiry refresh remains unverified.' });

  await sql(`UPDATE probe_diaries SET content='人工修改的虚构内容',updated_at=${Date.now()} WHERE id=${created.receipt.postId}`);
  const afterEdit = await call(renewed, 'publish_diary', input);
  assert.equal(afterEdit.status, 200);
  const edited = await sql(`SELECT content FROM probe_diaries WHERE id=${created.receipt.postId}`);
  assert.equal(edited[0].results[0].content, '人工修改的虚构内容');
  await sql(`DELETE FROM probe_diaries WHERE id=${created.receipt.postId}`);
  const deleted = await call(renewed, 'publish_diary', input);
  assert.equal(deleted.status, 410);
  check('manual_edit_preserved_and_physical_delete_date_retained');

  const readOnly = await authorize(['diary:read', 'offline_access']);
  const denied = await call(readOnly.tokens, 'publish_diary', input);
  assert.equal(denied.status, 403);
  assert.ok(denied._meta?.['mcp/www_authenticate']?.some(value => value.includes('insufficient_scope') && value.includes('diary:publish')),
    'Missing write scope must include an OAuth challenge for the client');
  check('read_only_grant_cannot_publish');
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const invalid = await call(readOnly.tokens, 'get_diary_source_packet', { date: today });
  assert.equal(invalid.error, 'DATE_OUT_OF_RANGE');
  check('today_and_future_window_rejected');
  const operatorTicket = randomBytes(32).toString('base64url');
  await sql(`INSERT INTO auth_tickets(token_hash,expires_at) VALUES ('${hash(operatorTicket)}',${Date.now() + 600000})`);
  const revoked = await json('/operator/revoke', { method: 'POST', headers: {
    Authorization: `Bearer ${operatorTicket}`, 'Content-Type': 'application/json',
  }, body: JSON.stringify({ all: true }) });
  assert.ok(revoked.revokedCount >= 2);
  const oldAccess = await fetch(origin + '/mcp', { method: 'POST', headers: {
    Authorization: `Bearer ${renewed.access_token}`, 'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }, body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method: 'tools/list', params: {} }) });
  assert.equal(oldAccess.status, 401);
  const oldRefresh = await fetch(origin + '/oauth/token', { method: 'POST', body: new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: renewed.refresh_token,
    client_id: identity.clientId, resource: origin + '/mcp' }) });
  assert.equal(oldRefresh.status, 400);
  check('operator_revoke_rejects_previous_access_and_refresh', { revokedCount: revoked.revokedCount });
  evidence.result = 'PASS';
} catch (error) {
  evidence.result = 'FAIL';
  evidence.error = String(error.message).slice(0, 1000);
  process.exitCode = 1;
} finally {
  await mkdir(resolve(cwd, '.secrets'), { recursive: true });
  await writeFile(resolve(cwd, '.secrets/local-smoke.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(evidence, null, 2));
}
