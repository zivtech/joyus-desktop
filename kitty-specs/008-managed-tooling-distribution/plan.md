# Implementation Plan: Managed Tooling Distribution

**Branch**: `feat/008-managed-tooling-distribution` | **Date**: 2026-04-01 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/kitty-specs/008-managed-tooling-distribution/spec.md`

## Summary

Extend joyus-desktop to manage the full local tooling lifecycle — not just skill files, but Claude Code hooks, MCP server entries, per-tenant configuration, and revocation. A new `packages/settings-reconciler` package reads a distribution manifest from the control plane and non-destructively merges managed entries into settings files. Desktop-companion orchestrates the pipeline: `syncSkills()` → `reconcile()`, with a sidecar polling the control plane for config changes on a 5-minute interval.

## Technical Context

**Language/Version**: TypeScript 5.x, strict mode, ESM, ES2022 target
**Primary Dependencies**: Node.js built-ins (fs, path, crypto). No external runtime dependencies.
**Storage**: Filesystem (JSON files: settings.json, .mcp.json, .joyus-managed.json)
**Testing**: Vitest, v8 coverage provider, 100% threshold on lines/functions/branches/statements
**Target Platform**: macOS, Windows (matching existing joyus-desktop targets)
**Project Type**: pnpm monorepo workspace package + desktop-companion sidecar integration
**Performance Goals**: Reconciliation completes in <500ms for typical manifest sizes (<50 entries)
**Constraints**: Non-destructive merge — zero user data loss. Atomic writes with rollback on failure.
**Scale/Scope**: Tens of managed entries per tenant, single machine

## Constitution Check

*Skipped — no constitution defined for this project.*

## Project Structure

### Documentation (this feature)

```
kitty-specs/008-managed-tooling-distribution/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── distribution-manifest.ts    # Manifest type definitions
│   ├── managed-registry.ts         # Registry type definitions
│   └── reconciler-api.ts           # Reconciler public API
└── tasks.md             # Phase 2 output (NOT created by /spec-kitty.plan)
```

### Source Code (repository root)

```
packages/settings-reconciler/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # Public API exports
│   ├── manifest.ts                 # Manifest parsing and validation
│   ├── registry.ts                 # Sidecar registry read/write/repair
│   ├── reconciler.ts               # Core merge logic (hooks + MCPs)
│   ├── settingsFile.ts             # Settings.json read/write with backup/rollback
│   └── tenantConfig.ts             # Tenant config file write
└── test/
    ├── manifest.test.ts
    ├── registry.test.ts
    ├── reconciler.test.ts
    ├── settingsFile.test.ts
    └── tenantConfig.test.ts

apps/desktop-companion/
└── src/
    └── sidecar/
        └── configCheckPoller.ts    # Config-check poll loop (new sidecar module)
```

**Structure Decision**: New `packages/settings-reconciler` package following the same layout as existing packages (skill-sync, policy-client, etc.). One new sidecar module in desktop-companion for the poll loop. skill-sync is not modified — orchestration is the caller's responsibility.

## Architecture

### Data Flow

```
Control Plane API
    │
    ├─── [5min poll] ──→ configCheckPoller (desktop-companion sidecar)
    │                         │
    │                         ├─── version changed? ──→ syncSkills() (skill-sync)
    │                         │                              │
    │                         │                              └─── files synced to ~/.claude/skills/
    │                         │
    │                         └─── reconcile() (settings-reconciler)
    │                                   │
    │                                   ├─── read manifest from control plane
    │                                   ├─── read current settings.json
    │                                   ├─── read sidecar registry
    │                                   ├─── compute diff (add/update/remove managed entries)
    │                                   ├─── backup settings.json
    │                                   ├─── write merged settings.json (atomic)
    │                                   ├─── write tenant config files
    │                                   └─── update sidecar registry
    │
    └─── [on-demand] ──→ same pipeline (triggered by revocation flag)
```

### Dependency Graph

```
apps/desktop-companion
├── packages/settings-reconciler  (new)
├── packages/skill-sync           (existing, unchanged)
└── packages/policy-client        (existing, for control plane fetch)

