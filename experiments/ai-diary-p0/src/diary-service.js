export const CHANNEL = 'diary-p0';
export const AUTHOR = 'AI 日记（隔离测试）';
const VERSION = 1;
const DAY = 86400000;
const UTC8 = 8 * 3600000;

export class DiaryServiceError extends Error {
  constructor(status, code, message, options) {
    super(message, options);
    this.name = 'DiaryServiceError';
    this.status = status;
    this.code = code;
  }
}

function dateWindow(date, now) {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new DiaryServiceError(503, 'INVALID_CLOCK', '测试服务时间无效');
  }
  const start = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? Date.parse(`${date}T00:00:00+08:00`) : NaN;
  if (!Number.isFinite(start) || new Date(start + UTC8).toISOString().slice(0, 10) !== date) {
    throw new DiaryServiceError(400, 'INVALID_DATE', '日期必须是有效的 YYYY-MM-DD（UTC+8）');
  }
  const today = Math.floor((now + UTC8) / DAY) * DAY - UTC8;
  if (start >= today || start < today - 7 * DAY) {
    throw new DiaryServiceError(400, 'DATE_OUT_OF_RANGE', '只允许处理 UTC+8 过去七日，不含当天');
  }
  return { start, end: start + DAY };
}

async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function fixtureMessages(date, start) {
  return [
    { id: `synthetic:${date}:1`, role: 'user', createdAt: start + 9 * 3600000,
      content: '【固定虚构记录】虚构人物林某整理了阳台植物，并记录浇水计划。' },
    { id: `synthetic:${date}:2`, role: 'assistant', createdAt: start + 14 * 3600000,
      content: '【固定虚构记录】双方讨论了虚构读书笔记的章节安排，没有真实人物或聊天信息。' },
    { id: `synthetic:${date}:3`, role: 'user', createdAt: start + 20 * 3600000,
      content: '【固定虚构记录】林某决定明天继续阅读，并测试第三人称日记的自动发布流程。' }
  ];
}

async function fixturePacket(date, window) {
  const snapshotId = `${CHANNEL}:${date}:v${VERSION}`;
  const messages = fixtureMessages(date, window.start);
  const serverHash = await sha256(JSON.stringify({ date, snapshotId, version: VERSION, synthetic: true, messages }));
  const sourceManifestId = `synthetic-v${VERSION}:${serverHash}`;
  return {
    date, snapshotId, sourceManifestId, messages, synthetic: true,
    sourceManifest: {
      id: sourceManifestId, date, snapshotId, version: VERSION, serverHash,
      messageCount: messages.length, synthetic: true, noRealRecords: true,
      windowStart: window.start, windowEnd: window.end, timeZone: 'UTC+8',
      coverage: '仅覆盖本服务的固定虚构样本；没有读取任何真实聊天记录',
      verification: 'server-generated-synthetic-fixture'
    }
  };
}

function verifyManifest(row, packet) {
  if (!row || row.id !== packet.sourceManifestId || row.date !== packet.date ||
      row.snapshot_id !== packet.snapshotId || row.version !== VERSION || row.synthetic !== 1 ||
      row.server_hash !== packet.sourceManifest.serverHash || row.message_count !== packet.messages.length ||
      row.messages_json !== JSON.stringify(packet.messages)) {
    throw new DiaryServiceError(503, 'SOURCE_INTEGRITY_FAILED', '固定虚构快照校验失败');
  }
}

function registryFor(db, date) {
  return db.prepare('SELECT * FROM ai_diary_registry WHERE channel = ? AND date = ?').bind(CHANNEL, date).first();
}

function postFor(db, registry) {
  return db.prepare('SELECT * FROM probe_diaries WHERE id = ? AND registry_id = ?')
    .bind(registry.post_id, registry.registry_id).first();
}

function receipt(registry, deleted = false) {
  return {
    postId: registry.post_id, date: registry.date, channel: registry.channel,
    author: AUTHOR, createdAt: registry.created_at, snapshotId: registry.snapshot_id,
    sourceManifestId: registry.source_manifest_id, requestHash: registry.request_hash,
    deleted
  };
}

function verifyPublished(registry, post) {
  if (registry.state !== 'PUBLISHED') {
    throw new DiaryServiceError(503, 'PUBLISH_FAILED', '测试日记登记尚未完整提交');
  }
  if (post && (post.claim_nonce !== registry.claim_nonce || post.channel !== CHANNEL ||
      post.date !== registry.date || post.snapshot_id !== registry.snapshot_id ||
      post.source_manifest_id !== registry.source_manifest_id || post.request_hash !== registry.request_hash ||
      post.author !== AUTHOR || post.created_at !== registry.created_at)) {
    throw new DiaryServiceError(503, 'PUBLISH_FAILED', '测试日记与永久登记不一致');
  }
}

