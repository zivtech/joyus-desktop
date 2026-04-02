# Data Model: Managed Tooling Distribution

**Feature**: 008-managed-tooling-distribution
**Date**: 2026-04-01

## Entities

### DistributionManifest

The top-level contract served by the control plane per tenant.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| schema_version | string | yes | Manifest schema version (e.g., "1.0") |
| tenant_id | string | yes | Tenant identifier |
| bundles | Record<string, ManifestBundle> | yes | Named bundles of managed tooling |
| config_path | string | no | Override path for tenant config file (default: `~/.claude/.joyus-config.json`) |

**Validation**: schema_version must be a recognized version. bundles must not be empty unless this is a revocation manifest.

### ManifestBundle

A group of related managed entries distributed together.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| version | string | yes | Bundle version tag |
| hooks | ManifestHook[] | no | Hook entries to install |
| mcpServers | ManifestMcpServer[] | no | MCP server entries to install |
| config | Record<string, unknown> | no | Tenant config parameters for this bundle |

### ManifestHook

A single managed hook declaration.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | yes | Unique identifier with `joyus:` prefix |
| event | HookEventType | yes | Claude Code hook event type |
| matcher | string | yes | Matcher pattern (typically same as id) |
| command | string | yes | Shell command to execute |
| timeout | number | no | Timeout in seconds (default: 5) |
| target | "global" \| "project" | no | Settings scope (default: "global") |

**Validation**: id must start with `joyus:`. event must be a valid Claude Code hook event type. command must not be empty.

### ManifestMcpServer

A single managed MCP server declaration.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | yes | Unique identifier with `joyus:` prefix |
| command | string | yes | Server command |
| args | string[] | no | Command arguments |
| env | Record<string, string> | no | Environment variables |
| target | "global" \| "project" | no | Settings scope (default: "global") |

**Validation**: id must start with `joyus:`. command must not be empty.

### ManagedRegistry

The sidecar file tracking all managed entries.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| schema_version | string | yes | Registry schema version (e.g., "1.0") |
| entries | Record<string, RegistryEntry> | yes | Map of entry ID to metadata |
| last_reconciled | string | yes | ISO timestamp of last successful reconciliation |

### RegistryEntry

Metadata for a single managed entry in the registry.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| type | "hook" \| "mcp" | yes | Entry type |
| bundle | string | yes | Source bundle name |
| manifest_version | string | yes | Version that installed this entry |
| event | HookEventType | conditional | Hook event type (required if type is "hook") |
| target | "global" \| "project" | yes | Which settings file this entry lives in |
| installed_at | string | yes | ISO timestamp of installation |

### TenantConfig

Per-tenant configuration written to a local file for hook scripts to read.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| tenant_id | string | yes | Tenant identifier |
| parameters | Record<string, unknown> | yes | Merged config from all bundles |
| updated_at | string | yes | ISO timestamp of last update |

**File location**: `~/.claude/.joyus-config.json` (default, overridable via manifest `config_path`)

### HookEventType (enum)

Valid Claude Code hook event types:

- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`
- `UserPromptSubmit`
- `SessionStart`
- `SessionEnd`
- `PreCompact`
- `Stop`
- `SubagentStart`
- `SubagentStop`
- `PermissionRequest`

## State Transitions

### Reconciliation Lifecycle

```
idle
  │
  ├─── config poll detects change ──→ syncing
  │                                      │
  │                                      └─── syncSkills() completes ──→ reconciling
  │                                                                          │
  │                                      ┌───────────────────────────────────┘
  │                                      │
  │                                      ├─── success ──→ idle (registry updated)
  │                                      │
  │                                      └─── failure ──→ rolled_back ──→ idle
  │
  └─── config poll unreachable ──→ idle (no change, log warning)
```

### Managed Entry Lifecycle

```
not_present ──→ installed (manifest adds entry)
                    │
                    ├─── manifest updates entry ──→ updated (same ID, new config)
                    │
                    ├─── manifest removes entry ──→ removed (cleaned from settings + registry)
                    │
                    └─── bundle revoked ──→ removed (all entries in bundle cleaned)
```
