#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, mkdir, open, rename, unlink, chmod, lstat, realpath, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const PROJECT = fileURLToPath(new URL('../', import.meta.url));
const CONFIG = path.join(PROJECT, 'wrangler.jsonc');
const WRANGLER = path.join(PROJECT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const SECRETS = path.join(PROJECT, '.secrets');
const NAME = 'my-blog-diary-p0';
const LOCAL_ORIGIN = 'http://127.0.0.1:8787';
const REMOTE_ORIGIN = 'https://my-blog-diary-p0.zhou17749984708.workers.dev';
const AUTHOR = 'AI 日记（隔离测试）';
const CHANNEL = 'diary-p0';
const TASK = '6acdfb952ee08191b12eaf699e9323f0';
const ROW_LIMIT = 2000;

class OperationError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function fail(code, message) { throw new OperationError(code, message); }

// Preserve strings while stripping JSONC comments and trailing commas.
export function parseConfig(source) {
  let clean = '', quoted = false, escaped = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i], next = source[i + 1];
    if (quoted) {
      clean += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') { quoted = true; clean += c; }
    else if (c === '/' && next === '/') {
      clean += ' '; i++;
      while (i + 1 < source.length && source[i + 1] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      clean += ' '; i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') clean += '\n';
        i++;
      }
      if (i >= source.length) fail('INVALID_CONFIG', '实验配置存在未结束的注释。');
      i++;
    } else clean += c;
  }
  let json = ''; quoted = false; escaped = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      json += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') { quoted = true; json += c; }
    else if (c === ',') {
      let j = i + 1;
      while (/\s/.test(clean[j] || '') && j < clean.length) j++;
      if (!['}', ']'].includes(clean[j])) json += c;
    } else json += c;
  }
  try { return JSON.parse(json); }
  catch { fail('INVALID_CONFIG', '无法读取实验 wrangler.jsonc。'); }
}

export function validateIsolation(config, remote = false) {
  const db = config?.d1_databases?.[0], kv = config?.kv_namespaces?.[0];
  if (config?.name !== NAME || config?.vars?.PROBE_ENVIRONMENT !== 'synthetic-only'
      || config?.d1_databases?.length !== 1 || db?.binding !== 'DB' || db?.database_name !== NAME
      || config?.kv_namespaces?.length !== 1 || kv?.binding !== 'OAUTH_KV'
      || config?.r2_buckets?.length || Object.keys(config?.env || {}).length) {
    fail('ISOLATION_REQUIRED', '仅允许本项目的独立 synthetic Worker、DB、OAUTH_KV 配置。');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(db.database_id || '')
      || !/^[0-9a-f]{32}$/i.test(kv.id || '')) fail('INVALID_BINDINGS', '实验资源 ID 格式无效。');
  if (remote && (/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(db.database_id) || /^0{32}$/.test(kv.id))) {
    fail('PLACEHOLDER_BINDINGS', '占位资源 ID 禁止远程操作；先核对独立实验资源。');
  }
  return config;
}

export function parseArguments(argv) {
  const [first = 'help', ...args] = argv;
  let wantsHelp = ['--help', '-h'].includes(first);
  const command = wantsHelp ? 'help' : first;
  const allowed = {
    'issue-ticket': [], report: ['out'], 'revoke-all': [], revoke: ['grant-id'],
    'delete-test': ['post-id'], 'edit-test': ['post-id', 'content-file'], help: [],
  };
  if (!Object.hasOwn(allowed, command)) fail('UNKNOWN_COMMAND', '未知操作；使用 help 查看命令。');
  const options = { command, remote: false };
  let mode;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help' || flag === '-h') {
      if (wantsHelp) fail('INVALID_ARGUMENTS', '帮助参数不能重复。');
      wantsHelp = true; continue;
    }
    if (['--local', '--remote'].includes(flag)) {
      if (mode) fail('INVALID_ARGUMENTS', '只能指定一次 --local 或 --remote。');
      mode = flag; options.remote = flag === '--remote'; continue;
    }
    const key = flag.startsWith('--') ? flag.slice(2) : '';
    if (!allowed[command].includes(key) || Object.hasOwn(options, key)
        || !args[i + 1] || args[i + 1].startsWith('--')) fail('INVALID_ARGUMENTS', '参数缺失、重复或不受支持。');
    options[key] = args[++i];
  }
  return wantsHelp ? { command: 'help', remote: false } : options;
}

