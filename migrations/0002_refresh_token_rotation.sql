-- Add a revocable, time-bounded OAuth grant (refresh-token family).
-- Previous access tokens remain valid until their short original expiry.
ALTER TABLE oauth_clients ADD COLUMN grant_types TEXT NOT NULL DEFAULT '["authorization_code"]';
ALTER TABLE oauth_clients ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE oauth_auth_requests ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE oauth_codes ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE oauth_access_tokens ADD COLUMN grant_id TEXT;
ALTER TABLE oauth_access_tokens ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS oauth_grants (
  grant_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  scope TEXT NOT NULL,
  auth_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  absolute_expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_oauth_grants_client ON oauth_grants(client_id,revoked_at);

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  FOREIGN KEY (grant_id) REFERENCES oauth_grants(grant_id)
);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_family ON oauth_refresh_tokens(grant_id);
CREATE INDEX IF NOT EXISTS idx_oauth_access_grant ON oauth_access_tokens(grant_id);
