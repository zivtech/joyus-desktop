# Tasks: Managed Tooling Distribution

**Feature**: 008-managed-tooling-distribution
**Date**: 2026-04-01
**Work Packages**: 7 | **Subtasks**: 38

## Subtask Index

| ID | Description | WP | Parallel |
|----|------------|-----|----------|
| T001 | Scaffold packages/settings-reconciler | WP01 | |
| T002 | Define manifest types | WP01 | |
| T003 | Implement manifest validation | WP01 | |
| T004 | Implement manifest fetching from URL | WP01 | |
| T005 | Export public API from index.ts | WP01 | |
| T006 | Tests for manifest module (100% coverage) | WP01 | |
| T007 | Define registry types | WP02 | |
| T008 | Implement registry read (missing/corrupted handling) | WP02 | |
| T009 | Implement registry write (atomic) | WP02 | |
| T010 | Implement registry repair from joyus: prefix scanning | WP02 | |
| T011 | Tests for registry module (100% coverage) | WP02 | |
| T012 | Implement settings.json read (missing/corrupted/empty) | WP03 | |
| T013 | Implement atomic write (temp-then-rename) | WP03 | |
| T014 | Implement backup creation with rotation | WP03 | |
| T015 | Implement rollback from backup on failure | WP03 | |
| T016 | Tests for settings file operations (100% coverage) | WP03 | |
| T017 | Implement hook merge — append joyus: matcher groups | WP04 | |
| T018 | Implement hook removal — filter stale joyus: entries | WP04 | |
| T019 | Implement MCP server merge — add/update joyus: keys | WP04 | |
| T020 | Implement MCP server removal — remove stale joyus: keys | WP04 | |
| T021 | Implement global vs project target routing | WP04 | |
| T022 | Implement full reconcile() pipeline | WP04 | |
| T023 | Tests for reconciler (100% coverage) | WP04 | |
| T024 | Implement tenant config aggregation from bundles | WP05 | |
| T025 | Implement tenant config file write | WP05 | |
| T026 | Handle config path override from manifest | WP05 | |
| T027 | Tests for tenant config (100% coverage) | WP05 | |
| T028 | Implement config-check poller with configurable interval | WP06 | |
| T029 | Implement version hash comparison | WP06 | |
| T030 | Implement change detection callback | WP06 | |
| T031 | Implement graceful degradation on network failure | WP06 | |
| T032 | Implement poller start/stop lifecycle | WP06 | |
| T033 | Tests for config-check poller (100% coverage) | WP06 | |
| T034 | Wire configCheckPoller into desktop-companion sidecar | WP07 | |
| T035 | Wire sequential orchestration: syncSkills → reconcile | WP07 | |
| T036 | Integration test: full pipeline | WP07 | |
| T037 | Integration test: revocation + user settings preserved | WP07 | |
| T038 | Full CI validation (typecheck + 100% coverage) | WP07 | |

## Dependency Graph

```
WP01 (Manifest) ──┬──→ WP04 (Reconciler Core)
WP02 (Registry) ──┤                │
WP03 (Settings) ──┘                ├──→ WP07 (Integration)
                                   │
WP05 (Tenant Config) ─────────────┘
WP06 (Config Poller) ─────────────┘
```

WP01, WP02, WP03 can run in parallel (no interdependencies).
WP04 depends on WP01 + WP02 + WP03 (reconciler uses all three modules).
WP05 depends on WP01 (reads manifest config).
WP06 depends on WP01 (fetches manifest for version comparison).
WP07 depends on WP04 + WP05 + WP06 (wires everything together).

---

## Phase 1: Foundation (WP01, WP02, WP03 — parallelizable)

### WP01: Package Scaffold & Manifest Module

**Priority**: P0 — everything depends on the manifest types
**Goal**: Scaffold `packages/settings-reconciler` and implement manifest parsing, validation, and fetching.
**Subtasks**: T001, T002, T003, T004, T005, T006 (6 subtasks)
**Dependencies**: None
**Estimated prompt size**: ~400 lines

- [ ] T001: Scaffold packages/settings-reconciler (package.json, tsconfig.json, src/, test/)
- [ ] T002: Define manifest types (DistributionManifest, ManifestBundle, ManifestHook, ManifestMcpServer, HookEventType, SettingsTarget)
- [ ] T003: Implement manifest validation (schema_version, joyus: prefix, required fields, type guards)
- [ ] T004: Implement manifest fetching from control plane URL (with fetch injection)
- [ ] T005: Export public API from index.ts
- [ ] T006: Tests for manifest module — validation edge cases, fetch success/failure, invalid JSON