export function postId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    fail('INVALID_POST_ID', '--post-id 必须是正整数测试日记 ID。');
  }
  return Number(value);
}

export function parseD1Output(stdout) {
  let value;
  try { value = JSON.parse(stdout.trim()); }
  catch { fail('D1_INVALID_JSON', 'Wrangler 未返回有效 JSON；原始输出已隐藏。'); }
  const sets = [];
  const visit = item => {
    if (Array.isArray(item)) { if (!item.length) fail('D1_EMPTY_RESULT', 'D1 未返回执行结果。'); item.forEach(visit); return; }
    if (!item || typeof item !== 'object' || item.success === false || item.error
        || (Array.isArray(item.errors) && item.errors.length)) fail('D1_EXECUTION_FAILED', 'D1 执行失败；原始错误已隐藏。');
    if (Array.isArray(item.results)) {
      if (item.success !== true) fail('D1_UNCONFIRMED', 'D1 执行状态未确认。');
      sets.push(item.results);
    } else if (Array.isArray(item.result)) visit(item.result);
    else fail('D1_UNKNOWN_RESULT', 'D1 返回结构未识别。');
  };
  visit(value);
  return sets;
}

async function secureDirectory() {
  await mkdir(SECRETS, { recursive: true, mode: 0o700 });
  const stat = await lstat(SECRETS);
  if (!stat.isDirectory() || stat.isSymbolicLink()
      || path.resolve(await realpath(SECRETS)).toLowerCase() !== path.join(await realpath(PROJECT), '.secrets').toLowerCase()) {
    fail('UNSAFE_SECRET_DIRECTORY', '.secrets 必须是本实验目录内的真实目录。');
  }
  await chmod(SECRETS, 0o700);
}

async function privateFile(filename, value) {
  const handle = await open(filename, 'wx', 0o600);
  try { await handle.writeFile(value, 'utf8'); await handle.sync(); }
  finally { await handle.close(); }
}

async function d1(sql, remote, { privateSql = false } = {}) {
  const args = ['d1', 'execute', 'DB', '--config', CONFIG, remote ? '--remote' : '--local', '--json'];
  let temporary;
  try {
    if (privateSql) {
      await secureDirectory();
      temporary = path.join(SECRETS, `query-${randomUUID()}.sql`);
      await privateFile(temporary, sql);
      args.push('--file', temporary);
    } else args.push('--command', sql);
    let stdout;
    try {
      ({ stdout } = await execFileAsync(process.execPath, [WRANGLER, ...args], {
        cwd: PROJECT, shell: false, windowsHide: true, encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024, timeout: 120000,
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' },
      }));
    } catch { fail('WRANGLER_FAILED', 'Wrangler 执行未成功；命令正文和原始输出已隐藏。'); }
    return parseD1Output(stdout);
  } finally { if (temporary) await unlink(temporary).catch(() => {}); }
}

export function newTicket(now = Date.now()) {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: createHash('sha256').update(token).digest('hex'), expiresAt: now + 600000 };
}
export function ticketSql(ticket) {
  if (!/^[0-9a-f]{64}$/.test(ticket.hash) || !Number.isSafeInteger(ticket.expiresAt)) fail('INVALID_TICKET', '票据记录无效。');
  return `INSERT INTO auth_tickets (token_hash,expires_at,consumed_at) VALUES ('${ticket.hash}',${ticket.expiresAt},NULL);`;
}

