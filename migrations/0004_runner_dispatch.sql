CREATE TABLE IF NOT EXISTS runner_dispatches (
  dispatch_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  task_ref TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  required_capabilities_json TEXT NOT NULL,
  priority INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 100),
  quota_key TEXT,
  lease_seconds INTEGER NOT NULL CHECK (lease_seconds BETWEEN 60 AND 900),
  status TEXT NOT NULL CHECK (status IN ('queued','offered','accepted','cancel_requested','held','closed','cancelled')),
  runner_id TEXT REFERENCES runners(runner_id),
  lease_id TEXT,
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  offered_at INTEGER,
  offer_expires_at INTEGER,
  accepted_at INTEGER,
  closed_at INTEGER,
  quota_reserved INTEGER NOT NULL DEFAULT 0 CHECK (quota_reserved IN (0,1)),
  runtime_sequence INTEGER NOT NULL DEFAULT 0,
  runtime_state TEXT CHECK (runtime_state IS NULL OR runtime_state IN ('not_started','running','side_effects_uncertain','completed','cancelled','failed')),
  last_reason_code TEXT
);
CREATE INDEX IF NOT EXISTS idx_runner_dispatch_queue ON runner_dispatches(status,priority DESC,created_at);
CREATE INDEX IF NOT EXISTS idx_runner_dispatch_runner ON runner_dispatches(runner_id,status,quota_key);

ALTER TABLE runner_leases ADD COLUMN dispatch_id TEXT REFERENCES runner_dispatches(dispatch_id);
CREATE INDEX IF NOT EXISTS idx_runner_lease_dispatch ON runner_leases(dispatch_id,released_at);

CREATE TABLE IF NOT EXISTS runner_quota_reports (
  runner_id TEXT NOT NULL REFERENCES runners(runner_id),
  quota_key TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  remaining INTEGER NOT NULL CHECK (remaining BETWEEN 0 AND 1000000),
  quota_limit INTEGER NOT NULL CHECK (quota_limit BETWEEN 1 AND 1000000),
  cooldown_until INTEGER,
  observed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (runner_id, quota_key),
  CHECK (remaining <= quota_limit)
);
CREATE INDEX IF NOT EXISTS idx_runner_quota_freshness ON runner_quota_reports(quota_key,expires_at,cooldown_until,remaining);
