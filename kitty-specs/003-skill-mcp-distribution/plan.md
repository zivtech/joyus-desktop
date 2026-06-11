# Implementation Plan: Skill & MCP Server Distribution

**Branch**: `003-skill-mcp-distribution` | **Date**: 2026-03-10 | **Spec**: [`spec.md`](spec.md)
**Input**: Feature specification from `kitty-specs/003-skill-mcp-distribution/spec.md`

## Summary

Distribute 29 prompt-only skills from `zivtech-meta-skills` and first-party/custom MCP servers to non-developer team members across Zivtech and Partner Org. Phase 1 delivers Cowork plugin distribution and CLI git sync. Phase 2 adds desktop companion for local MCP server provisioning. Architecture centers on joyus-ai as the control plane for both telemetry aggregation and distribution config, with two new workspace packages in joyus-desktop (`packages/skill-sync/` and `packages/mcp-registry/`).

## Technical Context

**Language/Version**: TypeScript 5.x (Node 20+)
**Primary Dependencies**: Electron (joyus-desktop), Claude Cowork Plugin API, joyus-ai REST API
**Storage**: joyus-ai database (telemetry events, distribution config) — existing infrastructure
**Testing**: Vitest (or Jest, matching existing joyus-desktop convention); 100% coverage mandatory per constitution 2.5
**Target Platform**: macOS (desktop companion), Claude Cowork web (plugins), Claude Code CLI (sync hook)
**Project Type**: Monorepo with workspace packages
**Performance Goals**: Git sync <10s warm cache (NFR-002), companion install <5 min (NFR-003)
**Constraints**: Telemetry must not block user sessions (NFR-004), offline-capable sync (FR-006)
**Scale/Scope**: ~20 users across 2 orgs, 29 skills, 5 local MCP servers, 6 cloud MCP connectors

## Architecture Decisions

### AD-001: Telemetry Aggregation → joyus-ai

**Decision**: Add a telemetry ingestion endpoint to the existing joyus-ai server.
**Rationale**: Consolidates infrastructure. joyus-ai already has a database and auth layer. Avoids standing up a separate service for <100 users.
**Endpoint**: `POST /api/telemetry/events` — accepts single or batch events, API key auth, 202 Accepted (async processing).
**Schema**: Defined in WP05 T024. Versioned as `v1`. No PII beyond user_id/org_id.

### AD-002: Distribution Config → joyus-ai API

**Decision**: Admin manages version pins via a joyus-ai API endpoint, not a git file.
**Rationale**: Most flexible long-term. Decouples config from skill content. Enables future admin UI. Clients (Cowork, CLI sync, desktop companion) all read from the same endpoint.
**Endpoint**: `GET /api/distribution/config` — returns current version pins per bundle. `PUT /api/distribution/config` — admin updates pins (authenticated).
**Response shape**:
```json
{
  "schema_version": "1",
  "default_version": "v1.0.0",
  "bundles": {
    "pm-bundle": { "version": "v1.0.0" },
    "developer-bundle": { "version": "v1.0.0" },
    "partner-bundle": { "version": "v1.0.0" },
    "full-bundle": { "version": "v1.0.0" }
  },
  "governance": {
    "mode": "audit"
  },
  "updated_at": "2026-03-10T00:00:00Z"
}
```

### AD-003: Sync Module → Node.js Workspace Package

**Decision**: `packages/skill-sync/` in joyus-desktop — TypeScript Node module.
**Rationale**: Shared by CLI session hook (called via `node`) and desktop companion (direct import). TypeScript gives type safety and testability. Workspace package follows existing `packages/updater` convention.
**Key interfaces**:
```typescript
interface SyncConfig {
  repoUrl: string;
  configEndpoint: string;  // joyus-ai distribution config URL
  destDir: string;         // ~/.claude/skills/
  cacheDir: string;        // ~/.claude/.skill-sync-cache/
  bundleName: string;      // which bundle this client should sync
  apiKey: string;          // for config endpoint auth
}

interface SyncResult {
  status: 'synced' | 'up-to-date' | 'offline' | 'error';
  version: string;
  filesUpdated: number;
  duration: number;
}

function syncSkills(config: SyncConfig): Promise<SyncResult>;
```