async function issueTicket(remote) {
  await secureDirectory();
  const ticket = newTicket(), target = path.join(SECRETS, 'ticket.txt');
  const temporary = path.join(SECRETS, `ticket-${randomUUID()}.tmp`);
  try {
    await privateFile(temporary, `${ticket.token}\n`);
    await d1(ticketSql(ticket), remote);
    await rename(temporary, target);
    await chmod(target, 0o600);
    console.log(JSON.stringify({ path: target, expires_at: ticket.expiresAt, expires_at_iso: new Date(ticket.expiresAt).toISOString() }));
  } finally { await unlink(temporary).catch(() => {}); }
}

export function operatorUrl(config, remote = false) {
  if (typeof remote !== 'boolean') fail('INVALID_ARGUMENTS', '撤销模式必须明确为本地或远程。');
  // PUBLIC_ORIGIN is the deployed OAuth origin and must never redirect local
  // operator credentials away from this fixed development endpoint.
  if (!remote) return `${LOCAL_ORIGIN}/operator/revoke`;
  const configured = config?.vars?.PUBLIC_ORIGIN;
  let origin;
  try {
    if (typeof configured !== 'string') throw new TypeError();
    origin = new URL(configured);
  }
  catch { fail('INVALID_ORIGIN', 'PUBLIC_ORIGIN 必须是实验服务的完整 origin。'); }
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
    fail('INVALID_ORIGIN', 'PUBLIC_ORIGIN 不能包含路径、参数或凭据。');
  }
  if (origin.origin !== REMOTE_ORIGIN || ![REMOTE_ORIGIN, `${REMOTE_ORIGIN}/`].includes(configured)) {
    fail('ORIGIN_SCOPE_MISMATCH', '远程撤销只允许本实验固定的 HTTPS workers.dev origin。');
  }
  return `${REMOTE_ORIGIN}/operator/revoke`;
}

export async function revoke(config, options, { executeD1 = d1, fetcher = fetch, log = console.log } = {}) {
  const url = operatorUrl(config, options.remote);
  const all = options.command === 'revoke-all';
  if (!all && !/^[A-Za-z0-9_-]{1,128}$/.test(options['grant-id'] || '')) {
    fail('INVALID_GRANT_ID', 'revoke 需要 --grant-id；不接受 access 或 refresh token。');
  }
  const ticket = newTicket(); // Memory only: never write an operator ticket to disk.
  await executeD1(ticketSql(ticket), options.remote);
  let response;
  try {
    response = await fetcher(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${ticket.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(all ? { all: true } : { grantId: options['grant-id'] }),
    });
  } catch { fail('REVOKE_REQUEST_FAILED', '撤销请求未确认完成；未跟随重定向，票据不会输出。'); }
  if (!response.ok) fail('REVOKE_REJECTED', `撤销服务拒绝请求（HTTP ${response.status}）；不视为已撤销。`);
  let text = '';
  if (!response.body) fail('REVOKE_INVALID_RESPONSE', '撤销响应为空。');
  const reader = response.body.getReader(), chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 32768) { await reader.cancel(); fail('REVOKE_INVALID_RESPONSE', '撤销响应超出限制。'); }
      chunks.push(value);
    }
    text = Buffer.concat(chunks).toString('utf8');
  } catch (error) {
    if (error instanceof OperationError) throw error;
    fail('REVOKE_INVALID_RESPONSE', '撤销响应未完整收到。');
  } finally { reader.releaseLock(); }
  let result;
  try { result = JSON.parse(text); }
  catch { fail('REVOKE_INVALID_RESPONSE', '撤销响应无法核对。'); }
  if (!Number.isSafeInteger(result?.revokedCount) || result.revokedCount < 0 || !Array.isArray(result.grantIds)
      || result.grantIds.length !== result.revokedCount || !result.grantIds.every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id))
      || (!all && (result.revokedCount > 1 || result.grantIds.some(id => id !== options['grant-id'])))) {
    fail('REVOKE_INVALID_RESPONSE', '撤销数量或目标未确认。');
  }
  log(JSON.stringify({ scope: options.remote ? 'REMOTE' : 'LOCAL', revokedCount: result.revokedCount }));
}

