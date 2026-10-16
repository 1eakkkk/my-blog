import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  operatorUrl, parseArguments, parseConfig, validateIsolation, revoke,
  parseD1Output, buildReport, reportMarkdown, REPORT_SQL, main
} from '../tools/operations.mjs';

const REMOTE = 'https://my-blog-diary-p0.zhou17749984708.workers.dev';
const LOCAL_REVOKE = 'http://127.0.0.1:8787/operator/revoke';
const config = origin => ({
  name: 'my-blog-diary-p0',
  vars: { PUBLIC_ORIGIN: origin, PROBE_ENVIRONMENT: 'synthetic-only' },
  d1_databases: [{ binding: 'DB', database_name: 'my-blog-diary-p0', database_id: '11111111-2222-3333-4444-555555555555' }],
  kv_namespaces: [{ binding: 'OAUTH_KV', id: '11111111222222223333333344444444' }]
});
const isCode = code => error => error.code === code;

test('默认和显式本地撤销永远固定127.0.0.1:8787，不读取远程PUBLIC_ORIGIN', () => {
  for (const configured of [REMOTE, 'https://attacker.invalid', 'http://localhost:9999', undefined]) {
    assert.equal(operatorUrl(config(configured)), LOCAL_REVOKE);
    assert.equal(operatorUrl(config(configured), false), LOCAL_REVOKE);
  }
  assert.equal(operatorUrl(undefined, false), LOCAL_REVOKE);
  assert.deepEqual(parseArguments(['revoke-all']), { command: 'revoke-all', remote: false });
  assert.deepEqual(parseArguments(['revoke-all', '--local']), { command: 'revoke-all', remote: false });
});

test('远程只接受本实验精确HTTPS origin，不接受其他workers账户、凭据、路径或端口', () => {
  assert.equal(operatorUrl(config(REMOTE), true), `${REMOTE}/operator/revoke`);
  assert.equal(operatorUrl(config(`${REMOTE}/`), true), `${REMOTE}/operator/revoke`);
  for (const origin of [
    'https://my-blog-diary-p0.attacker.workers.dev',
    'https://my-blog-diary-p0.zhou17749984708.workers.dev.attacker.invalid',
    'https://prefix.my-blog-diary-p0.zhou17749984708.workers.dev',
    REMOTE.replace('https:', 'http:'), `${REMOTE}:443`, `${REMOTE}:8443`,
    `${REMOTE}/path`, `${REMOTE}/path/..`, `${REMOTE}?token=hidden`, `${REMOTE}#hidden`,
    REMOTE.replace('https://', 'https://user:password@'), 'https://app.1eak.cool',
    'http://127.0.0.1:8787', undefined
  ]) assert.throws(() => operatorUrl(config(origin), true), error => ['INVALID_ORIGIN', 'ORIGIN_SCOPE_MISMATCH'].includes(error.code));
  assert.throws(() => operatorUrl(config(REMOTE), 'false'), isCode('INVALID_ARGUMENTS'));
});

test('未知命令、参数、重复参数和模式冲突均拒绝，帮助参数不能隐藏后续未知参数', async () => {
  const invalid = [
    ['drop-production'], ['revoke-all', '--url', 'https://attacker.invalid'],
    ['revoke-all', '--config', 'production.toml'], ['report', '--env', 'production'],
    ['revoke-all', '--token', 'secret'], ['revoke-all', '--remote', '--local'],
    ['revoke-all', '--remote', '--remote'], ['revoke', '--grant-id'],
    ['revoke', '--grant-id', 'one', '--grant-id', 'two'],
    ['--help', '--url', 'https://attacker.invalid'],
    ['revoke-all', '--help', '--unknown'], ['help', 'extra']
  ];
  for (const args of invalid) {
    assert.throws(() => parseArguments(args), error => ['INVALID_ARGUMENTS', 'UNKNOWN_COMMAND'].includes(error.code));
    // Parsing fails before config reads, D1 execution or credential generation.
    await assert.rejects(main(args), error => ['INVALID_ARGUMENTS', 'UNKNOWN_COMMAND'].includes(error.code));
  }
  assert.deepEqual(parseArguments(['revoke-all', '--help']), { command: 'help', remote: false });
});