export async function getSourcePacket(db, date, now = Date.now()) {
  const window = dateWindow(date, now);
  const packet = await fixturePacket(date, window);
  try {
    await db.batch([db.prepare(`INSERT INTO probe_source_manifests
      (id,date,snapshot_id,version,server_hash,message_count,messages_json,synthetic,created_at)
      VALUES (?,?,?,?,?,?,?,1,?) ON CONFLICT(date) DO NOTHING`)
      .bind(packet.sourceManifestId, date, packet.snapshotId, VERSION, packet.sourceManifest.serverHash,
        packet.messages.length, JSON.stringify(packet.messages), now)]);
    const manifest = await db.prepare('SELECT * FROM probe_source_manifests WHERE date = ?').bind(date).first();
    verifyManifest(manifest, packet);
    const registry = await registryFor(db, date);
    let previousReceipt = null, previousContent = null;
    if (registry) {
      const post = await postFor(db, registry);
      verifyPublished(registry, post);
      previousReceipt = receipt(registry, !post);
      // Retry the original accepted request, even after a human edits its display body.
      previousContent = registry.request_content;
    }
    return { ...packet, previousReceipt, previousContent };
  } catch (error) {
    if (error instanceof DiaryServiceError) throw error;
    throw new DiaryServiceError(503, 'SOURCE_FAILED', '隔离测试来源暂时无法读取', { cause: error });
  }
}

function normalizedContent(content) {
  if (typeof content !== 'string' || content.length > 50000 || !content.trim()) {
    throw new DiaryServiceError(400, 'INVALID_CONTENT', '日记必须是非空文字，最多50000字符');
  }
  return content.replace(/\r\n?/g, '\n').trim();
}

async function existingResult(db, registry, requestHash, ownNonce = null) {
  const post = await postFor(db, registry);
  verifyPublished(registry, post);
  // Deletion takes precedence over content conflict: the date stays occupied forever.
  if (!post) throw new DiaryServiceError(410, 'POST_DELETED', '该日记曾发表且已物理删除，日期不会释放');
  if (registry.request_hash !== requestHash) {
    throw new DiaryServiceError(409, 'CONFLICT', '该日期已有不同内容的日记，不能覆盖');
  }
  const reused = registry.claim_nonce !== ownNonce;
  return { status: reused ? 200 : 201, reused, receipt: receipt(registry), synthetic: true };
}