function literal(value) { return `'${value.replaceAll("'", "''")}'`; }
export function editSql(id, content) {
  postId(String(id));
  if (typeof content !== 'string' || !content.trim() || content.includes('\0')
      || content.length > 50000 || Buffer.byteLength(content) > 200000) fail('INVALID_CONTENT', 'synthetic 修改正文必须非空且不超过 50000 字符。');
  return `UPDATE probe_diaries SET content=${literal(content)} WHERE id=${id} AND channel='${CHANNEL}' AND author=${literal(AUTHOR)} RETURNING id,date;`;
}
export function deleteSql(id) {
  postId(String(id));
  return `DELETE FROM probe_diaries WHERE id=${id} AND channel='${CHANNEL}' AND author=${literal(AUTHOR)} RETURNING id,date;`;
}
async function modifyTest(options) {
  const id = postId(options['post-id']);
  const before = (await d1(`SELECT registry_id,channel,date,state,post_id,request_hash,created_at FROM ai_diary_registry WHERE post_id=${id} AND channel='${CHANNEL}';`, options.remote))[0];
  if (before.length !== 1 || before[0].state !== 'PUBLISHED') fail('TEST_DIARY_NOT_FOUND', '只允许修改已登记的隔离测试日记。');
  let sql;
  if (options.command === 'edit-test') {
    if (!options['content-file']) fail('CONTENT_FILE_REQUIRED', 'edit-test 需要 --content-file，文件只能包含 synthetic 测试正文。');
    let content;
    try {
      const filename = path.resolve(options['content-file']), stat = await lstat(filename);
      if (!stat.isFile() || stat.size > 200000) fail('INVALID_CONTENT_FILE', '正文文件必须为不超过 200000 字节的普通文件。');
      content = await readFile(filename, 'utf8');
    } catch (error) {
      if (error instanceof OperationError) throw error;
      fail('CONTENT_FILE_UNREADABLE', '无法读取 synthetic 正文文件。');
    }
    sql = editSql(id, content);
  } else sql = deleteSql(id);
  const changed = (await d1(sql, options.remote, { privateSql: options.command === 'edit-test' }))[0];
  const after = (await d1(`SELECT registry_id,channel,date,state,post_id,request_hash,created_at FROM ai_diary_registry WHERE post_id=${id} AND channel='${CHANNEL}';`, options.remote))[0];
  if (JSON.stringify(before) !== JSON.stringify(after)) fail('REGISTRY_CHANGED', '永久日期登记核对失败，停止后续操作。');
  if (changed.length !== 1 || changed[0].id !== id) fail('TEST_DIARY_NOT_FOUND', '未修改任何匹配的隔离测试日记，日期登记保留。');
  console.log(JSON.stringify({ scope: options.remote ? 'REMOTE' : 'LOCAL', operation: options.command, postId: id, changed: 1, registryPreserved: true }));
}

