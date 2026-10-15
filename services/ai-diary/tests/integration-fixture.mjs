import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { freezeSourcePacket } from '../src/source.js';

export const NOW = Date.parse('2026-10-15T08:00:00+08:00');
export const DATE = '2026-10-14';

export function database() {
  const sqlite = new DatabaseSync(':memory:');
  function prepare(sql, values = []) {
    return { sql, values, bind(...args) { return prepare(sql, args); },
      async first() { return sqlite.prepare(sql).get(...values) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; },
      async run() {
        const result = sqlite.prepare(sql).run(...values);
        return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      } };
  }
  return { sqlite, db: { prepare, async batch(statements) {
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const result = [];
      for (const statement of statements) result.push(await statement.run());
      sqlite.exec('COMMIT'); return result;
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } }, close() { sqlite.close(); } };
}

export function sourceInput(extra = {}) {
  return { date: DATE, test: false, snapshotId: 'project:2026-10-14:v1',
    messages: [{ id: 'summary:1', role: 'summary', createdAt: Date.parse(`${DATE}T18:00:00+08:00`),
      content: '人工整理摘要：网站完成一轮测试；仅覆盖提供的工作记录。' }],
    coverage: '仅包含人工整理的项目摘要，不能证明完整聊天覆盖。',
    sources: [{ id: 'project-summary', type: 'human_curated_project_summary', messageCount: 1,
      readStatus: 'PARTIAL', scannedAt: NOW, coverageUntil: Date.parse('2026-10-15T00:00:00+08:00'),
      verification: 'received-data-consistency-only' }], ...extra };
}

export function fixture() {
  const priv = database(), site = database();
  priv.sqlite.exec(readFileSync(new URL('../migrations/0001_private.sql', import.meta.url), 'utf8'));
  site.sqlite.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,nickname TEXT,status TEXT,ban_expires_at INTEGER);
    CREATE TABLE posts(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,author_name TEXT,title TEXT,content TEXT,category TEXT,mood TEXT,created_at INTEGER);
    CREATE TABLE content_recycle(kind TEXT,target_id INTEGER);
    INSERT INTO users(id,username,nickname,status) VALUES (56,'ChatGPT','ChatGPT','active');`);
  site.sqlite.exec(readFileSync(new URL('../../../migrations/004_ai_diary.sql', import.meta.url), 'utf8'));
  const env = { DB: priv.db, SITE_DB: site.db, AI_AUTHOR_ID: '56', SITE_ORIGIN: 'https://blog.example.test',
    PUBLIC_ORIGIN: 'https://diary.example.test', DIARY_ENVIRONMENT: 'site-publisher', SITE_PUBLISH_ENABLED: 'true',
    OAUTH_KV: { get() {}, put() {}, delete() {}, list() {} } };
  async function insert(input = sourceInput(), now = NOW) {
    const row = await freezeSourcePacket(input, now);
    await priv.db.prepare(`INSERT INTO diary_source_packets
      (id,date,channel,snapshot_id,manifest_json,messages_json,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)`)
      .bind(row.id,row.date,row.channel,row.snapshot_id,row.manifest_json,row.messages_json,row.created_at,row.expires_at).run();
    return row;
  }
  return { priv, site, env, insert, close() { priv.close(); site.close(); } };
}
