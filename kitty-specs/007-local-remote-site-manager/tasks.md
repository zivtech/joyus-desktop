# Work Packages: Feature 007 — Local & Remote Site Manager

**Feature**: 007-local-remote-site-manager
**Generated**: 2026-04-01
**Total subtasks**: 56
**Work packages**: 10

---

## Phase 1: Foundation — local-provisioner

### WP01: Docker Runtime Detection
**Priority**: P0 — Foundation for all local site operations
**Prompt**: [tasks/WP01-docker-runtime-detection.md](tasks/WP01-docker-runtime-detection.md)
**Dependencies**: None
**Estimated prompt size**: ~350 lines

**Goal**: Scaffold `packages/local-provisioner` and implement Docker Engine API client + runtime detector that probes sockets and reports installation/health status.

**Subtasks**:
- [x] T001: Scaffold `packages/local-provisioner` (package.json, tsconfig, index.ts) `[P]`
- [x] T002: Implement `dockerClient.ts` — HTTP over Unix socket/named pipe, `/_ping`, `/info`, `/containers/json`, `/containers/{id}/stats?stream=false`
- [x] T003: Implement `runtimeDetector.ts` — ordered socket probing (DOCKER_HOST → ~/.docker → ~/.orbstack → /var/run), DDEV version check via `ddev version -j`
- [x] T004: Write tests for `dockerClient.test.ts` — mock HTTP responses for all endpoints
- [x] T005: Write tests for `runtimeDetector.test.ts` — mock socket access + ddev CLI

---

### WP02: DDEV CLI Wrapper
**Priority**: P0 — Required for all site lifecycle operations
**Prompt**: [tasks/WP02-ddev-cli-wrapper.md](tasks/WP02-ddev-cli-wrapper.md)
**Dependencies**: WP01
**Estimated prompt size**: ~400 lines

**Goal**: Implement the DDEV CLI wrapper that executes commands, parses JSON output envelopes, and classifies errors into plain-language messages.

**Subtasks**:
- [x] T006: Implement `ddevCli.ts` — wrapper for `ddev start/stop/restart/delete/describe/list/version` with `-j` flag, envelope parsing (`{ msg, level, raw }`)
- [x] T007: Implement error classification — match stderr patterns to plain-language messages (port conflict, missing docker, missing config, project not found)
- [x] T008: Implement resource snapshot extraction — parse `docker stats` via Docker Engine API for running DDEV containers
- [x] T009: Write tests for `ddevCli.test.ts` — mock execFile for each command, test JSON parsing, test error classification
- [x] T010: Write tests for resource snapshot — mock Docker stats API responses

---

### WP03: Local Site Store & Manager
**Priority**: P0 — Core local site lifecycle
**Prompt**: [tasks/WP03-local-site-store-manager.md](tasks/WP03-local-site-store-manager.md)
**Dependencies**: WP01, WP02
**Estimated prompt size**: ~450 lines

**Goal**: Implement SQLite persistence for local sites and the orchestrator that provisions, starts, stops, and removes DDEV sites.

**Subtasks**:
- [x] T011: Implement `localSiteStore.ts` — SQLite schema, CRUD operations, soft delete, status updates (following `taskBranchStore.ts` patterns)
- [x] T012: Implement `localSiteManager.ts` — `provision()`: clone repo → detect .ddev config → `ddev start` → persist site → return URL
- [x] T013: Implement lifecycle methods — `start()`, `stop()`, `restart()`, `remove()` with DDEV CLI delegation
- [x] T014: Implement `syncAll()` — refresh all site statuses from `ddev list -j` output
- [x] T015: Implement `getResourceUsage()` — Docker container stats for running sites
- [x] T016: Write tests for `localSiteStore.test.ts` — CRUD, soft delete, status transitions
- [x] T017: Write tests for `localSiteManager.test.ts` — provision flow, lifecycle, sync, error scenarios

---

## Phase 2: Foundation — environment-monitor

### WP04: Probo Detection & Remote Environment Store
**Priority**: P1 — Foundation for all remote environment tracking
**Prompt**: [tasks/WP04-probo-detection-remote-store.md](tasks/WP04-probo-detection-remote-store.md)
**Dependencies**: None
**Estimated prompt size**: ~350 lines

**Goal**: Scaffold `packages/environment-monitor` and implement Probo detection + SQLite persistence for remote environments.