test('操作前隔离资源检查拒绝生产名称、R2、多DB/环境和远程占位资源', () => {
  assert.equal(validateIsolation(config(REMOTE), true).name, 'my-blog-diary-p0');
  const variants = [
    { ...config(REMOTE), name: 'my-blog' },
    { ...config(REMOTE), r2_buckets: [{ binding: 'BUCKET' }] },
    { ...config(REMOTE), env: { production: {} } },
    { ...config(REMOTE), d1_databases: [...config(REMOTE).d1_databases, ...config(REMOTE).d1_databases] }
  ];
  for (const value of variants) assert.throws(() => validateIsolation(value, true), isCode('ISOLATION_REQUIRED'));
  const placeholder = config(REMOTE);
  placeholder.d1_databases[0].database_id = '00000000-0000-0000-0000-000000000000';
  assert.throws(() => validateIsolation(placeholder, true), isCode('PLACEHOLDER_BINDINGS'));
});

test('本地撤销票据只送固定endpoint，D1只存摘要，成功输出不回显正文/票据/服务器额外字段', async () => {
  const sqls = [], calls = [], logs = [];
  const secretBody = 'SYNTHETIC_PRIVATE_BODY_DO_NOT_REPORT';
  let token;
  await revoke(config(REMOTE), { command: 'revoke', remote: false, 'grant-id': 'grant-test' }, {
    executeD1: async (sql, remote) => { sqls.push(sql); assert.equal(remote, false); },
    fetcher: async (url, options) => {
      calls.push(url); assert.equal(url, LOCAL_REVOKE);
      assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.method, 'POST'); assert.deepEqual(JSON.parse(options.body), { grantId: 'grant-test' });
      token = options.headers.Authorization.slice('Bearer '.length);
      return Response.json({ revokedCount: 1, grantIds: ['grant-test'], token, content: secretBody });
    }, log: value => logs.push(value)
  });
  assert.equal(calls.length, 1); assert.equal(sqls.length, 1);
  assert.ok(!sqls[0].includes(token));
  assert.ok(sqls[0].includes(createHash('sha256').update(token).digest('hex')));
  assert.deepEqual(logs.map(JSON.parse), [{ scope: 'LOCAL', revokedCount: 1 }]);
  assert.ok(!logs.join('').includes(token)); assert.ok(!logs.join('').includes(secretBody));
});

test('错误远程origin或无效grant在写票据/发请求前被拒绝', async () => {
  let actions = 0;
  const dependencies = {
    executeD1: async () => { actions++; }, fetcher: async () => { actions++; }, log: () => { actions++; }
  };
  await assert.rejects(revoke(config('https://my-blog-diary-p0.attacker.workers.dev'),
    { command: 'revoke-all', remote: true }, dependencies), isCode('ORIGIN_SCOPE_MISMATCH'));
  for (const id of ['access:token', 'grant id', 'x'.repeat(129), undefined]) {
    await assert.rejects(revoke(config(REMOTE), { command: 'revoke', remote: false, 'grant-id': id }, dependencies), isCode('INVALID_GRANT_ID'));
  }
  assert.equal(actions, 0);
});

test('撤销请求禁止跳转，3xx或带敏感内容的网络错误不回显原始响应/票据', async () => {
  for (const networkError of [false, true]) {
    const calls = [], logs = []; let token;
    await assert.rejects(revoke(config(REMOTE), { command: 'revoke-all', remote: true }, {
      executeD1: async () => {},
      fetcher: async (url, options) => {
        calls.push(url); token = options.headers.Authorization;
        assert.equal(options.redirect, 'error');
        if (networkError) throw new Error(`Synthetic raw network failure ${token}`);
        return new Response(`Synthetic secret ${token}`, { status: 302, headers: { Location: 'https://attacker.invalid' } });
      }, log: value => logs.push(value)
    }), error => {
      assert.ok(!error.message.includes(token));
      return error.code === (networkError ? 'REVOKE_REQUEST_FAILED' : 'REVOKE_REJECTED');
    });
    assert.deepEqual(calls, [`${REMOTE}/operator/revoke`]); assert.deepEqual(logs, []);
  }
});

