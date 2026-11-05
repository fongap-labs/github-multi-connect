CREATE TABLE IF NOT EXISTS runners (
  runner_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  allowed_capabilities_json TEXT NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  max_concurrency_limit INTEGER NOT NULL CHECK (max_concurrency_limit BETWEEN 1 AND 128),
  max_concurrency INTEGER,
  active_concurrency INTEGER,
  heartbeat_sequence INTEGER,
  observed_at INTEGER,
  expires_at INTEGER,
  registered_at INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS runner_credentials (
  credential_id TEXT PRIMARY KEY,
  runner_id TEXT NOT NULL REFERENCES runners(runner_id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_runner_credentials_runner ON runner_credentials(runner_id, revoked_at);

CREATE TABLE IF NOT EXISTS runner_leases (
  lease_id TEXT PRIMARY KEY,
  runner_id TEXT NOT NULL REFERENCES runners(runner_id),
  idempotency_key TEXT NOT NULL UNIQUE,
  resource_key TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  released_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_runner_leases_capacity ON runner_leases(runner_id, released_at, expires_at);
