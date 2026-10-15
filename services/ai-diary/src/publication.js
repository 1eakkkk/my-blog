const DAY = 86400000;
const UTC8 = 8 * 3600000;
export const DAILY_CHANNEL = 'ai-diary';
export const TEST_CHANNEL = 'ai-diary-test';
export const TEST_NOTICE = '> **发布测试：本篇用于验证 AI 日记发布流程，不代表自动任务已完成验收。**';

export class DiaryPublicationError extends Error {
  constructor(status, code, message, options) {
    super(message, options);
    this.name = 'DiaryPublicationError';
    this.status = status;
    this.code = code;
  }
}

function parseDate(date) {
  const start = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? Date.parse(`${date}T00:00:00+08:00`) : NaN;
  if (!Number.isFinite(start) || new Date(start + UTC8).toISOString().slice(0, 10) !== date) {
    throw new DiaryPublicationError(400, 'INVALID_DATE', '日期必须是有效的 YYYY-MM-DD（UTC+8）');
  }
  return start;
}

function channelFor(test = false) {
  if (typeof test !== 'boolean') throw new DiaryPublicationError(400, 'INVALID_INPUT', 'test 必须为布尔值');
  return test ? TEST_CHANNEL : DAILY_CHANNEL;
}

export function validateDiaryDate(date, now = Date.now(), { test = false } = {}) {
  if (!Number.isSafeInteger(now) || now < 0) throw new DiaryPublicationError(503, 'INVALID_CLOCK', '服务时间无效');
  const start = parseDate(date), channel = channelFor(test);
  const today = Math.floor((now + UTC8) / DAY) * DAY - UTC8;
  if (start < today - 7 * DAY || start > today || (!test && start === today)) {
    throw new DiaryPublicationError(400, 'DATE_OUT_OF_RANGE', test
      ? '测试只允许 UTC+8 当天或过去七日' : '日记只允许 UTC+8 过去七日，不含当天');
  }
  return { start, end: start + DAY, channel };
}

function configuration(config) {
  const rawId = config?.AI_AUTHOR_ID;
  if (!['number', 'string'].includes(typeof rawId) || !/^[1-9]\d*$/.test(String(rawId)) || !Number.isSafeInteger(Number(rawId))) {
    throw new DiaryPublicationError(503, 'INVALID_CONFIGURATION', '固定日记作者尚未配置');
  }
  let origin;
  try {
    const url = new URL(config.SITE_ORIGIN);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
    origin = url.origin;
  } catch {
    throw new DiaryPublicationError(503, 'INVALID_CONFIGURATION', '网站地址配置无效');
  }
  return { authorId: Number(rawId), origin };
}

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function normalizedRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['date', 'title', 'content', 'sourceManifestId', 'test'].includes(key))) {
    throw new DiaryPublicationError(400, 'INVALID_INPUT', '日记请求字段无效');
  }
  const test = input.test ?? false;
  channelFor(test);
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 100 || /[\r\n\x00-\x1f]/.test(input.title)) {
    throw new DiaryPublicationError(400, 'INVALID_TITLE', '标题须为单行文字，最多100字符');
  }
  if (typeof input.content !== 'string' || !input.content.trim() || input.content.length > 50000 || input.content.includes('\0')) {
    throw new DiaryPublicationError(400, 'INVALID_CONTENT', '日记须为非空文字，最多50000字符');
  }
  if (typeof input.sourceManifestId !== 'string' || !input.sourceManifestId.trim() || input.sourceManifestId.length > 200) {
    throw new DiaryPublicationError(400, 'INVALID_MANIFEST', '来源清单编号无效');
  }
  let title = input.title.trim(), content = input.content.replace(/\r\n?/g, '\n').trim();
  if (test) {
    if (!title.startsWith('【发布测试】')) title = `【发布测试】${title}`;
    if (!content.startsWith(TEST_NOTICE)) content = `${TEST_NOTICE}\n\n${content}`;
  }
  if (title.length > 100 || content.length > 50000) {
    throw new DiaryPublicationError(400, 'INVALID_CONTENT', '添加测试标记后标题或正文超出长度限制');
  }
  return { date: input.date, title, content, sourceManifestId: input.sourceManifestId, test, channel: channelFor(test) };
}

function registryFor(db, channel, date) {
  return db.prepare('SELECT * FROM ai_diary_registry WHERE channel=? AND date=?').bind(channel, date).first();
}

async function authorFor(db, authorId, now) {
  const author = await db.prepare('SELECT id,username,nickname,status,ban_expires_at FROM users WHERE id=?').bind(authorId).first();
  if (!author) throw new DiaryPublicationError(403, 'AUTHOR_UNAVAILABLE', '固定日记账号不存在');
  if (author.status === 'banned' && (!author.ban_expires_at || Number(author.ban_expires_at) > now)) {
    throw new DiaryPublicationError(403, 'AUTHOR_UNAVAILABLE', '固定日记账号已封禁');
  }
  return author;
}

