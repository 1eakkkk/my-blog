-- Isolated synthetic probe only. Do not apply this migration to the blog DB.
CREATE TABLE IF NOT EXISTS probe_source_manifests (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  snapshot_id TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL CHECK (version = 1),
  server_hash TEXT NOT NULL,
  message_count INTEGER NOT NULL CHECK (message_count >= 0),
  messages_json TEXT NOT NULL CHECK (json_valid(messages_json)),
  synthetic INTEGER NOT NULL DEFAULT 1 CHECK (synthetic = 1),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_diary_registry (
  channel TEXT NOT NULL CHECK (channel = 'diary-p0'),
  date TEXT NOT NULL,
  registry_id TEXT NOT NULL UNIQUE,
  snapshot_id TEXT NOT NULL,
  source_manifest_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  request_content TEXT NOT NULL,
  claim_nonce TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('CLAIMED', 'PUBLISHED')),
  post_id INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (channel, date),
  CHECK (state <> 'PUBLISHED' OR post_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS probe_diaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  registry_id TEXT NOT NULL UNIQUE,
  claim_nonce TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel = 'diary-p0'),
  date TEXT NOT NULL,
  author TEXT NOT NULL CHECK (author = 'AI 日记（隔离测试）'),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  source_manifest_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

-- No FK cascade: removing a test diary must never release its publication date.
CREATE TRIGGER IF NOT EXISTS ai_diary_registry_no_delete
BEFORE DELETE ON ai_diary_registry
BEGIN
  SELECT RAISE(ABORT, 'Diary publication registry is permanent');
END;

CREATE TRIGGER IF NOT EXISTS ai_diary_registry_published_immutable
BEFORE UPDATE ON ai_diary_registry
WHEN OLD.state = 'PUBLISHED'
BEGIN
  SELECT RAISE(ABORT, 'Published diary registry is immutable');
END;

CREATE TABLE IF NOT EXISTS probe_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  date TEXT,
  grant_id TEXT,
  request_id TEXT,
  created_at INTEGER NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  -- The final statement of a publish batch asserts its complete invariant here.
  -- A zero-row conditional write therefore causes a real transaction rollback.
  invariant_ok INTEGER NOT NULL DEFAULT 1 CHECK (invariant_ok = 1)
);