export async function publishDiary(db, input = {}, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DiaryServiceError(400, 'INVALID_INPUT', '日记请求必须是对象');
  }
  const { date, content, sourceManifestId } = input;
  // Only the trusted MCP closure supplies this field; public tool schemas omit it.
  // Omission remains supported solely for direct synthetic Node helpers.
  const hasGrantId = Object.prototype.hasOwnProperty.call(input, 'grantId');
  const grantId = hasGrantId ? input.grantId : null;
  if (hasGrantId && (typeof grantId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(grantId))) {
    throw new DiaryServiceError(401, 'AUTH_REQUIRED', '测试授权无效，请重新授权');
  }
  const window = dateWindow(date, now);
  const normalized = normalizedContent(content);
  const packet = await fixturePacket(date, window);
  if (typeof sourceManifestId !== 'string' || sourceManifestId !== packet.sourceManifestId) {
    throw new DiaryServiceError(400, 'INVALID_MANIFEST', '来源清单必须对应本日期的固定虚构快照');
  }
  const requestHash = await sha256(JSON.stringify({ date, content: normalized, snapshotId: packet.snapshotId }));
  const nonce = crypto.randomUUID(), registryId = crypto.randomUUID();
  try {
    const grantRevoked = async () => hasGrantId && !!await db.prepare(
      'SELECT grant_id FROM revoked_grants WHERE grant_id = ?').bind(grantId).first();
    if (await grantRevoked()) {
      throw new DiaryServiceError(401, 'AUTH_REQUIRED', '测试授权已撤销，请重新授权');
    }
    const manifest = await db.prepare('SELECT * FROM probe_source_manifests WHERE id = ? AND date = ?')
      .bind(sourceManifestId, date).first();
    if (!manifest) throw new DiaryServiceError(400, 'INVALID_MANIFEST', '请先读取本日期的来源快照');
    verifyManifest(manifest, packet);
    const previous = await registryFor(db, date);
    if (previous) return await existingResult(db, previous, requestHash);

    try {
      await db.batch([
        db.prepare(`INSERT INTO ai_diary_registry
          (channel,date,registry_id,snapshot_id,source_manifest_id,request_hash,request_content,claim_nonce,state,created_at)
          SELECT ?,?,?,?,?,?,?,?,'CLAIMED',? FROM probe_source_manifests m
          WHERE m.id=? AND m.date=? AND m.snapshot_id=? AND m.server_hash=? AND m.message_count=?
          AND m.version=? AND m.messages_json=? AND m.synthetic=1
          AND NOT EXISTS (SELECT 1 FROM revoked_grants g WHERE g.grant_id=?)
          ON CONFLICT(channel,date) DO NOTHING`)
          .bind(CHANNEL, date, registryId, packet.snapshotId, sourceManifestId, requestHash, normalized, nonce, now,
            sourceManifestId, date, packet.snapshotId, packet.sourceManifest.serverHash, packet.messages.length,
            VERSION, JSON.stringify(packet.messages), grantId),
        db.prepare(`INSERT INTO probe_diaries
          (registry_id,claim_nonce,channel,date,author,title,content,snapshot_id,source_manifest_id,request_hash,created_at)
          SELECT r.registry_id,r.claim_nonce,r.channel,r.date,?, ?,r.request_content,r.snapshot_id,r.source_manifest_id,r.request_hash,r.created_at
          FROM ai_diary_registry r WHERE r.channel=? AND r.date=? AND r.claim_nonce=? AND r.state='CLAIMED'
          AND r.request_hash=? AND r.snapshot_id=? AND r.source_manifest_id=?`)
          .bind(AUTHOR, `AI 日记 · ${date}（隔离测试）`, CHANNEL, date, nonce, requestHash, packet.snapshotId, sourceManifestId),
        db.prepare(`UPDATE ai_diary_registry SET state='PUBLISHED',post_id=(
          SELECT p.id FROM probe_diaries p WHERE p.registry_id=ai_diary_registry.registry_id AND p.claim_nonce=?)
          WHERE channel=? AND date=? AND claim_nonce=? AND state='CLAIMED' AND request_hash=?
          AND snapshot_id=? AND source_manifest_id=? AND EXISTS (
            SELECT 1 FROM probe_diaries p WHERE p.registry_id=ai_diary_registry.registry_id AND p.claim_nonce=?
            AND p.request_hash=ai_diary_registry.request_hash AND p.snapshot_id=ai_diary_registry.snapshot_id
            AND p.source_manifest_id=ai_diary_registry.source_manifest_id)`)
          .bind(nonce, CHANNEL, date, nonce, requestHash, packet.snapshotId, sourceManifestId, nonce),
        db.prepare(`INSERT INTO probe_events(event_type,date,grant_id,request_id,created_at,metadata_json,invariant_ok)
          VALUES ('DIARY_PUBLISHED',?,?,?,?,?, CASE WHEN EXISTS (
            SELECT 1 FROM ai_diary_registry r JOIN probe_diaries p ON p.id=r.post_id AND p.registry_id=r.registry_id
            WHERE r.channel=? AND r.date=? AND r.claim_nonce=? AND r.state='PUBLISHED'
            AND r.request_hash=? AND r.snapshot_id=? AND r.source_manifest_id=?
            AND p.claim_nonce=? AND p.channel=r.channel AND p.date=r.date AND p.author=?
            AND p.request_hash=r.request_hash AND p.snapshot_id=r.snapshot_id
            AND p.source_manifest_id=r.source_manifest_id AND p.created_at=r.created_at AND p.content=r.request_content
          ) THEN 1 ELSE 0 END)`)
          .bind(date, grantId, nonce, now, JSON.stringify({ synthetic: true, snapshotId: packet.snapshotId, requestHash }),
            CHANNEL, date, nonce, requestHash, packet.snapshotId, sourceManifestId, nonce, AUTHOR)
      ]);
    } catch (error) {
      if (await grantRevoked()) {
        throw new DiaryServiceError(401, 'AUTH_REQUIRED', '测试授权已撤销，请重新授权');
      }
      // A competing atomic batch may already have committed the canonical result.
      const winner = await registryFor(db, date);
      if (winner) return await existingResult(db, winner, requestHash);
      throw new DiaryServiceError(503, 'PUBLISH_FAILED', '测试日记未提交，可复用原请求重试', { cause: error });
    }
    const committed = await registryFor(db, date);
    if (!committed) throw new DiaryServiceError(503, 'PUBLISH_FAILED', '测试日记没有完整提交');
    return await existingResult(db, committed, requestHash, nonce);
  } catch (error) {
    if (error instanceof DiaryServiceError) throw error;
    throw new DiaryServiceError(503, 'PUBLISH_FAILED', '隔离测试发布暂时不可用', { cause: error });
  }
}
