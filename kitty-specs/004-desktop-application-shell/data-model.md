# Data Model: Desktop Application Shell

**Feature**: 004-desktop-application-shell
**Storage**: SQLite via tauri-plugin-sql (local, per-user)
**Retention**: 30 days for usage data, permanent for app config

## Tables

### app_config

Stores application configuration and onboarding state.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| key | TEXT | PRIMARY KEY | Configuration key |
| value | TEXT | NOT NULL | JSON-encoded value |
| updated_at | TEXT | NOT NULL | ISO 8601 timestamp |

**Known keys**:
- `onboarding_complete`: boolean — whether first-run has finished
- `auth_token`: string — encrypted bearer token for control plane
- `tenant_id`: string — user's org tenant ID
- `workspace_id`: string — user's workspace ID
- `governance_mode`: string — current mode (off/audit/enforce)
- `last_sync_version`: string — last synced skill version
- `last_sync_at`: string — ISO 8601 timestamp of last sync
- `auto_start_enabled`: boolean — whether app starts on login
- `telemetry_opted_out`: boolean — user's telemetry preference

### usage_events

Stores local usage telemetry for dashboard display (30-day retention).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Event ID |
| event_type | TEXT | NOT NULL | Event category (tool_call, sync, governance_decision, server_event) |
| source | TEXT | NOT NULL | MCP server name or system component |
| action | TEXT | NOT NULL | Specific action (e.g., tool name, sync_start, server_crash) |
| outcome | TEXT | NOT NULL | Result (success, failure, blocked, timeout) |
| duration_ms | INTEGER | | Duration in milliseconds (nullable for non-timed events) |
| metadata | TEXT | | JSON-encoded additional data |
| created_at | TEXT | NOT NULL | ISO 8601 timestamp |

**Index**: `idx_usage_events_created_at` on `created_at` (for retention pruning and date-range queries)
**Index**: `idx_usage_events_type_source` on `(event_type, source)` (for dashboard aggregations)

**Retention**: Records older than 30 days are pruned on app startup and every 24 hours while running.

### server_state

Caches last-known MCP server state for dashboard display across restarts.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| name | TEXT | PRIMARY KEY | MCP server name |
| status | TEXT | NOT NULL | Last known status (running, stopped, error) |
| pid | INTEGER | | Process ID (nullable when stopped) |
| version | TEXT | | Server version |
| restart_count | INTEGER | NOT NULL DEFAULT 0 | Number of watchdog restarts this session |
| last_error | TEXT | | Last error message |
| started_at | TEXT | | ISO 8601 timestamp of last start |
| updated_at | TEXT | NOT NULL | ISO 8601 timestamp of last state change |

## State Transitions

### Application Lifecycle

```
[not_installed] → [installing] → [first_run] → [onboarding] → [running] → [updating] → [running]
                                                                    ↓
                                                              [uninstalling] → [cleanup_prompt] → [removed]
```

### MCP Server Lifecycle (per server)

```
[registered] → [starting] → [running] → [crashed] → [restarting] → [running]
                                ↓            ↓                          ↓
                           [stopping] → [stopped]          [max_restarts_exceeded] → [error]
```

## Relationships

- `app_config` is a key-value store — no foreign keys
- `usage_events` references MCP server names in `source` column but does not enforce FK (servers may be unregistered)
- `server_state` names correspond to mcp-registry server names