**Implementation notes**: Follow existing package patterns (see skill-sync for reference). Use readonly types and strict validation. The manifest types from `contracts/distribution-manifest.ts` are the design source.

**Prompt file**: [tasks/WP01-package-scaffold-manifest.md](tasks/WP01-package-scaffold-manifest.md)

---

### WP02: Sidecar Registry Module

**Priority**: P0 — reconciler depends on registry for ownership tracking
**Goal**: Implement the `.claude/.joyus-managed.json` sidecar registry — read, write, and self-repair.
**Subtasks**: T007, T008, T009, T010, T011 (5 subtasks)
**Dependencies**: None (uses own types, no manifest dependency)
**Estimated prompt size**: ~350 lines

- [ ] T007: Define registry types (ManagedRegistry, RegistryEntry)
- [ ] T008: Implement registry read with graceful handling of ENOENT, corrupted JSON, empty file
- [ ] T009: Implement registry write (atomic: write-to-temp-then-rename)
- [ ] T010: Implement registry repair — scan settings.json for joyus:-prefixed entries, rebuild registry
- [ ] T011: Tests for registry — read/write, missing file, corrupted file, repair from prefix scan

**Implementation notes**: Registry repair needs to understand both hook format (joyus: in matcher) and MCP format (joyus: as key prefix). The repair function takes a settings.json path as input.

**Prompt file**: [tasks/WP02-sidecar-registry.md](tasks/WP02-sidecar-registry.md)

---

### WP03: Settings File Operations

**Priority**: P0 — reconciler depends on atomic read/write/backup/rollback
**Goal**: Implement settings.json file operations with atomic writes, backup creation, and rollback.
**Subtasks**: T012, T013, T014, T015, T016 (5 subtasks)
**Dependencies**: None
**Estimated prompt size**: ~350 lines

- [ ] T012: Implement settings.json read — handle missing (return empty), corrupted JSON (backup + return empty), empty file (return empty)
- [ ] T013: Implement atomic write — write to `.tmp` in same directory, then `fs.rename()`
- [ ] T014: Implement backup creation before reconciliation — copy current file to backup dir, rotate old backups (max configurable, default 5)
- [ ] T015: Implement rollback — restore from most recent backup on failure
- [ ] T016: Tests for all operations — happy path, missing file, corrupted file, backup rotation, rollback after failure

**Implementation notes**: Use the same backup infrastructure pattern as skill-sync (stampNow for backup dir names, sorted oldest-first for rotation). Atomic rename is POSIX-safe for same-volume operations.

**Prompt file**: [tasks/WP03-settings-file-operations.md](tasks/WP03-settings-file-operations.md)

---

## Phase 2: Core Logic (WP04, WP05, WP06 — WP05 and WP06 parallelizable)

### WP04: Reconciler Core — Hook & MCP Merge

**Priority**: P0 — the central feature logic
**Goal**: Implement the reconcile() function that merges managed hooks and MCPs into settings.json.
**Subtasks**: T017, T018, T019, T020, T021, T022, T023 (7 subtasks)
**Dependencies**: WP01, WP02, WP03
**Estimated prompt size**: ~500 lines

- [x] T017: Implement hook merge — for each managed hook in manifest, append a matcher group to the appropriate event type array in settings.hooks
- [x] T018: Implement hook removal — filter out matcher groups where matcher starts with `joyus:` and ID is not in current manifest
- [x] T019: Implement MCP server merge — for each managed MCP in manifest, set the `joyus:<id>` key in settings.mcpServers
- [x] T020: Implement MCP server removal — delete `joyus:`-prefixed keys not in current manifest
- [x] T021: Implement global vs project target routing — route entries to the correct settings file based on manifest `target` field
- [x] T022: Implement full reconcile() pipeline: fetch/receive manifest → read settings → read registry → compute diff → backup → merge hooks → merge MCPs → write settings → update registry → return result
- [x] T023: Tests for reconciler — hook append preserves user hooks, hook removal is selective, MCP merge/removal, global vs project routing, full pipeline with rollback on write failure, empty manifest = full removal

**Implementation notes**: The reconcile function is the public API. It takes a DistributionManifest and ReconcileConfig, returns ReconcileResult. Internal functions (mergeHooks, removeStaleHooks, mergeMcpServers, removeStaleMcpServers) are pure — they take settings objects and return new settings objects. Side effects (file I/O) only happen in reconcile() itself.

