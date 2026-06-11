# Research: Managed Git Sessions

**Feature**: 006-managed-git-sessions
**Date**: 2026-03-19
**Status**: Complete — all open architecture questions resolved

---

## Decision 1: File Modification Detection Mechanism

**Decision**: Hybrid — Claude Code `PostToolUse:Write` IPC hook (primary) + 10-second `git status --porcelain` poll (fallback).

**Rationale**:
- The sidecar already implements a full JSON-RPC 2.0 protocol over line-delimited stdin/stdout (`apps/desktop-companion/src/sidecar/ipc-handler.ts`). Adding a `session.fileModified` method requires one registration line in `services.ts` — zero new dependencies, zero macOS App Sandbox risk.
- Claude Code fires `PostToolUse:Write` hooks on every file write, making IPC the most precise detection path for Claude Code-driven modifications.
- Manual edits (terminal, other editors) bypass hooks entirely. A `git status --porcelain` poll on a 10-second interval catches those. The `execGit` injectable interface in `packages/desktop-sync/src/types.ts` accepts arbitrary `args: string[]`, so no new abstraction is required.
- `chokidar` was evaluated and rejected: not present in the monorepo, macOS App Sandbox entitlements for `FSEvents` are unverified, and the Tauri sidecar child process sandbox entitlements are unknown. The hybrid provides equivalent coverage with no dependency risk.

**Alternatives Considered**:
- `chokidar` filesystem watcher: rejected (sandbox risk, new dep, unverified entitlements).
- `fs.watch` (Node built-in): rejected (unreliable on macOS, cannot watch across mount points).
- IPC-only (no polling fallback): rejected (misses non-Claude-Code file modifications).
- Polling-only: viable fallback but introduces 10s lag for Claude Code sessions unnecessarily.

**Implementation notes**:
- New IPC method: `session.fileModified` — payload: `{ sessionId: string, repoPath: string, filePath: string }`.
- Poll interval: 10 seconds, configurable via settings.
- Deduplication: if IPC hook fires within the same poll window, skip the poll result for that session.
- The poll runs `git status --porcelain <cwd>` in the repository root; any non-empty output = file modification.

---

## Decision 2: Package Structure

**Decision**: Two new packages — `packages/session-manager` and `packages/drift-detector`.

**Rationale**:
- `packages/session-manager` owns: SQLite TaskBranch store, git worktree operations (wrapping `execGit`), file modification event handling, startup integrity scan.
- `packages/drift-detector` owns: 3-signal heuristics engine (directory count, topic domains, elapsed time), threshold configuration, DriftSignal output. LLM confirmation interface is defined but not implemented in v1.
- Separating them allows `packages/drift-detector` to be iterated independently — thresholds tuned, LLM path added — without touching the session lifecycle.
- Follows existing monorepo pattern: `packages/policy-client`, `packages/session-agent`, `packages/skill-sync` each own a discrete domain.
- Both packages are consumed by `apps/desktop-companion` and registered in `apps/desktop-companion/src/sidecar/services.ts`.

**Alternatives Considered**:
- Single `packages/session-manager` with drift detector embedded: rejected (drift detection is experimental; coupling it to the session lifecycle makes threshold tuning riskier).
- Extend `apps/desktop-companion/src/` directly: rejected (breaks the established package-per-domain pattern; reduces testability).

---

## Decision 3: Drift Detection v1 Scope

**Decision**: Heuristics-only in v1. LLM confirmation path deferred.

**Rationale**:
- The three heuristic signals (directory count ≥ 3, topic domain count ≥ 2, elapsed time ≥ 30 min) are sufficient to validate whether users engage with drift intervention at all before investing in LLM cost and latency.
- The `packages/drift-detector` interface will define a `DriftConfirmer` stub that always returns `null` (no confirmation), making the LLM slot testable and the API stable for a follow-up WP.
- Graceful degradation (required by FR-004) is free: v1 always uses heuristics; adding the LLM path later cannot break the heuristic flow.

**Alternatives Considered**:
- Ship LLM confirmation in v1: rejected (adds latency, cost, and offline-mode complexity before validating that users respond to heuristic signals).
- Stub with real LLM wiring: rejected (adds complexity without validation signal; same as full LLM path from a risk perspective).

---

## Decision 4: Session Panel UI Placement

**Decision**: New `/sessions` route in the existing React router, alongside Servers, Skills, Governance, Usage, Settings.

**Rationale**:
- The existing page pattern (one `*.tsx` file per route in `apps/desktop-companion/src/ui/pages/`) is well-established. Adding `Sessions.tsx` follows the pattern exactly.
- A sidebar panel or overlay (considered) would require new layout infrastructure and a persistent state mechanism — unnecessary complexity for v1.
- A separate Tauri window (considered) adds OS-level window management complexity with no UX benefit for a panel that users visit intentionally.

**Alternatives Considered**:
- Sidebar / overlay panel: rejected (new layout infrastructure, persistent state management overhead).
- Separate Tauri window: rejected (OS window management complexity, no clear UX advantage).

---

## Decision 5: Git Abstraction Layer

**Decision**: Reuse the `execGit` injectable function signature from `packages/desktop-sync/src/types.ts`. No new abstraction layer.

**Rationale**:
- The existing signature `execGit: (args: string[], cwd?: string) => Promise<{ stdout: string; stderr: string }>` accepts arbitrary git commands including `git worktree add/remove/list`.
- The injection pattern enables clean unit testing without spawning real git processes.
- Creating a parallel abstraction would result in two independent git execution layers with divergent error handling.
- Note: `packages/skill-sync` has its own `runGitCommand` — this is a pre-existing divergence outside this feature's scope.

---

## Decision 6: SQLite Persistence Pattern

**Decision**: New `session-manager.db` store following the `replayCache` patterns in `packages/policy-client/src/replayCache.ts`.

**Rationale**:
- The `replayCache` uses `node:sqlite` (Node 24 built-in), `openReplayCache()` factory with injectable `dbPath`, and a typed row interface — all patterns appropriate for `packages/session-manager`.
- New schema in a separate database file (`~/.joyus/session-manager.db`). The TaskBranch schema is unrelated to JTI replay and must not share the `replay-cache.db`.
- Drizzle ORM (used in joyus-ai) was considered and rejected for simplicity — `node:sqlite` with typed rows is sufficient for a single-table store.

---

## Open Items (deferred to planning or future features)

| Item | Status |
|---|---|
| GitHub Desktop URL protocol exact path | Verify during WP implementation before coding the launch call |
| LLM drift confirmation integration | Deferred to follow-up feature / WP |
| Drift detection test corpus (10 "should fire" + 5 "should not fire" cases) | Define during WP that implements `packages/drift-detector` |
| macOS App Sandbox entitlements for sidecar child process | Verify during WP01 — if poll requires entitlement grant, document in quickstart |
