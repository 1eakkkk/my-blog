-- Production blog database only. Private source packets and OAuth stay in the
-- separate diary service database. Run after 002_recycle.sql.
CREATE TABLE IF NOT EXISTS ai_diary_registry (
  channel TEXT NOT NULL CHECK (channel IN ('ai-diary', 'ai-diary-test')),
  date TEXT NOT NULL,
  registry_id TEXT NOT NULL UNIQUE,
  claim_nonce TEXT NOT NULL UNIQUE,
  author_id INTEGER NOT NULL CHECK (author_id > 0),
  author_name TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  source_manifest_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  request_title TEXT NOT NULL,
  request_content TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('CLAIMED', 'PUBLISHED')),
  post_id INTEGER UNIQUE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (channel, date),
  CHECK (state <> 'PUBLISHED' OR post_id IS NOT NULL)
);

-- No foreign keys to posts/users: deleting a post or rebinding an AI account
-- must never release the date. Retries retain the original accepted request.
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

-- The last statement of the same SITE_DB.batch asserts the completed write.
-- CHECK failure rolls back a silent/no-op claim, insertion or finalization.
CREATE TABLE IF NOT EXISTS ai_diary_publication_commits (
  claim_nonce TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('ai-diary', 'ai-diary-test')),
  date TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  invariant_ok INTEGER NOT NULL CHECK (invariant_ok = 1),
  UNIQUE (channel, date)
);