packages/settings-reconciler
└── (no workspace dependencies — pure library using Node built-ins)
```

### Key Design Decisions

1. **No coupling between skill-sync and settings-reconciler**: Desktop-companion calls them sequentially. Neither knows about the other. This keeps both packages testable in isolation.

2. **Manifest served by control plane, not embedded in repo**: The manifest is tenant-specific (different bundles, different config values). Serving it from the control plane avoids repo-per-tenant branching. The control plane already serves `DistributionConfig` — the manifest is an extension of that response.

3. **Atomic settings writes with rollback**: Read → backup → compute → write new file. If write fails, restore from backup. Never leave a partial file on disk. Use write-to-temp-then-rename for atomicity.

4. **Registry as repair tool, not single source of truth**: The `joyus:` prefix is the canonical ownership signal. The registry accelerates lookups but can be rebuilt from prefix scanning if corrupted or missing.

5. **Hook format: append matcher groups**: Claude Code hooks are arrays of matcher groups per event type. Managed hooks are appended as additional entries in the array, never replacing existing entries. Each managed entry includes `joyus:` in the matcher pattern for identification.

6. **Config-check poll is a thin sidecar**: The poller just fetches a lightweight config endpoint, compares versions, and triggers the sync+reconcile pipeline if changed. All logic lives in the libraries.

### Hook Entry Format

Managed hooks follow the Claude Code plugin hooks schema:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "joyus:chat-length-guard",
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/skills/joyus-hooks/chat-length-guard.mjs",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

The `joyus:` prefix in the matcher identifies it as managed. The reconciler merges these into the existing hooks object, preserving all non-`joyus:` entries.

### MCP Entry Format

Managed MCP entries in settings.json:

```json
{
  "mcpServers": {
    "joyus:project-docs": {
      "command": "node",
      "args": ["~/.claude/skills/joyus-mcps/project-docs-server.mjs"],
      "env": { "DOCS_ROOT": "/path/to/docs" }
    }
  }
}
```

The `joyus:` key prefix identifies ownership.

### Sidecar Registry Format

`.claude/.joyus-managed.json`:

```json
{
  "schema_version": "1.0",
  "entries": {
    "joyus:chat-length-guard": {
      "type": "hook",
      "bundle": "core-hooks",
      "manifest_version": "v1.2.0",
      "event": "PreToolUse",
      "target": "global",
      "installed_at": "2026-04-01T12:00:00Z"
    },
    "joyus:project-docs": {
      "type": "mcp",
      "bundle": "project-tools",
      "manifest_version": "v2.0.0",
      "target": "global",
      "installed_at": "2026-04-01T12:00:00Z"
    }
  },
  "last_reconciled": "2026-04-01T12:00:00Z"
}
```

### Distribution Manifest Format

Served by control plane per-tenant:

```json
{
  "schema_version": "1.0",
  "tenant_id": "tenant-abc",
  "bundles": {
    "core-hooks": {
      "version": "v1.2.0",
      "hooks": [
        {
          "id": "joyus:chat-length-guard",
          "event": "PreToolUse",
          "matcher": "joyus:chat-length-guard",
          "command": "node ~/.claude/skills/joyus-hooks/chat-length-guard.mjs",
          "timeout": 5,
          "target": "global"
        }
      ],
      "mcpServers": [],
      "config": {
        "max_messages": 25,
        "warning_threshold": 20
      }
    }
  },
  "config_path": "~/.claude/.joyus-config.json"
}
```

## Complexity Tracking

No constitution violations to justify.

## Phase 0: Research

See [research.md](research.md) for detailed findings.

**Key decisions from research:**
- Settings.json write atomicity via write-to-temp-then-rename (Node `fs.rename` is atomic on POSIX, near-atomic on Windows NTFS)
- Hook matcher format confirmed: array of `{ matcher, hooks[] }` objects per event type
- MCP servers keyed by name in `mcpServers` object — `joyus:` prefix in the key is sufficient for ownership
- No need for JSON merge libraries — shallow merge by key with array append covers the hook/MCP shapes

## Phase 1: Design

See [data-model.md](data-model.md) for entity definitions.
See [contracts/](contracts/) for TypeScript type definitions.
