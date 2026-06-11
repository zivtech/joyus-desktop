# Tasks: Managed Git Sessions

**Feature**: 006-managed-git-sessions | **Plan**: [plan.md](plan.md) | **Spec**: [spec.md](spec.md)

## Work Package Summary

| WP | Title | Priority | Subtasks | Est. Lines | Dependencies |
|---|---|---|---|---|---|
| WP01 | session-manager: Store & Worktree | P0 | T001–T008 (8) | ~420 | — |
| WP02 | session-manager: File Mod Detection | P0 | T009–T014 (6) | ~300 | WP01 |
| WP03 | drift-detector: Heuristics Engine | P1 | T015–T020 (6) | ~320 | — |
| WP04 | Sidecar Wiring | P1 | T021–T027 (7) | ~350 | WP02, WP03 |
| WP05 | Sessions UI Page | P1 | T028–T035 (8) | ~400 | WP04 |
| WP06 | Integration Test Suite | P1 | T036–T041 (6) | ~320 | WP05 |
| WP07 | Acceptance Tests & Runbook | P2 | T042–T048 (7) | ~360 | WP06 |

**Total**: 48 subtasks across 7 WPs. WP01 and WP03 are independent and can run in parallel.

## Dependency Order

```
WP01 (store + worktree) ──→ WP02 (detection) ──┐
                                                 ├──→ WP04 (wiring) ──→ WP05 (UI) ──→ WP06 (integration) ──→ WP07 (acceptance)
WP03 (drift) ────────────────────────────────────┘
```

---

## Phase 0 — Foundation (WP01 + WP03 in parallel)

### WP01 — session-manager: Store & Worktree Operations ✅ [planned]

**Goal**: Create `packages/session-manager` with SQLite TaskBranch persistence and git worktree lifecycle management.
**Priority**: P0 — blocks WP02, WP04
**Independent test**: `pnpm vitest run packages/session-manager/test/` passes at 100% coverage with mocked execGit.

**Subtasks**:
- [x] T001: Package scaffold (package.json, tsconfig, src/, test/)
- [ ] T002: SQLite schema + `openTaskBranchStore()` factory
- [ ] T003: `TaskBranchStore` CRUD — create, findBySessionId, listAll
- [ ] T004: `TaskBranchStore` transitions — updateStatus, updateActivity, softDelete, applyStaleThreshold, detectMerged
- [ ] T005: `WorktreeManager` — create (with collision handling), remove, isHealthy, list
- [ ] T006: `missionInferrer` — auto-label from file paths
- [ ] T007: `scanIntegrity()` startup scan
- [ ] T008: Unit tests for all WP01 modules