**Subtasks**:
- [x] T018: Scaffold `packages/environment-monitor` (package.json, tsconfig, index.ts) `[P]`
- [x] T019: Implement `proboDetector.ts` — check `.probo.yaml` existence in repo root
- [x] T020: Implement `remoteEnvironmentStore.ts` — SQLite schema, CRUD, upsert from deployment, soft delete, status transitions
- [x] T021: Write tests for `proboDetector.test.ts` — file exists/not-exists scenarios
- [x] T022: Write tests for `remoteEnvironmentStore.test.ts` — CRUD, upsert idempotency, status transitions

---

### WP05: Activity Log
**Priority**: P1 — Observability for pipeline troubleshooting
**Prompt**: [tasks/WP05-activity-log.md](tasks/WP05-activity-log.md)
**Dependencies**: WP04
**Estimated prompt size**: ~250 lines

**Goal**: Implement the SQLite-backed activity log with append, query, and 30-day pruning.

**Subtasks**:
- [x] T023: Implement `activityLog.ts` — SQLite table in same DB as remote environments, append, listRecent, listByRepo, pruneOlderThan
- [x] T024: Implement startup pruning — delete entries older than 30 days on first access
- [x] T025: Write tests for `activityLog.test.ts` — append, query, pruning, retention boundary

---

### WP06: GitHub Deployment Status Poller
**Priority**: P1 — Core Probo environment URL discovery
**Prompt**: [tasks/WP06-deployment-status-poller.md](tasks/WP06-deployment-status-poller.md)
**Dependencies**: WP04
**Estimated prompt size**: ~450 lines

**Goal**: Implement the GitHub Deployments API poller that discovers Probo environment URLs via `gh api`, maps deployment states, and manages the polling loop.

**Subtasks**:
- [x] T026: Implement `deploymentStatusPoller.ts` — `pollForPr()`: get PR head SHA via `gh pr view`, query deployments by SHA, query statuses, extract `environment_url`
- [x] T027: Implement deployment state mapping — GitHub states (`queued`, `pending`, `in_progress`, `success`, `failure`, `error`, `inactive`) → `RemoteEnvironmentStatus`
- [x] T028: Implement polling loop — 60-second interval with `setInterval`, `startPolling()`, `stopPolling()`
- [x] T029: Implement `triggerImmediatePoll()` — event-driven immediate check, bypasses interval
- [x] T030: Implement rate limit handling — detect 403/rate-limit headers, back off, show last-known status
- [x] T031: Write tests for `deploymentStatusPoller.test.ts` — mock `gh api` output, state mapping, polling lifecycle, rate limit backoff

---

### WP07: Project Discovery & User Identity
**Priority**: P1 — Determines what users see in the site manager
**Prompt**: [tasks/WP07-project-discovery-user-identity.md](tasks/WP07-project-discovery-user-identity.md)
**Dependencies**: WP04
**Estimated prompt size**: ~350 lines

**Goal**: Implement chained project discovery (GitHub orgs + admin list + manual URL) and user identity determination (internal vs. client).

**Subtasks**:
- [x] T032: Implement `userIdentity.ts` — `gh api /user/orgs --jq '.[].login'` to check for `zivtech` membership; Google domain check for `@zivtech.com`
- [x] T033: Implement `projectDiscovery.ts` — `discoverFromGitHubOrg()` via `gh api /orgs/{org}/repos`, `addManual()`, deduplication by repo URL
- [x] T034: Implement admin-curated list stub — placeholder for joyus-ai platform API (returns empty until API exists)
- [x] T035: Implement `discoverAll()` — combine all sources, deduplicate, enrich with `hasProbo`/`hasDdev` flags
- [x] T036: Write tests for `userIdentity.test.ts` — mock gh CLI, org membership, edge cases
- [x] T037: Write tests for `projectDiscovery.test.ts` — mock gh CLI, deduplication, manual add

---

### WP08: Environment Monitor Orchestrator
**Priority**: P1 — Ties environment-monitor package together
**Prompt**: [tasks/WP08-environment-monitor-orchestrator.md](tasks/WP08-environment-monitor-orchestrator.md)
**Dependencies**: WP05, WP06, WP07
**Estimated prompt size**: ~400 lines