async function publicationPost(db, registry) {
  if (registry.state !== 'PUBLISHED' || !Number.isSafeInteger(Number(registry.post_id)) || Number(registry.post_id) < 1) {
    throw new DiaryPublicationError(503, 'PUBLISH_FAILED', '日记登记未完整提交');
  }
  const post = await db.prepare(`SELECT p.id,p.user_id,p.created_at,
    EXISTS(SELECT 1 FROM content_recycle r WHERE r.kind='post' AND r.target_id=p.id) AS recycled
    FROM posts p WHERE p.id=?`).bind(registry.post_id).first();
  // Never expose the body of a different account's post if database corruption
  // or an external ID reuse makes a permanent registry point at another post.
  if (post && (Number(post.user_id) !== Number(registry.author_id) || post.created_at !== registry.created_at)) {
    throw new DiaryPublicationError(503, 'PUBLICATION_INTEGRITY_FAILED', '日记与永久登记不一致');
  }
  return post;
}

function receipt(registry, config, deleted = false) {
  return {
    postId: Number(registry.post_id), date: registry.date, channel: registry.channel,
    author: registry.author_name, authorId: registry.author_id, createdAt: registry.created_at,
    snapshotId: registry.snapshot_id, sourceManifestId: registry.source_manifest_id,
    requestHash: registry.request_hash, url: `${config.origin}/#post?id=${registry.post_id}`, deleted
  };
}

export async function getPublicationState(siteDb, { date, test = false }, config, now = Date.now()) {
  const fixed = configuration(config), channel = channelFor(test);
  parseDate(date);
  if (!Number.isSafeInteger(now) || now < 0) throw new DiaryPublicationError(503, 'INVALID_CLOCK', '服务时间无效');
  try {
    const registry = await registryFor(siteDb, channel, date);
    if (!registry) return { previousReceipt: null, previousTitle: null, previousContent: null };
    const post = await publicationPost(siteDb, registry);
    return {
      previousReceipt: receipt(registry, fixed, !post || !!post.recycled),
      previousTitle: registry.request_title, previousContent: registry.request_content
    };
  } catch (error) {
    if (error instanceof DiaryPublicationError) throw error;
    throw new DiaryPublicationError(503, 'SOURCE_FAILED', '无法读取日记发表状态', { cause: error });
  }
}

async function validatedPacket(db, input, now) {
  // The reader and publisher share exactly the same complete source validation.
  // Import on use because source's higher-level reader also adds publication state.
  const { loadValidatedSourcePacket } = await import('./source.js');
  const packet = await loadValidatedSourcePacket(db, { date: input.date, test: input.test }, now);
  if (!packet || packet.sourceManifestId !== input.sourceManifestId) {
    throw new DiaryPublicationError(400, 'INVALID_MANIFEST', '请先读取本日期及渠道的有效来源快照');
  }
  if (!packet.messages.length) throw new DiaryPublicationError(400, 'SOURCE_EMPTY', '没有可发表素材，不占用日期');
  return { snapshotId: packet.snapshotId, sourceHash: packet.sourceManifest.serverHash };
}

async function requestDigest(input, snapshotId) {
  return digest(JSON.stringify({ date: input.date, channel: input.channel, title: input.title,
    content: input.content, snapshotId, sourceManifestId: input.sourceManifestId }));
}

async function existingResult(db, registry, requestHash, config, ownNonce = null) {
  const post = await publicationPost(db, registry);
  // Recycling and physical deletion both retain the original publication slot.
  if (!post || post.recycled) throw new DiaryPublicationError(410, 'POST_DELETED', '该日记已回收或删除，日期仍永久占用');
  if (registry.request_hash !== requestHash) throw new DiaryPublicationError(409, 'CONFLICT', '该渠道及日期已有不同请求，不能覆盖');
  const reused = registry.claim_nonce !== ownNonce;
  return { status: reused ? 200 : 201, reused, receipt: receipt(registry, config) };
}