export const REPORT_SQL = [
  `SELECT channel,date,registry_id,snapshot_id,source_manifest_id,request_hash,state,post_id,created_at FROM ai_diary_registry ORDER BY date,registry_id LIMIT ${ROW_LIMIT + 1};`,
  `SELECT id,date,snapshot_id,version,server_hash,message_count,synthetic,created_at FROM probe_source_manifests ORDER BY date,id LIMIT ${ROW_LIMIT + 1};`,
  `SELECT id,event_type,date,grant_id,request_id,created_at,json_extract(metadata_json,'$.phase') AS phase FROM probe_events ORDER BY created_at,id LIMIT ${ROW_LIMIT + 1};`,
  'SELECT (SELECT COUNT(*) FROM ai_diary_registry) AS registry_count,(SELECT COUNT(*) FROM probe_source_manifests) AS source_count,(SELECT COUNT(*) FROM probe_events) AS event_count;',
];
const REPORT_FIELDS = [
  ['channel', 'date', 'registry_id', 'snapshot_id', 'source_manifest_id', 'request_hash', 'state', 'post_id', 'created_at'],
  ['id', 'date', 'snapshot_id', 'version', 'server_hash', 'message_count', 'synthetic', 'created_at'],
  ['id', 'event_type', 'date', 'grant_id', 'request_id', 'created_at', 'phase'],
];
export function buildReport(sets, remote, now = Date.now()) {
  if (sets.length !== 4 || sets[3].length !== 1) fail('REPORT_SCHEMA_MISMATCH', '报告查询结果不完整。');
  const rows = sets.slice(0, 3).map((list, i) => list.slice(0, ROW_LIMIT).map(row =>
    Object.fromEntries(REPORT_FIELDS[i].map(key => [key, row[key] ?? null]))));
  // Phase is a known audit marker, never a channel for raw metadata or secrets.
  for (const row of rows[2]) if (row.phase !== 'validated_exchange') row.phase = null;
  const totals = sets[3][0];
  for (const key of ['registry_count', 'source_count', 'event_count']) {
    if (!Number.isSafeInteger(totals[key]) || totals[key] < 0) fail('REPORT_SCHEMA_MISMATCH', '报告计数无效。');
  }
  const exchanges = rows[2].filter(row => row.event_type === 'oauth_refresh_token' && row.phase === 'validated_exchange');
  const responses = new Set(rows[2].filter(row => row.event_type === 'token_response_success' && row.request_id).map(row => row.request_id));
  const paired = exchanges.filter(row => row.request_id && responses.has(row.request_id)).length;
  return {
    schemaVersion: 1, status: 'UNVERIFIED', syntheticOnly: true,
    generatedAt: new Date(now).toISOString(), taskId: TASK, timeZone: 'Asia/Singapore',
    serviceEvidence: { scope: remote ? 'REMOTE' : 'LOCAL', type: 'DATABASE_METADATA',
      note: '数据库、普通 HTTP 或 MCP 调用记录不能单独证明 ChatGPT 云任务运行。',
      httpAndMcpChecks: { scope: remote ? 'REMOTE' : 'LOCAL', status: 'UNVERIFIED' } },
    realTaskChecks: Object.fromEntries(['consecutiveMidnightOne', 'consecutiveMidnightTwo', 'computerOffline',
      'scheduledOAuthRefresh', 'authorizationRevocation', 'anomalyNotificationDelivery'].map(key => [key, 'UNVERIFIED'])),
    completeness: { rowLimitPerTable: ROW_LIMIT,
      truncated: { registry: totals.registry_count > ROW_LIMIT, sources: totals.source_count > ROW_LIMIT, events: totals.event_count > ROW_LIMIT },
      snapshot: '多个只读语句的观察结果；活跃写入可能发生于语句之间，不是事务一致性证明。' },
    counts: { registry: totals.registry_count, sources: totals.source_count, events: totals.event_count },
    oauthRefreshObservations: { scope: remote ? 'REMOTE' : 'LOCAL', validatedExchangeCount: exchanges.length,
      matchedSuccessfulTokenResponseCount: paired, provesScheduledRefresh: false,
      note: 'validated_exchange 不等于 token 已返回；只有相同 request_id 的 token_response_success 才形成服务端配对。仍需外部 task run 证据。' },
    registry: rows[0], sources: rows[1], events: rows[2],
  };
}
function cell(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('|', '\\|').replace(/[\r\n]/g, ' ');
}
export function reportMarkdown(report) {
  const table = (title, rows, fields) => [
    `## ${title}`, '', `| ${fields.join(' | ')} |`, `| ${fields.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${fields.map(key => cell(row[key])).join(' | ')} |`), '',
  ].join('\n');
  return ['# AI 日记 P0 · 脱敏元数据报告', '', '**状态：UNVERIFIED**', '',
    `生成时间：${report.generatedAt}；来源：${report.serviceEvidence.scope} 独立实验数据库；仅 synthetic。`, '',
    'ChatGPT 连续两次真实午夜、电脑离线、定时刷新、授权撤销和异常通知实际送达均为 UNVERIFIED。普通 HTTP / MCP 或数据库观察不能替代这些证据。', '',
    `服务端刷新观察：validated_exchange ${report.oauthRefreshObservations.validatedExchangeCount} 次；相同 request_id 的成功 token 返回配对 ${report.oauthRefreshObservations.matchedSuccessfulTokenResponseCount} 次。这不是云任务运行证明。`, '',
    `计数：registry ${report.counts.registry}，sources ${report.counts.sources}，events ${report.counts.events}。每表最多列出 ${ROW_LIMIT} 行；截断：${cell(JSON.stringify(report.completeness.truncated))}。活跃写入时不是事务快照。`, '',
    table('日期登记（不含正文）', report.registry, ['date', 'state', 'post_id', 'registry_id', 'created_at']),
    table('来源清单（不含素材）', report.sources, ['date', 'message_count', 'synthetic', 'snapshot_id', 'created_at']),
    table('事件（不含原始日志或凭据）', report.events, ['id', 'event_type', 'date', 'request_id', 'phase', 'created_at']),
  ].join('\n');
}
async function report(options) {
  if (!options.out) fail('OUTPUT_REQUIRED', 'report 需要 --out <新的输出目录>。');
  const directory = path.resolve(options.out);
  const data = buildReport(await d1(REPORT_SQL.join('\n'), options.remote), options.remote);
  await mkdir(directory, { recursive: true });
  const json = path.join(directory, 'report.json'), markdown = path.join(directory, 'report.md');
  // Exclusive creation prevents overwriting previous evidence.
  await privateFile(json, `${JSON.stringify(data, null, 2)}\n`);
  await privateFile(markdown, reportMarkdown(data));
  console.log(JSON.stringify({ scope: options.remote ? 'REMOTE' : 'LOCAL', status: 'UNVERIFIED', json, markdown }));
}

