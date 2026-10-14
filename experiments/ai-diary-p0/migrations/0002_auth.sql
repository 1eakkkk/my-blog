CREATE TABLE IF NOT EXISTS auth_tickets (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE TABLE IF NOT EXISTS revoked_grants (
  grant_id TEXT PRIMARY KEY,
  revoked_at INTEGER NOT NULL
);