### AD-004: MCP Registry → Workspace Package

**Decision**: `packages/mcp-registry/` in joyus-desktop.
**Rationale**: Clean separation from Electron app code. Own test suite. Follows `packages/` convention. Manages MCP server lifecycle, Claude Code `.mcp.json` integration, updater integration, process management, and governance/telemetry wiring.
**Key modules**:
- `src/index.ts` — McpRegistry class (register, start, stop, list)
- `src/process-manager.ts` — child process lifecycle, PID tracking, orphan cleanup
- `src/claude-code-integration.ts` — `.mcp.json` merge with `_managed_by` markers
- `src/updater-integration.ts` — version checks via `packages/updater`
- `src/skill-sync-integration.ts` — wraps `packages/skill-sync` for Electron lifecycle
- `src/governance-integration.ts` — policy enforcement via feature 001 framework
- `src/telemetry-integration.ts` — event routing to joyus-ai endpoint

## Constitution Check

*Source: `spec/constitution.md` v1.0 (2026-03-05)*

| Principle | Status | Detail |
|-----------|--------|--------|
| 2.1 Open-Core Compatibility | **PASS** | Desktop clients consume joyus-ai control-plane contracts (config API, telemetry API). No lock-in — Cowork distribution works without desktop. |
| 2.2 No Desktop Lock-In | **PASS** | FR-014: Cowork skills and cloud MCPs function without desktop. Local MCP provisioning is additive convenience, not core mediation. Control-plane contracts (GET /api/distribution/config, POST /api/telemetry/events) documented. |
| 2.3 Security-First | **PASS** | WP09 enforces governance policies on local MCPs. Fail-closed in enforce mode. API endpoints require authentication. |
| 2.4 Runtime Separation | **N/A** | This feature doesn't change tenant runtime routing. |
| 2.5 Full Coverage Gates | **PASS** | Test subtasks T065-T069 added to all code-producing WPs. 100% coverage mandatory in Done Criteria. |
| 2.6 Incremental Delivery | **PASS** | Feature 001 (policy enforcement) shipped first. This feature is packaging/convenience — consistent with principle. |

## Project Structure

### Documentation (this feature)

```
kitty-specs/003-skill-mcp-distribution/
├── spec.md              # Feature specification
├── plan.md              # This file
├── tasks.md             # Work package index (11 WPs, 69 subtasks)
└── tasks/               # WP prompt files
    ├── WP01-skill-packaging.md
    ├── WP02-mcp-connector-setup.md
    ├── WP03-git-sync.md
    ├── WP04-version-pinning.md
    ├── WP05-telemetry.md
    ├── WP06-mcp-tools-fixes.md
    ├── WP07-desktop-mcp-provisioning.md
    ├── WP08-desktop-git-sync.md
    ├── WP09-governance-telemetry.md
    ├── WP10-phase1-verification.md
    └── WP11-phase2-verification.md
```

### Source Code (new packages in joyus-desktop)

```
packages/
├── skill-sync/                    # NEW — Git-based skill sync module
│   ├── src/
│   │   ├── index.ts               # syncSkills() entry point
│   │   ├── sync.ts                # Core clone/fetch/checkout logic
│   │   ├── metadata.ts            # .sync-metadata.json management
│   │   ├── config-client.ts       # Fetch config from joyus-ai API
│   │   ├── conflict.ts            # Local modification detection + backup
│   │   └── __tests__/
│   │       ├── sync.test.ts
│   │       ├── metadata.test.ts
│   │       └── config-client.test.ts
│   ├── package.json
│   └── tsconfig.json
│
├── mcp-registry/                  # NEW — Local MCP server lifecycle manager
│   ├── src/
│   │   ├── index.ts               # McpRegistry class
│   │   ├── types.ts               # Interfaces
│   │   ├── lifecycle.ts           # Start/stop orchestration
│   │   ├── process-manager.ts     # PID tracking, orphan cleanup, watchdog
│   │   ├── claude-code-integration.ts  # .mcp.json merge
│   │   ├── updater-integration.ts # Version checks via packages/updater
│   │   ├── skill-sync-integration.ts   # Electron lifecycle wrapper
│   │   ├── governance-integration.ts   # Policy enforcement
│   │   ├── telemetry-integration.ts    # Event routing
│   │   └── __tests__/
│   │       ├── registry.test.ts
│   │       ├── process-manager.test.ts
│   │       ├── claude-code-integration.test.ts
│   │       ├── skill-sync-integration.test.ts
│   │       ├── governance-integration.test.ts
│   │       └── telemetry-integration.test.ts
│   ├── package.json
│   └── tsconfig.json
│
└── updater/                       # EXISTING — Extended for MCP updates
```

