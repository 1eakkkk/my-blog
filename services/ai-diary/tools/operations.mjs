#!/usr/bin/env node
import { readFile, mkdir, open, unlink, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { freezeSourcePacket } from '../src/source.js';

const PROJECT = fileURLToPath(new URL('../', import.meta.url));
const REPOSITORY = fileURLToPath(new URL('../../../', import.meta.url));
const CONFIG = path.join(PROJECT, 'wrangler.jsonc');
export const ACCOUNT = '8e73b0f5db32961447753ca70a8d52ea';
export const PRIVATE_DB = '1eba1d71-8f5a-4b14-89ed-4262dd4aebc0';
export const SITE_DB = 'de22f833-7e09-45f8-8c20-d89815e24040';
export const ORIGIN = 'https://my-blog-ai-diary.zhou17749984708.workers.dev';
export const ROW_LIMIT = 2000;
const KV = 'd2491a9f6d5549de97b527fa763062e8';

export class OperationError extends Error {
  constructor(code, status) { super(code); this.code = code; if (status) this.status = status; }
}
function fail(code, status) { throw new OperationError(code, status); }

export function parseArguments(argv) {
  const [command = 'help', ...args] = argv;
  if (['help', '--help', '-h'].includes(command) && !args.length) return { command: 'help' };
  const allowed = { 'issue-ticket': ['out', 'oauth-config'], 'stage-source': ['input', 'oauth-config'],
    report: ['out', 'oauth-config'], 'revoke-all': ['oauth-config'] };
  if (!Object.hasOwn(allowed, command)) fail('UNKNOWN_COMMAND');
  const options = { command, remote: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--remote') { if (options.remote) fail('INVALID_ARGUMENTS'); options.remote = true; continue; }
    const key = args[i].startsWith('--') ? args[i].slice(2) : '';
    if (!allowed[command].includes(key) || Object.hasOwn(options, key) || !args[i + 1] || args[i + 1].startsWith('--')) fail('INVALID_ARGUMENTS');
    options[key] = args[++i];
  }
  if (!options.remote) fail('REMOTE_REQUIRED');
  if (['issue-ticket', 'report'].includes(command) && !options.out) fail('OUTPUT_REQUIRED');
  if (command === 'stage-source' && !options.input) fail('INPUT_REQUIRED');
  return options;
}

export function parseConfig(text) {
  // Deployed config is strict JSON despite its .jsonc extension. Never execute it.
  try { return JSON.parse(text); } catch { fail('INVALID_CONFIG'); }
}

export function validateConfiguration(config) {
  const bindings = config?.d1_databases;
  const privateDb = bindings?.find(binding => binding.binding === 'DB');
  const siteDb = bindings?.find(binding => binding.binding === 'SITE_DB');
  if (config?.name !== 'my-blog-ai-diary' || config.account_id !== ACCOUNT
    || !Array.isArray(bindings) || bindings.length !== 2
    || privateDb?.database_id !== PRIVATE_DB || privateDb.database_name !== 'my-blog-ai-diary'
    || siteDb?.database_id !== SITE_DB || siteDb.database_name !== 'my-blog-db'
    || privateDb.database_id === siteDb.database_id
    || config?.kv_namespaces?.length !== 1 || config.kv_namespaces[0].binding !== 'OAUTH_KV' || config.kv_namespaces[0].id !== KV
    || config.vars?.PUBLIC_ORIGIN !== ORIGIN || config.vars?.SITE_ORIGIN !== 'https://app.1eak.cool'
    || config.vars?.AI_AUTHOR_ID !== '56' || config.vars?.DIARY_ENVIRONMENT !== 'site-publisher'
    || !['true', 'false'].includes(config.vars?.SITE_PUBLISH_ENABLED)
    || Object.keys(config.env || {}).length || config.r2_buckets?.length) fail('CONFIGURATION_SCOPE_MISMATCH');
  return config;
}

function within(base, target) {
  const relative = path.relative(base, target);
  return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function externalPath(value, { directory = false, repository = REPOSITORY } = {}) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) fail('ABSOLUTE_PRIVATE_PATH_REQUIRED');
  const target = path.resolve(value), repo = await realpath(repository);
  if (within(repo, target)) fail('PRIVATE_PATH_INSIDE_REPOSITORY');
  let ancestor = target;
  const remainder = [];
  while (true) {
    try { await lstat(ancestor); break; }
    catch (error) {
      if (error.code !== 'ENOENT' || ancestor === path.dirname(ancestor)) fail('PRIVATE_PATH_UNAVAILABLE');
      remainder.unshift(path.basename(ancestor)); ancestor = path.dirname(ancestor);
    }
  }
  const resolved = path.join(await realpath(ancestor), ...remainder);
  if (within(repo, resolved)) fail('PRIVATE_PATH_INSIDE_REPOSITORY');
  if (directory) {
    await mkdir(target, { recursive: true, mode: 0o700 });
    const stat = await lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink() || within(repo, await realpath(target))) fail('UNSAFE_PRIVATE_DIRECTORY');
  } else {
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) fail('INVALID_PRIVATE_INPUT');
  }
  return target;
}