test('撤销成功响应必须确认数量及指定grant，不能把其他目标当作成功', async () => {
  for (const result of [
    { revokedCount: 1, grantIds: ['another-grant'] },
    { revokedCount: 1, grantIds: [null] },
    { revokedCount: 2, grantIds: ['grant-test'] },
    { revokedCount: -1, grantIds: [] },
    { revokedCount: 1, grantIds: ['x'.repeat(129)] }
  ]) {
    const logs = [];
    await assert.rejects(revoke(config(REMOTE), { command: 'revoke', remote: false, 'grant-id': 'grant-test' }, {
      executeD1: async () => {}, fetcher: async () => Response.json(result), log: value => logs.push(value)
    }), isCode('REVOKE_INVALID_RESPONSE'));
    assert.deepEqual(logs, []);
  }
});

test('D1失败或非JSON响应隐藏原始正文/Token，不输出原始服务错误', () => {
  const secret = 'SYNTHETIC_RAW_TOKEN_DO_NOT_LOG';
  for (const stdout of [secret, JSON.stringify({ success: false, error: secret }), JSON.stringify({ success: true, unknown: secret })]) {
    assert.throws(() => parseD1Output(stdout), error => {
      assert.ok(!error.message.includes(secret)); return error.code.startsWith('D1_');
    });
  }
  assert.deepEqual(parseD1Output(JSON.stringify([{ success: true, results: [] }])), [[]]);
});

function reportSets(secret) {
  return [
    [{ channel: 'diary-p0', date: '2026-10-13', registry_id: 'registry-test', snapshot_id: 'snapshot-test',
      source_manifest_id: 'manifest-test', request_hash: 'a'.repeat(64), state: 'PUBLISHED', post_id: 1, created_at: 1000,
      request_content: secret, content: secret, token: secret }],
    [{ id: 'manifest-test', date: '2026-10-13', snapshot_id: 'snapshot-test', version: 1,
      server_hash: 'b'.repeat(64), message_count: 3, synthetic: 1, created_at: 1000, messages_json: secret }],
    [
      { id: 1, event_type: 'oauth_refresh_token', request_id: 'paired', phase: 'validated_exchange', created_at: 1000, metadata_json: secret, access_token: secret },
      { id: 2, event_type: 'token_response_success', request_id: 'paired', phase: null, created_at: 1001, refresh_token: secret },
      { id: 3, event_type: 'oauth_refresh_token', request_id: 'unpaired', phase: 'validated_exchange', created_at: 1002 },
      { id: 4, event_type: 'mcp_call', request_id: 'report-test', phase: { rawToken: secret }, created_at: 1003 },
      { id: 5, event_type: 'mcp_call', request_id: 'report-test-json', phase: JSON.stringify({ content: secret }), created_at: 1004 }
    ],
    [{ registry_count: 1, source_count: 1, event_count: 5 }]
  ];
}

test('元数据报告剔除正文/素材/凭据及原始phase，刷新配对不冒充真实任务验收', () => {
  const secret = 'SYNTHETIC_CHAT_OR_TOKEN_DO_NOT_REPORT';
  const report = buildReport(reportSets(secret), false, Date.parse('2026-10-14T00:00:00+08:00'));
  const json = JSON.stringify(report), markdown = reportMarkdown(report);
  assert.ok(!json.includes(secret)); assert.ok(!markdown.includes(secret));
  assert.equal(report.events[3].phase, null); assert.equal(report.events[4].phase, null);
  assert.equal(report.status, 'UNVERIFIED'); assert.equal(report.syntheticOnly, true);
  assert.ok(Object.values(report.realTaskChecks).every(value => value === 'UNVERIFIED'));
  assert.equal(report.oauthRefreshObservations.validatedExchangeCount, 2);
  assert.equal(report.oauthRefreshObservations.matchedSuccessfulTokenResponseCount, 1);
  assert.equal(report.oauthRefreshObservations.provesScheduledRefresh, false);
  assert.doesNotMatch(REPORT_SQL.join('\n'), /\b(request_content|messages_json|access_token|refresh_token|token_hash|auth_tickets)\b/);
});

test('JSONC地址字符串完整保留，配置错误不回显原始敏感内容', () => {
  assert.equal(parseConfig(`{ // comment\n "vars": {"PUBLIC_ORIGIN":"${REMOTE}"}, /* comment */ }`).vars.PUBLIC_ORIGIN, REMOTE);
  const secret = 'SYNTHETIC_PRIVATE_CONFIGURATION';
  assert.throws(() => parseConfig(`{"secret":"${secret}",`), error => {
    assert.ok(!error.message.includes(secret)); return error.code === 'INVALID_CONFIG';
  });
});