**Prompt file**: [tasks/WP04-reconciler-core.md](tasks/WP04-reconciler-core.md)

---

### WP05: Tenant Config Module

**Priority**: P1 — needed for per-tenant parameterization (e.g., chat-length threshold)
**Goal**: Implement tenant config aggregation and file write.
**Subtasks**: T024, T025, T026, T027 (4 subtasks)
**Dependencies**: WP01 (reads manifest config fields)
**Estimated prompt size**: ~250 lines

- [x] T024: Implement tenant config aggregation — merge config objects from all bundles in manifest into a single TenantConfig
- [x] T025: Implement tenant config file write to deterministic path (default: `~/.claude/.joyus-config.json`)
- [x] T026: Handle config_path override from manifest — use manifest.config_path if provided, else default
- [x] T027: Tests for tenant config — aggregation from multiple bundles, file write, path override, empty config

**Implementation notes**: Config aggregation is a shallow merge across bundles. Later bundles override earlier ones for duplicate keys. The written file includes tenant_id and updated_at metadata so hook scripts can verify freshness.

**Prompt file**: [tasks/WP05-tenant-config.md](tasks/WP05-tenant-config.md)

---

### WP06: Config-Check Poller Sidecar

**Priority**: P1 — needed for revocation and config update detection
**Goal**: Implement the config-check poll loop in desktop-companion's sidecar.
**Subtasks**: T028, T029, T030, T031, T032, T033 (6 subtasks)
**Dependencies**: WP01 (fetches manifest for version comparison)
**Estimated prompt size**: ~400 lines

- [x] T028: Implement config-check poller with configurable interval (default 300_000ms = 5 minutes)
- [x] T029: Implement version hash comparison — hash the manifest response, compare to last-seen hash stored in state
- [x] T030: Implement change detection — when hash differs, invoke onChangeDetected callback with parsed manifest
- [x] T031: Implement graceful degradation — on fetch failure, log warning, increment consecutive failure counter, preserve existing state, retry next interval
- [x] T032: Implement poller start/stop lifecycle — start returns a handle with stop(), cleared on stop
- [x] T033: Tests for poller — interval fires, unchanged manifest skips callback, changed manifest triggers callback, network failure preserves state, stop clears interval

**Implementation notes**: This lives in `apps/desktop-companion/src/sidecar/configCheckPoller.ts`. Uses `setInterval` for simplicity. State (lastVersionHash, consecutiveFailures) is in-memory only — rebuilt on app restart. The callback signature matches the desktop-companion's orchestration needs: receives a DistributionManifest, desktop-companion decides what to do with it.

**Prompt file**: [tasks/WP06-config-check-poller.md](tasks/WP06-config-check-poller.md)

---

## Phase 3: Integration (WP07)

### WP07: Integration Wiring & Acceptance

**Priority**: P0 — connects everything and validates end-to-end
**Goal**: Wire the poller, sync, and reconciler into desktop-companion and validate the full pipeline.
**Subtasks**: T034, T035, T036, T037, T038 (5 subtasks)
**Dependencies**: WP04, WP05, WP06
**Estimated prompt size**: ~400 lines

- [x] T034: Wire configCheckPoller into desktop-companion sidecar module (import, configure, start on app init)
- [x] T035: Wire sequential orchestration in the onChangeDetected callback: syncSkills() → reconcile() → writeTenantConfig()
- [x] T036: Integration test: provide manifest with hooks + MCPs → run full pipeline → verify settings.json contains managed entries, sidecar registry is correct, tenant config file is written
- [x] T037: Integration test: revocation flow — start with deployed entries → update manifest to remove bundle → run pipeline → verify all managed entries removed, user entries preserved, registry cleaned
- [x] T038: Full CI validation — pnpm typecheck + pnpm coverage passes across all packages with 100% thresholds

**Implementation notes**: Integration tests should use the same in-memory/temp-dir patterns as existing desktop-companion tests. The orchestration is deliberately simple: three function calls in sequence with error handling. If syncSkills fails, skip reconcile. If reconcile fails, it handles its own rollback internally.

**Prompt file**: [tasks/WP07-integration-wiring.md](tasks/WP07-integration-wiring.md)

<!-- status-model:start -->
## Canonical Status (Generated)
- WP01: in_progress
- WP02: in_progress
- WP03: in_progress
- WP04: approved
- WP05: for_review
- WP06: for_review
- WP07: for_review
<!-- status-model:end -->
