import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseArguments, validateConfiguration, externalPath, cloudflareClient, issueTicket, stageSource,
  buildReport, revokeAll, managementToken, PRIVATE_DB, SITE_DB, ACCOUNT, ORIGIN, ROW_LIMIT } from '../tools/operations.mjs';

const REPOSITORY = fileURLToPath(new URL('../../../', import.meta.url));
const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-10-15T08:00:00+08:00');
async function temporary(t) {
  const base = await realpath(os.tmpdir()), directory = await mkdtemp(path.join(base, 'ai-diary-ops-test-'));
  t.after(async () => {
    const absolute = path.resolve(directory);
    if (path.dirname(absolute) !== base || !path.basename(absolute).startsWith('ai-diary-ops-test-')) throw new Error('Unsafe cleanup target');
    await rm(absolute, { recursive: true, force: true });
  });
  return directory;
}

test('operator requires explicit remote and exact production/private resource boundary', () => {
  for (const args of [['issue-ticket','--out','C:\\private'],['stage-source','--remote'],['report','--remote','--out','x','--remote'],
    ['revoke-all','--remote','--config','other'],['issue-ticket','--remote','--out','x','--local']]) {
    assert.throws(() => parseArguments(args));
  }
  assert.equal(parseArguments(['report','--remote','--out','C:\\private']).remote, true);
  assert.equal(validateConfiguration(config), config);
  for (const change of [draft => { draft.account_id = 'foreign'; }, draft => { draft.vars.AI_AUTHOR_ID = '1'; },
    draft => { draft.d1_databases[0].database_id = SITE_DB; },
    draft => { draft.d1_databases[0].database_id = 'da72d1a2-9a81-4c8c-98c5-1b82ad30a9ac'; },
    draft => { draft.kv_namespaces[0].id = '2e3231a294d944cba76bddb738018ce8'; }]) {
    const draft = structuredClone(config); change(draft);
    assert.throws(() => validateConfiguration(draft), error => error.code === 'CONFIGURATION_SCOPE_MISMATCH');
  }
});