### External Repositories (not in joyus-desktop)

```
zivtech-meta-skills/               # EXTERNAL — Skill source repo
├── skills/                        # 29 prompt-only skill files
├── CHANGELOG.md                   # NEW — Version history
└── config/bundles/                # NEW — Bundle manifests (JSON)

zivtech-mcp-tools/                 # EXTERNAL — MCP server monorepo
├── packages/axe-core/             # Bug fixes in WP06
├── packages/lighthouse/
├── packages/readability/
├── packages/screenshot/
├── packages/eval-runner/
├── packages/shared/               # Governance + telemetry wiring
└── tsconfig.base.json             # NEW — Shared TS config

joyus-ai/                          # EXTERNAL — Control plane server
└── src/api/
    ├── telemetry/                 # NEW — POST /api/telemetry/events
    └── distribution/              # NEW — GET/PUT /api/distribution/config
```

**Structure Decision**: Multi-repo architecture. joyus-desktop gets two new workspace packages. joyus-ai gets two new API endpoints. Two external repos (zivtech-meta-skills, zivtech-mcp-tools) require changes but are not managed by spec-kitty worktrees.

## Data Flow

```
                                    ┌─────────────────┐
                                    │   joyus-ai      │
                                    │  (control plane) │
                                    ├─────────────────┤
                                    │ GET /distribution│◄── Admin sets version pins
                                    │     /config      │
                                    │ POST /telemetry  │◄── All channels send events
                                    │     /events      │
                                    └────────┬────────┘
                                             │
                    ┌────────────────────────┼────────────────────────┐
                    │                        │                        │
             ┌──────▼──────┐         ┌──────▼──────┐         ┌──────▼──────┐
             │   Cowork    │         │  CLI Hook   │         │  Desktop    │
             │  (plugins)  │         │ (skill-sync)│         │ Companion   │
             ├─────────────┤         ├─────────────┤         ├─────────────┤
             │ Admin assigns│         │ On session  │         │ On startup: │
             │ skill bundles│         │ start: fetch│         │ - skill sync│
             │ via Cowork   │         │ config, sync│         │ - start MCPs│
             │ admin panel  │         │ skills from │         │ - register  │
             │              │         │ git at pin  │         │   in .mcp   │
             │ Cloud MCPs   │         │             │         │ - governance│
             │ via connectors│        │ Telemetry → │         │ - telemetry │
             └──────────────┘         │ joyus-ai    │         └─────────────┘
                                      └─────────────┘
```

## Phase Summary

| Phase | WPs | Delivers | Users Served |
|-------|-----|----------|-------------|
| Phase 1 — Cowork Distribution | WP01-WP05, WP10 | Skills in Cowork, cloud MCPs, CLI sync, version pinning, telemetry | All target users (PMs, COO, CEO, Dir of Ops, developers) |
| Phase 2 — Desktop Companion | WP06-WP09, WP11 | Local MCP servers (axe-core, lighthouse, screenshot), governance, desktop telemetry | Developers needing browser-based tools |

**MVP**: Phase 1 alone delivers value to all target users. Phase 2 is additive.

## Complexity Tracking

| Consideration | Decision | Rationale |
|--------------|----------|-----------|
| joyus-ai endpoint for config (vs git file) | Accept complexity | Decouples config from content, enables future admin UI, single source of truth |
| Two new workspace packages | Accept complexity | Clean separation, testable, follows existing convention |
| Multi-repo changes | Accept complexity | Necessary — skills, MCP tools, and desktop companion are in different repos. Well-scoped WP prompts mitigate coordination risk. |