**Goal**: Implement the `EnvironmentMonitor` orchestrator that handles PR events, manages polling lifecycle, surfaces environments, and logs activity.

**Subtasks**:
- [x] T038: Implement `environmentMonitor.ts` — `onPrCreated()`: create/update RemoteEnvironment, trigger immediate poll, log activity
- [x] T039: Implement `requestHostedEnvironment()` — stub for joyus-ai API (placeholder returns "provisioning" status)
- [x] T040: Implement `start()`/`stop()` — start/stop the deployment status poller, run initial sync on start
- [x] T041: Implement environment lifecycle management — update store when poller returns new statuses, transition expired environments, log state changes
- [x] T042: Implement `listAll()` and `listByRepo()` — query store, return sorted by last activity
- [x] T043: Write tests for `environmentMonitor.test.ts` — PR event flow, polling lifecycle, status transitions, activity logging

---

## Phase 3: Cross-Feature Integration

### WP09: Feature 006 Push/PR Amendments
**Priority**: P1 — Closes the branch→PR→environment loop
**Prompt**: [tasks/WP09-feature-006-push-pr-amendments.md](tasks/WP09-feature-006-push-pr-amendments.md)
**Dependencies**: WP03, WP08
**Estimated prompt size**: ~500 lines

**Goal**: Implement the Feature 006 amendments (FR-018–FR-023) in `packages/session-manager`: push-to-remote, draft PR creation, auto-commit, PR association on TaskBranch.

**Subtasks**:
- [x] T044: Add PR association fields to TaskBranch schema — `pr_number`, `pr_url`, `pr_status`, `preview_environment_url` columns, schema migration
- [x] T045: Implement `gitPusher.ts` in session-manager — push task branch to configured remote via `execGit`, handle network failures with retry queue
- [x] T046: Implement `prCreator.ts` in session-manager — `gh pr create --draft` via execFile, detect existing PR, update PR association on TaskBranch
- [x] T047: Implement auto-commit behavior (FR-023) — silent commit for desktop GUI context, "save your work" prompt for CLI context, configurable preference
- [x] T048: Implement event emission — emit `push-complete` and `pr-created` events that environment-monitor can consume
- [x] T049: Write tests for push, PR creation, auto-commit, and event emission

---

### WP10: Cross-Feature Event Bridge & Acceptance
**Priority**: P1 — End-to-end integration
**Prompt**: [tasks/WP10-cross-feature-bridge-acceptance.md](tasks/WP10-cross-feature-bridge-acceptance.md)
**Dependencies**: WP03, WP09
**Estimated prompt size**: ~400 lines

**Goal**: Wire session-manager events to environment-monitor, implement the unified site panel data model, and validate end-to-end flows.

**Subtasks**:
- [x] T050: Implement event bridge — session-manager `pr-created` event → environment-monitor `onPrCreated()`, wire in app orchestration layer
- [x] T051: Implement unified site list — combine `localSiteManager.listAll()` + `environmentMonitor.listAll()` into `ManagedSite[]` view model for the panel
- [x] T052: Implement user-type filtering — internal users see local + remote; client users see remote only
- [x] T053: Implement offline handling — local sites work offline, remote status cached with "last checked" timestamp
- [x] T054: Write end-to-end integration tests — session close → push → PR → Probo poll → environment appears
- [x] T055: Write edge case tests — port conflicts, network failures, rate limiting, missing .probo.yaml, missing .ddev config
- [x] T056: Export public API from both packages via index.ts

---

## Parallelization Map

```
WP01 ──→ WP02 ──→ WP03 ──┐
                           ├──→ WP09 ──→ WP10
WP04 ──┬─→ WP05 ──┐       │
       ├─→ WP06 ──┼──→ WP08 ┘
       └─→ WP07 ──┘
```

**Parallel tracks**:
- Track A (local): WP01 → WP02 → WP03
- Track B (remote): WP04 → WP05/WP06/WP07 (parallel) → WP08
- Merge: WP09 (depends on WP03 + WP08) → WP10

**Maximum parallelism**: 4 concurrent WPs (WP05, WP06, WP07 + any Track A WP)

## MVP Scope

**Minimum viable**: WP01–WP03 (local site provisioning) delivers day-1 value for Zivtech PMs. Can ship independently.

**Full feature**: All 10 WPs complete the local + remote + cross-feature integration.
