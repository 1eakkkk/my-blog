-- Private publisher DB only. Never apply this migration to the blog DB.
CREATE TABLE IF NOT EXISTS diary_source_packets (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('ai-diary', 'ai-diary-test')),
  snapshot_id TEXT NOT NULL UNIQUE,
  manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
  messages_json TEXT NOT NULL CHECK (json_valid(messages_json)),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at AND expires_at <= created_at + 604800000),
  UNIQUE (channel, date)
);
CREATE INDEX IF NOT EXISTS diary_source_packet_expiry ON diary_source_packets(expires_at);
CREATE TRIGGER IF NOT EXISTS diary_source_packet_immutable
BEFORE UPDATE ON diary_source_packets
BEGIN
  SELECT RAISE(ABORT, 'Frozen diary sources cannot be overwritten');
END;

CREATE TABLE IF NOT EXISTS auth_tickets (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE TABLE IF NOT EXISTS revoked_grants (
  grant_id TEXT PRIMARY KEY,
  revoked_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS diary_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  date TEXT,
  grant_id TEXT,
  request_id TEXT,
  created_at INTEGER NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json))
);
CREATE INDEX IF NOT EXISTS diary_event_time ON diary_events(created_at);