**Prompt**: [WP01-session-manager-store-worktree.md](tasks/WP01-session-manager-store-worktree.md
**Implement**: `spec-kitty implement WP01`

---

### WP03 — drift-detector: Heuristics Engine ✅ [planned]

**Goal**: Create `packages/drift-detector` with 3-signal heuristics, session state tracking, and dismissal logic.
**Priority**: P1 — blocks WP04
**Independent test**: `pnpm vitest run packages/drift-detector/test/` passes at 100% coverage; 15-scenario corpus fires correctly.

**Subtasks**:
- [ ] T015: Package scaffold (package.json, tsconfig, src/, test/)
- [ ] T016: `TopicDomainInferrer` — keyword-to-domain lookup (8 domains + "other")
- [ ] T017: `HeuristicsEngine` — 3-signal evaluation, confidence scoring
- [ ] T018: `DriftDetector` — session state, observe(), dismiss(), getState(), clearSession()
- [ ] T019: `NoOpDriftConfirmer` v1 stub
- [ ] T020: Unit tests + 15-scenario corpus (10 "should fire", 5 "should not fire")

**Prompt**: [WP03-drift-detector-heuristics.md](tasks/WP03-drift-detector-heuristics.md
**Implement**: `spec-kitty implement WP03`

---

## Phase 1 — Integration Layer

### WP02 — session-manager: File Modification Detection ✅ [planned]

**Goal**: Add file modification detection to `packages/session-manager` — IPC hook handler, polling fallback, deduplication, and `SessionManager` coordination.
**Priority**: P0 — blocks WP04
**Dependencies**: WP01
**Independent test**: Detection unit tests with fake timers and git-status spy pass at 100%.

**Subtasks**:
- [ ] T009: `FileModificationDetector.handleIpcEvent()` — IPC hook entry point
- [ ] T010: `FileModificationDetector` polling — `startPolling`, `stopPolling`, `git status --porcelain`
- [ ] T011: Deduplication — suppress poll result when IPC fired in same window
- [ ] T012: `SessionManager.onFileModification()` — managed mode creates TaskBranch on first event
- [ ] T013: `SessionManager` remaining API — resume, delete, hasUncommittedChanges, getMode, setMode, initialize
- [ ] T014: Unit tests for WP02 modules

**Prompt**: [WP02-session-manager-file-detection.md](tasks/WP02-session-manager-file-detection.md
**Implement**: `spec-kitty implement WP02 --base WP01`

---

### WP04 — Sidecar Wiring ✅ [planned]

**Goal**: Wire `packages/session-manager` and `packages/drift-detector` into the companion sidecar lifecycle. Register all session IPC methods, emit drift events to Tauri, add shutdown handlers.
**Priority**: P1 — blocks WP05
**Dependencies**: WP02, WP03
**Independent test**: Mock-based unit tests verify all IPC registrations, event emissions, and shutdown behavior.

**Subtasks**:
- [ ] T021: `sessionWiring.ts` factory — construct SessionManager + DriftDetector instances
- [ ] T022: Register `session.fileModified` IPC method; wire into detector + session manager
- [ ] T023: Register `session.list`, `session.resume`, `session.delete` IPC methods
- [ ] T024: Register `session.getMode`, `session.setMode` IPC methods
- [ ] T025: Wire drift signal → `state.driftSignal` Tauri event emission
- [ ] T026: SIGTERM/SIGINT shutdown handlers — `stopPolling` for all active sessions
- [ ] T027: Unit tests for sessionWiring.ts

**Prompt**: [WP04-sidecar-wiring.md](tasks/WP04-sidecar-wiring.md
**Implement**: `spec-kitty implement WP04 --base WP03`

---

## Phase 2 — UI & Testing

### WP05 — Sessions UI Page ✅ [planned]

**Goal**: Add `/sessions` route to the React frontend with task branch panel, drift banners, delete confirmations, batch cleanup, mode toggle, and GitHub Desktop launch.
**Priority**: P1 — blocks WP06
**Dependencies**: WP04
**Independent test**: Vitest + React Testing Library; all IPC calls mocked; Tauri events mocked via test doubles.

**Subtasks**:
- [ ] T028: `TaskBranchCard.tsx` — mission label, status badge, relative time, contextual action buttons
- [ ] T029: `DriftBanner.tsx` — low-confidence toast + high-confidence inline modal variants
- [ ] T030: `Sessions.tsx` — page shell, IPC `session.list` fetch on mount, state management
- [ ] T031: Delete confirmation flow — inline confirm (clean) vs modal warning (uncommitted changes)
- [ ] T032: Batch cleanup — "Clean up all stale" with partial-failure display
- [ ] T033: Mode toggle in page header — `session.setMode` call, "affects new sessions only" note
- [ ] T034: Subscribe to `state.driftSignal` Tauri events; render `DriftBanner` on signal
- [ ] T035: "Open in GitHub Desktop" action + not-installed fallback

**Prompt**: [WP05-sessions-ui-page.md](tasks/WP05-sessions-ui-page.md
**Implement**: `spec-kitty implement WP05 --base WP04`

---

### WP06 — Integration Test Suite ✅ [planned]

**Goal**: End-to-end integration tests covering the full IPC→worktree→SQLite→drift→Tauri-event flow using real git repos and real SQLite in tmpdirs.
**Priority**: P1 — blocks WP07
**Dependencies**: WP05

**Subtasks**:
- [ ] T036: Integration test setup — real git repos + real SQLite in tmpdir; execGit wrapping real git binary
- [ ] T037: SC-001 to SC-004 — worktree creation, stale detection, resumption, drift signal flow
- [ ] T038: SC-005 advisory mode — exhaustive negative test across all IPC methods
- [ ] T039: SC-007 integrity scan + SC-008 batch cleanup with injected partial failure
- [ ] T040: Concurrent session isolation — two sessions, same repo, distinct worktrees (FR-016)
- [ ] T041: Mode-switch boundary + stale threshold live-update scenarios

**Prompt**: [WP06-integration-tests.md](tasks/WP06-integration-tests.md
**Implement**: `spec-kitty implement WP06 --base WP05`

---

## Phase 3 — Acceptance & Operations

### WP07 — Acceptance Tests & Runbook ✅ [planned]

**Goal**: Pilot acceptance test suite covering SC-001 through SC-008, plus operational runbook.
**Priority**: P2
**Dependencies**: WP06

**Subtasks**:
- [ ] T042: SC-001 — git terminology blocklist sweep across all Sessions page rendered strings
- [ ] T043: SC-002 — drift corpus execution (15 scenarios, assert ≥95% fire rate on "should fire")
- [ ] T044: SC-003 cleanup timing (60s budget) + SC-004 resume timing (3s budget)
- [ ] T045: SC-005 exhaustive advisory mode — zero auto-ops across all code paths
- [ ] T046: SC-006 GitHub Desktop URL check + SC-007 broken worktree scan
- [ ] T047: SC-008 batch cleanup with injected mid-batch failure
- [ ] T048: `docs/operations/runbook-006.md` — 2 alerts, 2 incidents, pre-pilot checklist

**Prompt**: [WP07-acceptance-tests-runbook.md](tasks/WP07-acceptance-tests-runbook.md
**Implement**: `spec-kitty implement WP07 --base WP06`

<!-- status-model:start -->
## Canonical Status (Generated)
- WP01: done
- WP02: done
- WP03: done
- WP04: done
- WP05: done
- WP06: done
- WP07: done
<!-- status-model:end -->