async function privateFile(filename, contents) {
  const handle = await open(filename, 'wx', 0o600);
  try { await handle.writeFile(contents, 'utf8'); await handle.sync(); } finally { await handle.close(); }
}

export async function managementToken(options, environment = process.env) {
  if (typeof environment.CLOUDFLARE_API_TOKEN === 'string' && environment.CLOUDFLARE_API_TOKEN.trim()) {
    return environment.CLOUDFLARE_API_TOKEN.trim();
  }
  const filename = options['oauth-config'] || (environment.APPDATA
    && path.join(environment.APPDATA, 'xdg.config', '.wrangler', 'config', 'default.toml'));
  if (!filename || !path.isAbsolute(filename)) fail('MANAGEMENT_AUTH_REQUIRED');
  let text;
  try { text = await readFile(filename, 'utf8'); } catch { fail('MANAGEMENT_AUTH_REQUIRED'); }
  const match = text.match(/^oauth_token\s*=\s*("(?:[^"\\]|\\.)*")\s*$/m);
  if (!match) fail('MANAGEMENT_AUTH_REQUIRED');
  try {
    const token = JSON.parse(match[1]);
    if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) fail('MANAGEMENT_AUTH_REQUIRED');
    return token;
  } catch { fail('MANAGEMENT_AUTH_REQUIRED'); }
}

async function boundedJson(response, maximum = 8 * 1024 * 1024) {
  if (!response.body) fail('INVALID_REMOTE_RESPONSE');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) { await reader.cancel(); fail('INVALID_REMOTE_RESPONSE'); }
      chunks.push(part.value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('INVALID_REMOTE_RESPONSE'); }
  } catch (error) { if (error instanceof OperationError) throw error; fail('INVALID_REMOTE_RESPONSE'); }
  finally { reader.releaseLock(); }
}