export async function publishSiteDiary(env, input, now = Date.now()) {
  const normalized = normalizedRequest(input), config = configuration(env);
  parseDate(normalized.date);
  if (!Number.isSafeInteger(now) || now < 0) throw new DiaryPublicationError(503, 'INVALID_CLOCK', '服务时间无效');
  try {
    const author = await authorFor(env.SITE_DB, config.authorId, now);
    const prior = await registryFor(env.SITE_DB, normalized.channel, normalized.date);
    if (prior) return existingResult(env.SITE_DB, prior, await requestDigest(normalized, prior.snapshot_id), config);
    validateDiaryDate(normalized.date, now, { test: normalized.test });
    const packet = await validatedPacket(env.DB, normalized, now);
    const requestHash = await requestDigest(normalized, packet.snapshotId);
    const nonce = crypto.randomUUID(), registryId = crypto.randomUUID();
    const activeAuthor = `(u.status IS NULL OR u.status<>'banned' OR (u.ban_expires_at IS NOT NULL AND u.ban_expires_at>0 AND u.ban_expires_at<=?))`;
    try {
      // All blog writes below use one SITE_DB transaction. Private DB source
      // validation is read-only; this does not claim cross-database atomicity.
      await env.SITE_DB.batch([
        env.SITE_DB.prepare(`INSERT INTO ai_diary_registry
          (channel,date,registry_id,claim_nonce,author_id,author_name,snapshot_id,source_manifest_id,source_hash,
           request_hash,request_title,request_content,state,created_at)
          SELECT ?,?,?,?,u.id,?,?,?,?,?,?,?,'CLAIMED',? FROM users u
          WHERE u.id=? AND ${activeAuthor} ON CONFLICT(channel,date) DO NOTHING`)
          .bind(normalized.channel, normalized.date, registryId, nonce, author.nickname || author.username,
            packet.snapshotId, normalized.sourceManifestId, packet.sourceHash, requestHash,
            normalized.title, normalized.content, now, config.authorId, now),
        env.SITE_DB.prepare(`INSERT INTO posts(user_id,author_name,title,content,category,mood,created_at)
          SELECT r.author_id,r.author_name,r.request_title,r.request_content,'生活',NULL,r.created_at
          FROM ai_diary_registry r JOIN users u ON u.id=r.author_id
          WHERE r.channel=? AND r.date=? AND r.claim_nonce=? AND r.state='CLAIMED'
          AND r.request_hash=? AND u.id=? AND ${activeAuthor}`)
          .bind(normalized.channel, normalized.date, nonce, requestHash, config.authorId, now),
        // last_insert_rowid()/changes() refer to the immediately preceding
        // INSERT in this same SQLite transaction, never to a separate request.
        env.SITE_DB.prepare(`UPDATE ai_diary_registry SET state='PUBLISHED',post_id=last_insert_rowid()
          WHERE channel=? AND date=? AND claim_nonce=? AND state='CLAIMED' AND changes()=1
          AND request_hash=? AND EXISTS(SELECT 1 FROM posts p WHERE p.id=last_insert_rowid()
            AND p.user_id=ai_diary_registry.author_id AND p.author_name=ai_diary_registry.author_name
            AND p.title=ai_diary_registry.request_title AND p.content=ai_diary_registry.request_content
            AND p.category='生活' AND p.created_at=ai_diary_registry.created_at)`)
          .bind(normalized.channel, normalized.date, nonce, requestHash),
        env.SITE_DB.prepare(`INSERT INTO ai_diary_publication_commits(claim_nonce,channel,date,created_at,invariant_ok)
          VALUES(?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM ai_diary_registry r
            JOIN posts p ON p.id=r.post_id JOIN users u ON u.id=r.author_id
            WHERE r.channel=? AND r.date=? AND r.claim_nonce=? AND r.state='PUBLISHED'
            AND r.author_id=? AND r.request_hash=? AND r.source_manifest_id=? AND r.snapshot_id=?
            AND p.user_id=r.author_id AND p.author_name=r.author_name AND p.created_at=r.created_at
            AND p.title=r.request_title AND p.content=r.request_content AND p.category='生活'
            AND NOT EXISTS(SELECT 1 FROM content_recycle c WHERE c.kind='post' AND c.target_id=p.id)
            AND ${activeAuthor}) THEN 1 ELSE 0 END)`)
          .bind(nonce, normalized.channel, normalized.date, now, normalized.channel, normalized.date, nonce,
            config.authorId, requestHash, normalized.sourceManifestId, packet.snapshotId, now)
      ]);
    } catch (error) {
      // A concurrent request can win the channel/day before our atomic claim.
      const winner = await registryFor(env.SITE_DB, normalized.channel, normalized.date);
      if (winner) return existingResult(env.SITE_DB, winner, requestHash, config);
      await authorFor(env.SITE_DB, config.authorId, now);
      throw new DiaryPublicationError(503, 'PUBLISH_FAILED', '帖子未提交，可使用原请求重试', { cause: error });
    }
    const committed = await registryFor(env.SITE_DB, normalized.channel, normalized.date);
    if (!committed) throw new DiaryPublicationError(503, 'PUBLISH_FAILED', '发表登记没有完整提交');
    return await existingResult(env.SITE_DB, committed, requestHash, config, nonce);
  } catch (error) {
    if (error instanceof DiaryPublicationError) throw error;
    throw new DiaryPublicationError(503, 'PUBLISH_FAILED', '网站发布暂时不可用', { cause: error });
  }
}