function help() {
  console.log(`AI 日记 P0 管理命令（Node.js 24，仅独立 synthetic 实验）
默认 --local；只有显式 --remote 且已核对独立资源 ID 才操作远程。
本地撤销固定为 http://127.0.0.1:8787；远程撤销只接受本实验固定的 HTTPS origin。

node tools/operations.mjs issue-ticket [--local | --remote]
  10 分钟一次性票据写入 .secrets/ticket.txt（0600），只输出路径与期限。
node tools/operations.mjs report --out <新的目录> [--local | --remote]
  输出 Markdown 与 JSON 元数据；真实定时等验收默认 UNVERIFIED。
node tools/operations.mjs revoke-all [--local | --remote]
node tools/operations.mjs revoke --grant-id <grantId> [--local | --remote]
  用仅在内存中的一次性票据调用 /operator/revoke；通过官方 provider 撤销，绝不直接删除 KV。
node tools/operations.mjs delete-test --post-id <正整数> [--local | --remote]
  只物理删除 probe_diaries，永久日期登记必须保持。
node tools/operations.mjs edit-test --post-id <正整数> --content-file <synthetic文本文件> [--local | --remote]
  只改测试日记 content，不打印正文；日期登记必须保持。

资源配置固定为本目录 wrangler.jsonc；不支持 --config、--env 或作者/表名覆盖。
Windows 的真实文件访问权限还需管理员限制 .secrets 目录 ACL。
不要把普通 HTTP/MCP 调用成功写成 ChatGPT 真实午夜或离线执行通过。`);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.command === 'help') { help(); return; }
  if (Number(process.versions.node.split('.')[0]) < 24) fail('NODE_VERSION', '需要 Node.js 24 或更新版本。');
  let config;
  try { config = parseConfig(await readFile(CONFIG, 'utf8')); await access(WRANGLER); }
  catch (error) {
    if (error instanceof OperationError) throw error;
    fail('SETUP_REQUIRED', '先安装本实验依赖，并确认 wrangler.jsonc 存在。');
  }
  validateIsolation(config, options.remote);
  if (options.command === 'issue-ticket') await issueTicket(options.remote);
  else if (options.command === 'report') await report(options);
  else if (options.command === 'revoke' || options.command === 'revoke-all') await revoke(config, options);
  else await modifyTest(options);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(error instanceof OperationError ? `${error.code}: ${error.message}` : 'OPERATION_FAILED: 操作未确认完成；原始错误已隐藏。');
    process.exitCode = 1;
  });
}
