-- Additive migration: existing accounts and the legacy invites table are retained.
CREATE TABLE IF NOT EXISTS registration_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64),
  code_hint TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  used_by INTEGER REFERENCES users(id),
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_registration_invites_created ON registration_invites(created_at);
INSERT INTO system_settings(key, value) VALUES('registration_mode', 'invite')
  ON CONFLICT(key) DO NOTHING;
