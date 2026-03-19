# Research: Skill & MCP Server Distribution

**Feature**: 003-skill-mcp-distribution
**Researched**: 2026-03-10 (retroactive capture from spec.md + plan.md)
**Status**: Complete — all major decisions made, Phase 1 implementation underway

---

## Key Decisions

### D-001 — Transport Layer: HTTP-only for Cowork, stdio for Desktop

**Decision**: Cowork distribution uses HTTP/SSE transport only. Local MCP servers (axe-core, lighthouse, screenshot) remain stdio-only, managed by the desktop companion.

**Rationale**: Claude.ai/Cowork does not support stdio transport — browser security model forbids local process spawning. Browser-dependent MCP servers cannot be proxied without a hosted relay (added complexity, latency, security surface). Keeping stdio-only tools in the desktop companion avoids building and maintaining a relay service for ~20 users.

**Evidence**: Anthropic February 2026 announcements confirm Cowork connector catalog supports HTTP streamable-HTTP and SSE only. stdio documented as Claude Code CLI–only transport.

**Source**: SR-001

---

### D-002 — Distribution Config: joyus-ai API (not git file)

**Decision**: Admin manages version pins via `GET/PUT /api/distribution/config` on joyus-ai, not a committed file in the skill repo.

**Rationale**: Decouples admin configuration from skill content changes. All distribution channels (Cowork, CLI sync, desktop companion) read from one endpoint — no sync divergence. Enables future admin UI without repo access. joyus-ai already has auth and database infrastructure.

**Trade-off accepted**: adds a joyus-ai dependency for CLI sync (requires network to check pin on session start). Mitigated by caching last-known config so offline sessions use stale-but-safe version.

**Source**: SR-002

---

### D-003 — Skill Sync: Node.js workspace package, not shell script

**Decision**: `packages/skill-sync/` is a TypeScript Node module shared between the CLI session hook and the desktop companion.

**Rationale**: Shell scripts are hard to test, fail unpredictably across macOS versions, and can't be imported by the Electron companion. A typed Node module gets 100% vitest coverage, deterministic offline behavior, and is a first-class citizen in the monorepo.

**Key interface**:
```typescript
function syncSkills(config: SyncConfig): Promise<SyncResult>
// SyncResult.status: 'synced' | 'up-to-date' | 'offline' | 'error'
```

**Source**: SR-003

---

### D-004 — MCP Registry: separate workspace package

**Decision**: `packages/mcp-registry/` handles process lifecycle, `.mcp.json` integration, update checks, governance wiring, and telemetry routing.

**Rationale**: Keeps Electron app code thin. Own test suite. Follows existing `packages/updater` convention. Separates concerns cleanly so the registry can be unit-tested without Electron context.

**Source**: SR-003

---

### D-005 — Telemetry: POST /api/telemetry/events on joyus-ai

**Decision**: Single ingestion endpoint on joyus-ai. Schema versioned as `v1`. No PII beyond user_id/org_id. 202 Accepted (async processing).

**Rationale**: Reuses joyus-ai auth, database, and monitoring. Avoids a separate telemetry service for <100 users. NFR-004 (non-blocking) met by the async event emitter pattern (feature 005 WP04).

**Source**: SR-002

---

### D-006 — Phase Boundary: Cowork-first

**Decision**: Phase 1 (WP01–WP05 + WP10) delivers Cowork distribution, CLI sync, version pinning, and telemetry. Phase 2 (WP06–WP09 + WP11) adds desktop MCP provisioning and governance wiring.

**Rationale**: Phase 1 alone serves all 4 target user roles. Phase 2 is additive and requires zivtech-mcp-tools bug fixes (async/await, tsconfig) as a prerequisite. Shipping Phase 1 independently de-risks the overall feature.

**Source**: SR-001

---

### D-007 — Claude.ai ↔ Claude Code sync direction

**Decision**: MCP servers configured in claude.ai automatically appear in Claude Code (same account). The reverse does NOT apply. Desktop companion writes to Claude Code `.mcp.json` directly; Cowork connectors are admin-managed separately.

**Evidence**: Confirmed from February 2026 Anthropic platform documentation. claude.ai → Claude Code is one-directional.

**Source**: SR-001

---

## Open Questions / Risks

| # | Question | Impact | Status |
|---|----------|--------|--------|
| OQ-001 | Does Cowork's plugin system support prompt-only skills as slash commands without code execution? | High — blocks WP01 | Assumed yes per spec; needs validation against live Cowork admin panel before WP01 implementation |
| OQ-002 | OAuth consent flow for first-party MCPs (Atlassian, Slack, Google) — per-user or per-org? | Medium — affects UX | Plan assumes per-user OAuth consent on first use; needs confirmation from connector catalog docs |
| OQ-003 | zivtech-mcp-tools async/await and tsconfig bugs — severity and fix effort | High for Phase 2 | WP06 scoped to fix these; risk that additional bugs surface during WP07 |
| OQ-004 | Git sync lock file behavior under concurrent sessions | Medium | `packages/skill-sync` must handle concurrent Claude Code sessions without race conditions on `~/.claude/skills/` |
| OQ-005 | joyus-ai telemetry endpoint — exists or needs to be built? | High | Assumption: endpoint will be built as part of this feature (WP05). Dependency on joyus-ai team capacity. |
