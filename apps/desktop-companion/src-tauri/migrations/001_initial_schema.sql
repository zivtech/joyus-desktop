CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL,
  duration_ms INTEGER,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_events_created_at ON usage_events(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_type_source ON usage_events(event_type, source);

CREATE TABLE IF NOT EXISTS server_state (
  name TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  pid INTEGER,
  version TEXT,
  restart_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  started_at TEXT,
  updated_at TEXT NOT NULL
);
