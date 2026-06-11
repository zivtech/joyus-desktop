# Data Model: Skill & MCP Server Distribution

**Feature**: 003-skill-mcp-distribution
**Updated**: 2026-03-10

---

## Entities

### SkillBundle

A named collection of skills assigned to a user group.

| Attribute | Type | Notes |
|-----------|------|-------|
| id | string | e.g. `"pm-bundle"`, `"developer-bundle"`, `"partner-bundle"` |
| version | string | Git tag pinned by admin, e.g. `"v1.0.0"` |
| skills | string[] | List of skill filenames included in this bundle |
| targetOrg | string | `"zivtech"` or `"partner-org"` |
| targetRoles | string[] | e.g. `["pm", "coo"]` |

**Storage**: Owned by joyus-ai distribution config API (`GET /api/distribution/config`). Bundle manifests also checked into `zivtech-meta-skills/config/bundles/`.

---

### DistributionConfig

The current admin-managed configuration for all distribution channels.

| Attribute | Type | Notes |
|-----------|------|-------|
| schema_version | string | `"1"` — versioned for forward compat |
| default_version | string | Fallback version if bundle has no explicit pin |
| bundles | Record<string, BundlePin> | Map of bundle id → version pin |
| governance.mode | `"audit"` \| `"enforce"` | Policy enforcement mode |
| updated_at | ISO 8601 string | Last admin update timestamp |

**Storage**: joyus-ai database. Served via `GET /api/distribution/config`.

---

### SyncMetadata

Tracks the last successful sync for a Claude Code CLI user.

| Attribute | Type | Notes |
|-----------|------|-------|
| version | string | Last successfully synced git tag |
| syncedAt | number | Unix epoch ms |
| bundleName | string | Which bundle was synced |
| filesHash | string | SHA of synced file manifest (detects content drift) |

**Storage**: `~/.claude/.skill-sync-cache/.sync-metadata.json` on user's machine.

---

### McpServerRegistration

A local MCP server managed by the desktop companion.

| Attribute | Type | Notes |
|-----------|------|-------|
| id | string | e.g. `"axe-core"`, `"lighthouse"` |
| command | string | Executable path |
| args | string[] | CLI arguments |
| transport | `"stdio"` | Always stdio for local servers |
| version | string | Currently installed version |
| pid | number \| null | Running process PID; null if stopped |
| managedBy | `"joyus-desktop"` | Marker written to `.mcp.json` |

**Storage**: Persisted in `.mcp.json` (Claude Code's MCP config) with `_managed_by: "joyus-desktop"` marker. In-memory PID tracking in `packages/mcp-registry/`.

---

### TelemetryEvent

A structured record of a skill invocation or MCP tool call.

| Attribute | Type | Notes |
|-----------|------|-------|
| id | UUID | Generated at emission |
| schema_version | `"v1"` | For forward compat |
| event_type | `"skill.invoked"` \| `"mcp.tool_called"` \| `"sync.completed"` | Event category |
| user_id | string | Opaque user identifier (no PII) |
| org_id | string | `"zivtech"` or `"partner-org"` |
| skill_name \| tool_name | string | Which skill or MCP tool was used |
| outcome | `"success"` \| `"failure"` | Result |
| timestamp | ISO 8601 string | When the event occurred |
| duration_ms | number \| null | For latency tracking |

**Storage**: Sent to `POST /api/telemetry/events` on joyus-ai. Persisted to joyus-ai database. Never stored locally beyond the async queue (feature 005 WP04 event emitter).

---

## Relationships

```
DistributionConfig
  └── bundles: SkillBundle[]        (1 config → many bundles)

SkillBundle
  └── version → zivtech-meta-skills git tag   (points to external repo)
  └── skills[] → skill .md files              (resolved at sync time)

User (Cowork)
  └── assigned bundles → SkillBundle[]        (via Cowork admin panel)

User (CLI)
  └── SyncMetadata                            (one per machine)
  └── synced skills → ~/.claude/skills/       (local filesystem)

Desktop Companion
  └── McpServerRegistration[]                 (one per local MCP server)
  └── writes → .mcp.json                      (Claude Code integration)
  └── emits → TelemetryEvent[]                (via async event emitter)

TelemetryEvent
  └── routed to → POST /api/telemetry/events  (joyus-ai)
```

---

## External Dependencies

| System | Role | Interface |
|--------|------|-----------|
| `zivtech-meta-skills` repo | Source of truth for skill content | Git clone/fetch at pinned tag |
| `zivtech-mcp-tools` repo | Source of local MCP server binaries | npm package or binary download |
| joyus-ai | Distribution config + telemetry ingestion | REST API (authenticated) |
| Claude Code `.mcp.json` | MCP server registration for CLI | JSON file at `~/.claude/.mcp.json` |
| Cowork admin panel | Skill bundle assignment to users | Manual admin action (no API) |
