import { readFile, writeFile, mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { sha256 } from './backup-site.mjs';

function beneath(directory, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\\')) throw new Error('备份文件路径无效');
  const absolute = path.resolve(directory, relative);
  const relation = path.relative(directory, absolute);
  if (relation.startsWith('..') || path.isAbsolute(relation)) throw new Error('备份文件路径越界');
  return absolute;
}
const identifier = value => '"' + String(value).replaceAll('"', '""') + '"';
export async function verifyBackup(directory, restoreDirectory) {
  directory = path.resolve(directory);
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.format !== 'my-blog-backup' || manifest.version !== 1 || !Array.isArray(manifest.media?.objects) || manifest.media.count !== manifest.media.objects.length) throw new Error('备份清单格式无效');
  const sqlBytes = await readFile(beneath(directory, manifest.database.file));
  if (sqlBytes.length !== manifest.database.bytes || sha256(sqlBytes) !== manifest.database.sha256) throw new Error('数据库导出文件校验失败');
  if (!restoreDirectory || !path.isAbsolute(restoreDirectory)) throw new Error('恢复验证目录必须是新的明确绝对路径');
  try { await stat(restoreDirectory); throw new Error('恢复验证目录已经存在，请使用新目录'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(restoreDirectory, { recursive: true });
  const sqliteFile = path.join(restoreDirectory, 'restored.sqlite');
  const restored = new DatabaseSync(sqliteFile);
  const tables = [];
  let invalidatedSessions = 0;
  try {
    // D1 exports are trusted administrator artifacts. No production database is opened here.
    // Reject filesystem/extension capabilities even if a supplied dump was tampered with.
    const sql = sqlBytes.toString('utf8');
    if (/\b(?:ATTACH|DETACH|load_extension)\b/i.test(sql.replace(/'(?:''|[^'])*'/g, "''"))) throw new Error('SQL 包含不允许的外部文件操作');
    restored.exec('PRAGMA foreign_keys=OFF;'); restored.exec(sql);
    const integrity = restored.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok') throw new Error('恢复后的 SQLite 完整性检查失败');
    const foreignKeys = restored.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeys.length) throw new Error(`恢复后发现 ${foreignKeys.length} 条外键异常`);
    const names = restored.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all();
    for (const { name } of names) {
      const count = restored.prepare(`SELECT COUNT(*) AS count FROM ${identifier(name)}`).get().count;
      tables.push({ name, count });
    }
    if (!tables.some(item => item.name === 'posts') || !tables.some(item => item.name === 'users')) throw new Error('恢复数据库缺少站点基础表');
    // A disaster restoration must require a new login rather than revive old cookies.
    if (tables.some(item => item.name === 'sessions')) {
      invalidatedSessions = restored.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
      restored.exec('DELETE FROM sessions;');
      if (restored.prepare('SELECT COUNT(*) AS n FROM sessions').get().n !== 0) throw new Error('恢复会话清理失败');
    }
    await writeFile(path.join(restoreDirectory, 'restore.sql'), sql + '\n-- Require new logins after disaster recovery.\nDELETE FROM sessions;\n');
  } finally { restored.close(); }
  const seenKeys = new Set(); let mediaBytes = 0;
  for (const object of manifest.media.objects) {
    if (typeof object.key !== 'string' || seenKeys.has(object.key) || !Number.isSafeInteger(object.size) || object.size < 0) throw new Error('媒体清单出现无效或重复对象');
    seenKeys.add(object.key);
    const bytes = await readFile(beneath(directory, object.file));
    if (bytes.length !== object.size || sha256(bytes) !== object.sha256) throw new Error(`媒体校验失败：第 ${seenKeys.size} 个文件`);
    // Copy into an independent restoration directory to verify backup reads and writes.
    const relative = `media/${sha256(object.key)}.bin`;
    await mkdir(path.join(restoreDirectory, 'media'), { recursive: true });
    await writeFile(path.join(restoreDirectory, relative), bytes);
    if (sha256(await readFile(path.join(restoreDirectory, relative))) !== object.sha256) throw new Error('媒体恢复后的二次校验失败');
    mediaBytes += bytes.length;
  }
  if (mediaBytes !== manifest.media.bytes) throw new Error('媒体总字节数不匹配');
  // Keep keys and HTTP metadata alongside the independently restored media bytes.
  await writeFile(path.join(restoreDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const report = { verified_at: new Date().toISOString(), database_sha256: manifest.database.sha256, sqlite: sqliteFile, integrity_check: 'ok', foreign_key_check: 'ok', source_tables: tables, invalidated_sessions: invalidatedSessions, restored_sessions: 0, media_count: seenKeys.size, media_bytes: mediaBytes, media_sha256: 'all matched' };
  await writeFile(path.join(restoreDirectory, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(directory, 'VERIFIED.json'), JSON.stringify(report, null, 2) + '\n');
  try { await unlink(path.join(directory, 'INCOMPLETE')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  console.log(JSON.stringify({ integrity_check: 'ok', tables, media_count: seenKeys.size, media_bytes: mediaBytes, restoration: restoreDirectory }));
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyBackup(process.argv[2], process.argv[3]).catch(error => { console.error(error.message); process.exitCode = 1; });
}