test('private files need absolute external paths including through junctions', async t => {
  const directory = await temporary(t);
  await assert.rejects(externalPath('relative'), error => error.code === 'ABSOLUTE_PRIVATE_PATH_REQUIRED');
  await assert.rejects(externalPath(path.join(REPOSITORY,'operator-must-not-create'), { directory: true }), error => error.code === 'PRIVATE_PATH_INSIDE_REPOSITORY');
  const link = path.join(directory,'repo-link'); await symlink(REPOSITORY,link,process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(externalPath(path.join(link,'operator-must-not-create'),{ directory: true }), error => error.code === 'PRIVATE_PATH_INSIDE_REPOSITORY');
  const safe = path.join(directory,'private'); assert.equal(await externalPath(safe,{ directory: true }),safe);
});

test('management API uses fixed endpoints and bound params while hiding rejected remote bodies', async () => {
  const secret = 'private-management-token-sentinel', requests = [];
  const client = cloudflareClient(secret, { fetcher: async (url,options) => {
    requests.push({url,options}); return Response.json({ success: true, result: [{ success: true, results: [{ok:1}] }] });
  } });
  assert.deepEqual(await client.query(PRIVATE_DB,'INSERT INTO auth_tickets VALUES (?,?,NULL)',['hash',123]),[{ok:1}]);
  assert.equal(requests[0].url,`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${PRIVATE_DB}/query`);
  assert.deepEqual(JSON.parse(requests[0].options.body).params,['hash',123]); assert.equal(requests[0].options.redirect,'error');
  await assert.rejects(client.query(SITE_DB,'DELETE FROM posts'), error => error.code === 'DATABASE_SCOPE_MISMATCH');
  await assert.rejects(client.query(SITE_DB,'SELECT 1; DELETE FROM posts'), error => error.code === 'DATABASE_SCOPE_MISMATCH');
  const denied = cloudflareClient(secret,{ fetcher: async () => new Response(secret,{status:401}) });
  await assert.rejects(denied.query(PRIVATE_DB,'SELECT 1'), error => error.code === 'AUTH_REQUIRED' && !error.message.includes(secret));
  assert.equal(await managementToken({}, { CLOUDFLARE_API_TOKEN: secret }),secret);
});

test('issue-ticket only writes plaintext to requested private file; database and stdout contain no token', async t => {
  const directory = await temporary(t), calls = [], logs = [];
  const result = await issueTicket({ async query(...args) { calls.push(args); return []; } }, {out:directory}, {now:NOW,log:value=>logs.push(value)});
  const token = (await readFile(result.path,'utf8')).trim(); assert.match(token,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.expiresAt,NOW+600000); assert.equal(calls[0][0],PRIVATE_DB);
  assert.deepEqual(calls[0][2],[createHash('sha256').update(token).digest('hex'),NOW+600000]);
  assert.ok(!JSON.stringify(calls).includes(token)); assert.ok(!logs.join('').includes(token));
  await assert.rejects(issueTicket({ async query() { throw new Error('Must not overwrite'); } },{out:directory},{now:NOW,log() {}}));
});

test('staging validates sources and never overwrites a frozen date or prints private material', async t => {
  const directory = await temporary(t), filename = path.join(directory,'source.json'), logs = [], queries = [];
  const source = { date:'2026-10-15',test:true,snapshotId:'project:2026-10-15:test',
    coverage:'人工整理的局部工作摘要；没有完整聊天覆盖证明。',
    messages:[{id:'summary:1',role:'summary',createdAt:NOW-60000,content:'private-source-sentinel'}],
    sources:[{id:'project',type:'human_curated_project_summary',readStatus:'PARTIAL',messageCount:1,
      scannedAt:NOW,coverageUntil:NOW-60000,verification:'received-data-consistency-only'}] };
  let canonical;
  const client = { async query(db,sql,params) {
    queries.push({db,sql,params});
    if (sql.startsWith('INSERT')) {
      assert.match(sql,/ON CONFLICT\(channel,date\) DO NOTHING/);
      canonical ||= {id:params[0],date:params[1],channel:params[2],snapshot_id:params[3],
        server_hash:JSON.parse(params[4]).serverHash,message_count:JSON.parse(params[4]).messageCount}; return [];
    }
    return [canonical];
  } };
  await writeFile(filename,JSON.stringify(source));
  const result = await stageSource(client,{input:filename},{now:NOW,log:value=>logs.push(value)});
  assert.equal(result.count,1); assert.equal(result.channel,'ai-diary-test');
  assert.ok(!logs.join('').includes('private-source-sentinel'));
  await stageSource(client,{input:filename},{now:NOW,log() {}});
  source.messages[0].content = 'different source'; await writeFile(filename,JSON.stringify(source));
  await assert.rejects(stageSource(client,{input:filename},{now:NOW,log() {}}), error=>error.code==='SOURCE_FROZEN_CONFLICT');
  assert.ok(queries.every(query=>query.db===PRIVATE_DB));
});

test('report projects metadata only, marks truncation, and never claims scheduled success from paired logs', () => {
  const sourceRows = Array.from({length:ROW_LIMIT+1},(_,id)=>({id:`source:${id}`,date:'2026-10-15',channel:'ai-diary-test',
    snapshot_id:'project:fixture',server_hash:'a'.repeat(64),message_count:1,created_at:NOW,expires_at:NOW+1,
    messages_json:'private-source-sentinel',manifest_json:'private-manifest-sentinel'}));
  const data = buildReport([sourceRows,[
    {id:1,event_type:'oauth_refresh_token',phase:'validated_exchange',request_id:'request:1',created_at:NOW,metadata_json:'private-token-sentinel'},
    {id:2,event_type:'token_response_success',request_id:'request:1',created_at:NOW},
  ],[{channel:'ai-diary-test',date:'2026-10-15',request_content:'private-body-sentinel',request_title:'private-title-sentinel'}],
  [{source_count:ROW_LIMIT+1,event_count:2}],[{registry_count:1}]],NOW);
  const text = JSON.stringify(data);
  for (const marker of ['private-source-sentinel','private-manifest-sentinel','private-token-sentinel','private-body-sentinel','private-title-sentinel']) assert.ok(!text.includes(marker));
  assert.equal(data.sources.length,ROW_LIMIT); assert.equal(data.completeness.truncated.sources,true);
  assert.equal(data.refreshObservations.pairedSuccessfulResponses,1); assert.equal(data.refreshObservations.provesScheduledRefresh,false);
  assert.equal(data.scheduledExecution,'UNVERIFIED'); assert.equal(data.computerOffline,'UNVERIFIED');
});

test('revoke-all signs an in-memory ticket, targets only this publisher and reports confirmed count', async () => {
  const calls = [], logs = [], requests = [];
  const client = {async query(...args) { calls.push(args); return []; }};
  const fetcher = async (url,options) => { requests.push({url,options}); return Response.json({revokedCount:1,grantIds:['one-grant']}); };
  assert.equal(await revokeAll(client,{fetcher,log:value=>logs.push(value),now:NOW}),1);
  assert.equal(calls[0][0],PRIVATE_DB); assert.equal(requests[0].url,`${ORIGIN}/operator/revoke`);
  assert.equal(requests[0].options.redirect,'error'); assert.deepEqual(JSON.parse(requests[0].options.body),{all:true});
  const ticket = requests[0].options.headers.Authorization.slice(7);
  assert.ok(!logs.join('').includes(ticket)); assert.deepEqual(JSON.parse(logs[0]),{revokedCount:1});
  await assert.rejects(revokeAll(client,{fetcher:async()=>Response.json({revokedCount:1,grantIds:[]}),log() {}}),error=>error.code==='REVOKE_INVALID_RESPONSE');
});
