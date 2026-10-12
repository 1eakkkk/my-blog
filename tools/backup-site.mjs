import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function objectPath(key) { return key.split('/').map(encodeURIComponent).join('/'); }
const normalizedEtag = value => String(value || '').replace(/^W\//i, '').replace(/^"|"$/g, '');

function argumentsFor(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || !argv[i + 1]) throw new Error('参数必须使用 --名称 值');
    options[argv[i].slice(2)] = argv[i + 1];
  }
  return options;
}
async function cloudflareToken(options) {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  if (!options['oauth-config']) throw new Error('需要 CLOUDFLARE_API_TOKEN 或 --oauth-config（Wrangler OAuth 配置路径）');
  const config = await readFile(options['oauth-config'], 'utf8');
  const token = config.match(/^\s*oauth_token\s*=\s*"([^"\r\n]+)"/m)?.[1];
  if (!token) throw new Error('Wrangler 尚未登录，请先运行 wrangler login');
  return token;
}
async function runWrangler(options, args) {
  const command = options['wrangler-js'];
  if (!command) throw new Error('需要 --wrangler-js（Wrangler 的 bin/wrangler.js 路径）');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [command, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1', NO_COLOR: '1' } });
    let output = '';
    child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { output += value; });
    child.on('error', () => reject(new Error('无法启动 Wrangler')));
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`Wrangler 导出失败（退出码 ${code}）；请检查账号权限和数据库绑定`)));
  });
}
async function exportDatabaseViaApi(options, token, databaseFile) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${options.account}/d1/database/${options['database-id']}/export`;
  let bookmark;
  for (let attempt = 0; attempt < 600; attempt++) {
    const response = await fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ output_format: 'polling', ...(bookmark ? { current_bookmark: bookmark } : {}) }) });
    if (!response.ok) throw new Error(`D1 API 导出失败（HTTP ${response.status}）`);
    const data = await response.json();
    if (data.success !== true || data.result?.status === 'error') throw new Error('D1 API 未能完成导出；请检查数据库状态和权限');
    if (data.result?.status === 'complete') {
      let signedUrl;
      try { signedUrl = new URL(data.result.result.signed_url); } catch (_) { throw new Error('D1 导出下载地址无效'); }
      if (signedUrl.protocol !== 'https:' || signedUrl.username || signedUrl.password) throw new Error('D1 导出下载地址无效');
      // Do not forward Cloudflare credentials to the signed download URL.
      const download = await fetch(signedUrl, { signal: AbortSignal.timeout(120000) });
      if (!download.ok) throw new Error(`D1 SQL 下载失败（HTTP ${download.status}）`);
      await writeFile(databaseFile, Buffer.from(await download.arrayBuffer()));
      return;
    }
    if (typeof data.result?.at_bookmark !== 'string' || !data.result.at_bookmark) throw new Error('D1 导出缺少轮询标识');
    bookmark = data.result.at_bookmark;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('D1 导出超时；备份保持未完成状态');
}
export async function createBackup(options) {
  for (const key of ['out', 'account', 'database', 'bucket']) if (!options[key]) throw new Error(`缺少 --${key}`);
  if (!options['database-id'] && !options.config) throw new Error('缺少 --config 或 --database-id');
  if (!/^[a-f0-9]{32}$/.test(options.account) || !/^[a-z0-9-]{3,63}$/.test(options.bucket)) throw new Error('账号或存储桶名称无效');
  if (options['database-id'] && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(options['database-id'])) throw new Error('数据库 UUID 无效');
  if (!path.isAbsolute(options.out)) throw new Error('--out 必须是明确的绝对路径');
  const destination = path.resolve(options.out);
  try { await stat(destination); throw new Error('备份目录已经存在；请选择新目录，防止覆盖旧备份'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(destination, { recursive: true }); await mkdir(path.join(destination, 'media'));
  const started = new Date().toISOString();
  await writeFile(path.join(destination, 'INCOMPLETE'), '只有 manifest.json 生成并通过 verify-backup.mjs 后，此目录才是完整备份。\n');
  const databaseFile = path.join(destination, 'database.sql');
  console.log('正在导出 D1 数据库结构和完整数据…');
  let token;
  if (options['database-id']) {
    token = await cloudflareToken(options);
    await exportDatabaseViaApi(options, token, databaseFile);
  } else {
    await runWrangler(options, ['d1', 'export', options.database, '--remote', '--output', databaseFile, '--config', options.config, ...(options.env ? ['--env', options.env] : [])]);
    // Wrangler refreshes its OAuth token while exporting; read the renewed token afterwards.
    token = await cloudflareToken(options);
  }
  const sqlBytes = await readFile(databaseFile);
  const base = `https://api.cloudflare.com/client/v4/accounts/${options.account}/r2/buckets/${encodeURIComponent(options.bucket)}/objects`;
  const headers = { Authorization: `Bearer ${token}` };
  const objects = [];
  let cursor = '';
  const cursors = new Set();
  let totalBytes = 0;
  let inventoryCursor;
  do {
    const query = new URLSearchParams({ per_page: '1000' });
    if (cursor) query.set('cursor', cursor);
    const response = await fetch(`${base}?${query}`, { headers });
    if (!response.ok) throw new Error(`R2 对象列表读取失败（HTTP ${response.status}）`);
    const data = await response.json();
    if (data.success === false || !Array.isArray(data.result)) throw new Error('R2 对象列表返回格式异常');
    for (const object of data.result) {
      if (typeof object.key !== 'string' || !Number.isSafeInteger(Number(object.size)) || Number(object.size) < 0) throw new Error('R2 对象元数据无效');
      if (objects.some(item => item.key === object.key)) throw new Error('R2 列表出现重复对象，请重新备份');
      const get = await fetch(`${base}/${objectPath(object.key)}`, { headers });
      if (!get.ok) throw new Error(`R2 文件读取失败（HTTP ${get.status}）；备份保持未完成状态`);
      const bytes = Buffer.from(await get.arrayBuffer());
      if (bytes.length !== Number(object.size)) throw new Error('备份过程中媒体文件发生变化，请重新备份');
      const etag = normalizedEtag(get.headers.get('etag'));
      if (object.etag && etag && etag !== normalizedEtag(object.etag)) throw new Error('备份过程中媒体文件版本发生变化，请重新备份');
      const relative = `media/${sha256(object.key)}.bin`;
      await writeFile(path.join(destination, relative), bytes);
      objects.push({ key: object.key, file: relative, size: bytes.length, sha256: sha256(bytes), etag,
        http_metadata: object.http_metadata || {}, custom_metadata: object.custom_metadata || {}, last_modified: object.last_modified || null });
      totalBytes += bytes.length;
      console.log(`媒体备份 ${objects.length} 个，累计 ${Math.round(totalBytes / 1024 / 1024 * 10) / 10} MB`);
    }
    inventoryCursor = data.result_info?.is_truncated;
    cursor = data.result_info?.cursor || '';
    if (inventoryCursor && (!cursor || cursors.has(cursor))) throw new Error('R2 分页游标异常，不能标记为完整备份');
    cursors.add(cursor);
  } while (inventoryCursor);
  // Re-list every object to catch uploads/deletions or replacements while copying.
  cursor = '';
  cursors.clear();
  const current = [];
  do {
    const query = new URLSearchParams({ per_page: '1000', ...(cursor ? { cursor } : {}) });
    const response = await fetch(`${base}?${query}`, { headers });
    if (!response.ok) throw new Error(`R2 最终核对失败（HTTP ${response.status}）`);
    const data = await response.json();
    if (data.success === false || !Array.isArray(data.result)) throw new Error('R2 最终核对格式异常');
    current.push(...data.result.map(object => ({ key: object.key, size: Number(object.size), etag: normalizedEtag(object.etag) })));
    if (data.result_info?.is_truncated) {
      cursor = data.result_info.cursor;
      if (!cursor || cursors.has(cursor)) throw new Error('R2 最终核对分页游标异常，不能标记为完整备份');
      cursors.add(cursor);
    } else cursor = '';
  } while (cursor);
  if (current.length !== objects.length || new Set(current.map(object => object.key)).size !== current.length || current.some(object => !objects.some(saved => saved.key === object.key && saved.size === object.size && (!object.etag || !saved.etag || object.etag === saved.etag)))) throw new Error('备份期间媒体清单发生变化，请在站点较空闲时重新备份');
  const manifest = { format: 'my-blog-backup', version: 1, started_at: started, completed_at: new Date().toISOString(),
    source: { database: options.database, bucket: options.bucket, ...(options['database-id'] ? { database_id: options['database-id'] } : {}) }, database: { file: 'database.sql', bytes: sqlBytes.length, sha256: sha256(sqlBytes) },
    media: { count: objects.length, bytes: totalBytes, objects } };
  await writeFile(path.join(destination, 'manifest.pending.json'), JSON.stringify(manifest, null, 2) + '\n');
  await rename(path.join(destination, 'manifest.pending.json'), path.join(destination, 'manifest.json'));
  console.log(JSON.stringify({ backup: destination, database_bytes: sqlBytes.length, media_count: objects.length, media_bytes: totalBytes, status: 'copied; run verify-backup.mjs before using' }));
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createBackup(argumentsFor(process.argv.slice(2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