export function cloudflareClient(token, { fetcher = fetch } = {}) {
  return { async query(databaseId, sql, params = []) {
    if (![PRIVATE_DB, SITE_DB].includes(databaseId) || typeof sql !== 'string' || !Array.isArray(params)
      || (databaseId === SITE_DB && (!/^SELECT\s/i.test(sql) || sql.includes(';')))) fail('DATABASE_SCOPE_MISMATCH');
    let response;
    try { response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${databaseId}/query`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }),
    }); } catch { fail('CLOUDFLARE_REQUEST_FAILED'); }
    if (!response.ok) fail(response.status === 401 || response.status === 403 ? 'AUTH_REQUIRED' : 'CLOUDFLARE_REQUEST_FAILED', response.status);
    const body = await boundedJson(response);
    if (body?.success !== true || !Array.isArray(body.result) || !body.result.length
      || body.result.some(result => result.success !== true || !Array.isArray(result.results))) fail('D1_EXECUTION_FAILED');
    return body.result.flatMap(result => result.results);
  } };
}

export function newTicket(now = Date.now()) {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: createHash('sha256').update(token).digest('hex'), expiresAt: now + 600000 };
}
async function recordTicket(client, ticket) {
  await client.query(PRIVATE_DB, 'INSERT INTO auth_tickets(token_hash,expires_at,consumed_at) VALUES (?,?,NULL)', [ticket.hash, ticket.expiresAt]);
}

export async function issueTicket(client, options, { log = console.log, now = Date.now() } = {}) {
  const out = await externalPath(options.out, { directory: true });
  const ticket = newTicket(now), filename = path.join(out, 'ticket.txt');
  await privateFile(filename, `${ticket.token}\n`);
  try { await recordTicket(client, ticket); }
  catch (error) { await unlink(filename).catch(() => {}); throw error; }
  const receipt = { path: filename, expiresAt: ticket.expiresAt, expiresAtIso: new Date(ticket.expiresAt).toISOString() };
  log(JSON.stringify(receipt)); return receipt;
}

export async function stageSource(client, options, { log = console.log, now = Date.now() } = {}) {
  const input = await externalPath(options.input);
  let object;
  try { object = JSON.parse(await readFile(input, 'utf8')); } catch { fail('INVALID_SOURCE_INPUT'); }
  let packet;
  try { packet = await freezeSourcePacket(object, now); } catch { fail('INVALID_SOURCE_INPUT'); }
  await client.query(PRIVATE_DB, `INSERT INTO diary_source_packets
    (id,date,channel,snapshot_id,manifest_json,messages_json,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(channel,date) DO NOTHING`,
    [packet.id, packet.date, packet.channel, packet.snapshot_id, packet.manifest_json, packet.messages_json, packet.created_at, packet.expires_at]);
  const rows = await client.query(PRIVATE_DB, `SELECT id,date,channel,snapshot_id,
    json_extract(manifest_json,'$.serverHash') AS server_hash,json_extract(manifest_json,'$.messageCount') AS message_count
    FROM diary_source_packets WHERE date=? AND channel=?`, [packet.date, packet.channel]);
  if (rows.length !== 1 || rows[0].id !== packet.id || rows[0].snapshot_id !== packet.snapshot_id) fail('SOURCE_FROZEN_CONFLICT');
  const result = { date: packet.date, channel: packet.channel, snapshotId: packet.snapshot_id,
    manifestHash: rows[0].server_hash, count: rows[0].message_count };
  log(JSON.stringify(result)); return result;
}

export const REPORT_QUERIES = [
  { database: PRIVATE_DB, sql: `SELECT id,date,channel,snapshot_id,created_at,expires_at,json_extract(manifest_json,'$.serverHash') AS server_hash,json_extract(manifest_json,'$.messageCount') AS message_count FROM diary_source_packets ORDER BY date,channel LIMIT ${ROW_LIMIT + 1}` },
  { database: PRIVATE_DB, sql: `SELECT id,event_type,date,grant_id,request_id,created_at,json_extract(metadata_json,'$.phase') AS phase,json_extract(metadata_json,'$.postId') AS post_id,json_extract(metadata_json,'$.requestHash') AS request_hash FROM diary_events ORDER BY created_at,id LIMIT ${ROW_LIMIT + 1}` },
  { database: SITE_DB, sql: `SELECT channel,date,registry_id,author_id,snapshot_id,source_manifest_id,source_hash,request_hash,state,post_id,created_at FROM ai_diary_registry ORDER BY date,channel LIMIT ${ROW_LIMIT + 1}` },
  { database: PRIVATE_DB, sql: 'SELECT (SELECT COUNT(*) FROM diary_source_packets) AS source_count,(SELECT COUNT(*) FROM diary_events) AS event_count' },
  { database: SITE_DB, sql: 'SELECT COUNT(*) AS registry_count FROM ai_diary_registry' },
];
const FIELDS = [
  ['id','date','channel','snapshot_id','created_at','expires_at','server_hash','message_count'],
  ['id','event_type','date','grant_id','request_id','created_at','phase','post_id','request_hash'],
  ['channel','date','registry_id','author_id','snapshot_id','source_manifest_id','source_hash','request_hash','state','post_id','created_at'],
];
const EVENTS = new Set(['SOURCE_READ','SKIPPED_EMPTY','MCP_PUBLISH_RECEIPT','SOURCE_FAILED','PUBLISH_FAILED',
  'CONFLICT','AUTH_REQUIRED','POST_DELETED','SOURCE_EMPTY','INVALID_MANIFEST','INVALID_DATE','DATE_OUT_OF_RANGE',
  'INVALID_CONTENT','INVALID_TITLE','INVALID_INPUT','AUTHOR_UNAVAILABLE','PUBLICATION_INTEGRITY_FAILED',
  'oauth_authorization_code','oauth_refresh_token','token_response_success','token_response_failure','oauth_operator_revoke','oauth_authorize_failure']);
export function buildReport(sets, now = Date.now()) {
  if (!Array.isArray(sets) || sets.length !== 5 || sets.some(set => !Array.isArray(set))
    || sets[3].length !== 1 || sets[4].length !== 1) fail('REPORT_SCHEMA_MISMATCH');
  const totals = { sources: sets[3][0].source_count, events: sets[3][0].event_count, registry: sets[4][0].registry_count };
  if (Object.values(totals).some(value => !Number.isSafeInteger(value) || value < 0)) fail('REPORT_SCHEMA_MISMATCH');
  const rows = sets.slice(0,3).map((set,index) => set.slice(0,ROW_LIMIT).map(row =>
    Object.fromEntries(FIELDS[index].map(key => [key,row[key] ?? null]))));
  for (const row of rows[1]) {
    if (!EVENTS.has(row.event_type)) row.event_type = 'UNKNOWN_EVENT';
    if (row.phase !== 'validated_exchange') row.phase = null;
  }
  const success = new Set(rows[1].filter(row => row.event_type === 'token_response_success').map(row => row.request_id));
  const paired = rows[1].filter(row => row.event_type === 'oauth_refresh_token' && row.phase === 'validated_exchange'
    && row.request_id && success.has(row.request_id)).length;
  return { schemaVersion: 1, status: 'UNVERIFIED', generatedAt: new Date(now).toISOString(), timeZone: 'Asia/Singapore',
    evidenceType: 'DATABASE_METADATA_ONLY', productionSite: true, counts: totals,
    completeness: { rowLimitPerTable: ROW_LIMIT, truncated: Object.fromEntries(Object.entries(totals).map(([key,value]) => [key,value > ROW_LIMIT])),
      transactionSnapshot: false },
    scheduledExecution: 'UNVERIFIED', computerOffline: 'UNVERIFIED', notificationDelivery: 'UNVERIFIED',
    refreshObservations: { pairedSuccessfulResponses: paired, provesScheduledRefresh: false },
    sources: rows[0], events: rows[1], registry: rows[2] };
}

export async function report(client, options, { log = console.log, now = Date.now() } = {}) {
  const out = await externalPath(options.out, { directory: true });
  const sets = [];
  for (const query of REPORT_QUERIES) sets.push(await client.query(query.database, query.sql));
  const data = buildReport(sets, now), filename = path.join(out, 'report.json');
  await privateFile(filename, `${JSON.stringify(data, null, 2)}\n`);
  log(JSON.stringify({ path: filename, status: 'UNVERIFIED', counts: data.counts, truncated: data.completeness.truncated }));
  return data;
}

export async function revokeAll(client, { fetcher = fetch, log = console.log, now = Date.now() } = {}) {
  const ticket = newTicket(now);
  await recordTicket(client, ticket);
  let response;
  try { response = await fetcher(`${ORIGIN}/operator/revoke`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${ticket.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) }); }
  catch { fail('REVOKE_REQUEST_FAILED'); }
  if (!response.ok) fail('REVOKE_REJECTED', response.status);
  const result = await boundedJson(response, 32768);
  if (!Number.isSafeInteger(result.revokedCount) || result.revokedCount < 0 || !Array.isArray(result.grantIds)
    || result.grantIds.length !== result.revokedCount || new Set(result.grantIds).size !== result.revokedCount
    || result.grantIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id))) fail('REVOKE_INVALID_RESPONSE');
  log(JSON.stringify({ revokedCount: result.revokedCount })); return result.revokedCount;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.command === 'help') {
    console.log('issue-ticket --remote --out <absolute private directory>\nstage-source --remote --input <absolute private JSON>\nreport --remote --out <absolute external directory>\nrevoke-all --remote\nOptional --oauth-config <absolute Wrangler OAuth config>. Credentials are never printed.'); return;
  }
  if (Number(process.versions.node.split('.')[0]) < 24) fail('NODE_VERSION');
  let config;
  try { config = parseConfig(await readFile(CONFIG, 'utf8')); } catch (error) {
    if (error instanceof OperationError) throw error; fail('INVALID_CONFIG');
  }
  validateConfiguration(config);
  const client = cloudflareClient(await managementToken(options));
  if (options.command === 'issue-ticket') return issueTicket(client, options);
  if (options.command === 'stage-source') return stageSource(client, options);
  if (options.command === 'report') return report(client, options);
  return revokeAll(client);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(error instanceof OperationError ? `${error.code}${error.status ? ` HTTP_${error.status}` : ''}` : 'OPERATION_FAILED');
    process.exitCode = 1;
  });
}
