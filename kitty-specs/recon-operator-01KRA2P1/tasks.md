# Work Packages: Recon Operator

**Mission**: `recon-operator-01KRA2P1`
**Total**: 14 work packages (7 Phase 1, 4 Phase 2, 3 Phase 3)
**Subtasks**: 52 (T001–T052)

## Subtask Index

| ID | Description | WP | Parallel |
|----|------------|-----|----------|
| T001 | Create recon.ts sidecar module scaffold | WP01 | [P] | [D] |
| T002 | Implement recon.create handler | WP01 | | [D] |
| T003 | Implement recon.scan handler | WP01 | | [D] |
| T004 | Implement recon.export handler | WP01 | | [D] |
| T005 | Bundle scan-sensitive-output.mjs in resources | WP01 | | [D] |
| T006 | Create credentials.ts sidecar module scaffold | WP02 | [P] |
| T007 | Implement credentials.save handler | WP02 | |
| T008 | Implement credentials.list handler | WP02 | |
| T009 | Implement credentials.verify handler | WP02 | |
| T010 | Register recon + credential handlers in services.ts | WP02 | |
| T011 | Create recon.rs Rust module with process state | WP03 | [P] |
| T012 | Implement launch_recon command | WP03 | |
| T013 | Implement get_engagement_status command | WP03 | |
| T014 | Implement cancel_engagement command | WP03 | |
| T015 | Add create_engagement proxy and register commands | WP03 | |
| T016 | Append completion signaling section to Recon skill | WP04 | [D] |
| T017 | Add Phase 0 prereq check to Recon skill | WP04 | | [D] |
| T018 | Create ReconSetup.tsx wizard page structure | WP05 | |
| T019 | Implement Claude Code detection (Step 1) | WP05 | |
| T020 | Create CredentialForm.tsx component | WP05 | |
| T021 | Implement credential entry wizard step (Step 2) | WP05 | |
| T022 | Implement skill installation check (Step 3) | WP05 | |
| T023 | Add first-run detection hook (useReconSetup) | WP05 | |
| T024 | Create ReconDashboard.tsx with New Engagement form | WP06 | |
| T025 | Create EngagementStatus.tsx component | WP06 | |
| T026 | Implement progress streaming via safeListen | WP06 | |
| T027 | Implement post-completion scan and export flow | WP06 | |
| T028 | Add /recon routes to App.tsx and Layout nav | WP06 | |
| T029 | Create smoke test script | WP07 | |
| T030 | Document assisted setup runbook | WP07 | |
| T031 | Add keyring dependency to Cargo.toml | WP08 | |
| T032 | Create keychain.rs module (store/retrieve/delete/list) | WP08 | |
| T033 | Register Tauri keychain commands | WP08 | |
| T034 | Implement flat file → Keychain migration | WP08 | |
| T035 | Modify launch_recon to retrieve from Keychain | WP08 | |
| T036 | Add recon-operator-bundle to distribution config | WP09 | [P] |
| T037 | Configure skill-sync for joyus-recon repo | WP09 | |
| T038 | Modify wizard Step 3 to use sync.trigger | WP09 | |
| T039 | Add version display in engagement status | WP09 | |
| T040 | Implement pre-launch skill version check | WP10 | |
| T041 | Implement auto-sync on version mismatch | WP10 | |
| T042 | Log skill version in completion sentinel | WP10 | |
| T043 | Configure tauri.conf.json signing identity | WP11 | [P] |
| T044 | Create entitlements.plist | WP11 | |
| T045 | Create GitHub Actions build workflow | WP11 | |
| T046 | Add notarization step to workflow | WP11 | |
| T047 | Create ReadinessMatrix.tsx component | WP12 | [P] |
| T048 | Implement preflight check and engagement blocking | WP12 | |
| T049 | Implement engagement timeout alert | WP13 | [P] |
| T050 | Implement crash recovery | WP13 | |
| T051 | Implement scan failure UX with override audit log | WP13 | |
| T052 | Execute Aaron UAT and document findings | WP14 | |

## Dependency Graph

```
Phase 1 (parallel start):
  Layer 0: WP01 (recon handlers) ──┐
           WP03 (rust commands) ───┤  all parallel
           WP04 (sentinel, manual) ┘
                                   │
  Layer 1: WP02 (credential handlers) ── depends on WP01
                                   │
  Layer 2: WP05 (setup wizard) ──── depends on WP02
           WP06 (dashboard) ─────── depends on WP01, WP03
                                   │
  Layer 3: WP07 (integration) ───── depends on WP01-WP06

Phase 2:
  Layer 0: WP09 (skill-sync) ────── independent
  Layer 1: WP08 (keychain) ──────── depends on WP07 (Phase 1 gate)
  Layer 2: WP10 (version gate) ──── depends on WP09

Phase 3:
  Layer 0: WP11 (signing) ───────── independent (external dep)
           WP12 (readiness) ──────── depends on WP08, WP09
           WP13 (error recovery) ─── depends on WP07
  Layer 1: WP14 (UAT, manual) ───── depends on WP11, WP12, WP13
```

## Parallelization Opportunities

- **Phase 1 Layer 0**: WP01, WP03, WP04 can start simultaneously
- **Phase 1 Layer 2**: WP05 and WP06 can run in parallel (different files)
- **Phase 2**: WP09 is independent of WP08 path
- **Phase 3**: WP11, WP12, WP13 can run in parallel

---

## Phase 1 — Minimum Viable Dogfood

### WP01 — Sidecar Recon Handlers
**Prompt**: [`tasks/WP01-sidecar-recon-handlers.md`](tasks/WP01-sidecar-recon-handlers.md)
**Dependencies**: none
**Priority**: P0
**Estimated prompt size**: ~350 lines

- [x] T001 Create recon.ts sidecar module scaffold
- [x] T002 Implement recon.create handler
- [x] T003 Implement recon.scan handler
- [x] T004 Implement recon.export handler
- [x] T005 Bundle scan-sensitive-output.mjs in resources

### WP02 — Sidecar Credential Handlers
**Prompt**: [`tasks/WP02-sidecar-credential-handlers.md`](tasks/WP02-sidecar-credential-handlers.md)
**Dependencies**: WP01
**Priority**: P0
**Estimated prompt size**: ~350 lines

- [ ] T006 Create credentials.ts sidecar module scaffold
- [ ] T007 Implement credentials.save handler
- [ ] T008 Implement credentials.list handler
- [ ] T009 Implement credentials.verify handler
- [ ] T010 Register recon + credential handlers in services.ts

### WP03 — Rust Engagement Commands
**Prompt**: [`tasks/WP03-rust-engagement-commands.md`](tasks/WP03-rust-engagement-commands.md)
**Dependencies**: none
**Priority**: P0
**Estimated prompt size**: ~400 lines

- [ ] T011 Create recon.rs Rust module with process state
- [ ] T012 Implement launch_recon command
- [ ] T013 Implement get_engagement_status command
- [ ] T014 Implement cancel_engagement command
- [ ] T015 Add create_engagement proxy and register commands

### WP04 — Completion Sentinel
**Prompt**: [`tasks/WP04-completion-sentinel.md`](tasks/WP04-completion-sentinel.md)
**Dependencies**: none
**Priority**: P0
**Execution**: manual
**Estimated prompt size**: ~150 lines

- [x] T016 Append completion signaling section to Recon skill
- [x] T017 Add Phase 0 prereq check to Recon skill

### WP05 — Setup Wizard Frontend
**Prompt**: [`tasks/WP05-setup-wizard-frontend.md`](tasks/WP05-setup-wizard-frontend.md)
**Dependencies**: WP02
**Priority**: P0
**Estimated prompt size**: ~450 lines

- [ ] T018 Create ReconSetup.tsx wizard page structure
- [ ] T019 Implement Claude Code detection (Step 1)
- [ ] T020 Create CredentialForm.tsx component
- [ ] T021 Implement credential entry wizard step (Step 2)
- [ ] T022 Implement skill installation check (Step 3)
- [ ] T023 Add first-run detection hook (useReconSetup)

### WP06 — Engagement Dashboard Frontend
**Prompt**: [`tasks/WP06-engagement-dashboard-frontend.md`](tasks/WP06-engagement-dashboard-frontend.md)
**Dependencies**: WP01, WP03
**Priority**: P0
**Estimated prompt size**: ~400 lines

- [ ] T024 Create ReconDashboard.tsx with New Engagement form
- [ ] T025 Create EngagementStatus.tsx component
- [ ] T026 Implement progress streaming via safeListen
- [ ] T027 Implement post-completion scan and export flow
- [ ] T028 Add /recon routes to App.tsx and Layout nav

### WP07 — Phase 1 Integration
**Prompt**: [`tasks/WP07-phase1-integration.md`](tasks/WP07-phase1-integration.md)
**Dependencies**: WP01, WP02, WP03, WP04, WP05, WP06
**Priority**: P0
**Estimated prompt size**: ~200 lines

- [ ] T029 Create smoke test script
- [ ] T030 Document assisted setup runbook

---

## Phase 2 — Keychain + Skill Sync

### WP08 — Keychain Module
**Prompt**: [`tasks/WP08-keychain-module.md`](tasks/WP08-keychain-module.md)
**Dependencies**: WP07
**Priority**: P1
**Estimated prompt size**: ~350 lines

- [ ] T031 Add keyring dependency to Cargo.toml
- [ ] T032 Create keychain.rs module (store/retrieve/delete/list)
- [ ] T033 Register Tauri keychain commands
- [ ] T034 Implement flat file → Keychain migration
- [ ] T035 Modify launch_recon to retrieve from Keychain

### WP09 — Skill-Sync Recon Bundle
**Prompt**: [`tasks/WP09-skill-sync-recon-bundle.md`](tasks/WP09-skill-sync-recon-bundle.md)
**Dependencies**: none
**Priority**: P1
**Estimated prompt size**: ~250 lines

- [ ] T036 Add recon-operator-bundle to distribution config
- [ ] T037 Configure skill-sync for joyus-recon repo
- [ ] T038 Modify wizard Step 3 to use sync.trigger
- [ ] T039 Add version display in engagement status

### WP10 — Version Consistency Gate
**Prompt**: [`tasks/WP10-version-consistency-gate.md`](tasks/WP10-version-consistency-gate.md)
**Dependencies**: WP09
**Priority**: P1
**Estimated prompt size**: ~200 lines

- [ ] T040 Implement pre-launch skill version check
- [ ] T041 Implement auto-sync on version mismatch
- [ ] T042 Log skill version in completion sentinel

---

## Phase 3 — Signed Distribution + Polish

### WP11 — Code Signing & Notarization
**Prompt**: [`tasks/WP11-code-signing.md`](tasks/WP11-code-signing.md)
**Dependencies**: none (external: Apple Developer certificate)
**Priority**: P2
**Estimated prompt size**: ~300 lines

- [ ] T043 Configure tauri.conf.json signing identity
- [ ] T044 Create entitlements.plist
- [ ] T045 Create GitHub Actions build workflow
- [ ] T046 Add notarization step to workflow

### WP12 — Readiness Matrix UI
**Prompt**: [`tasks/WP12-readiness-matrix-ui.md`](tasks/WP12-readiness-matrix-ui.md)
**Dependencies**: WP08, WP09
**Priority**: P2
**Estimated prompt size**: ~250 lines

- [ ] T047 Create ReadinessMatrix.tsx component
- [ ] T048 Implement preflight check and engagement blocking

### WP13 — Error Recovery UX
**Prompt**: [`tasks/WP13-error-recovery-ux.md`](tasks/WP13-error-recovery-ux.md)
**Dependencies**: WP07
**Priority**: P2
**Estimated prompt size**: ~250 lines

- [ ] T049 Implement engagement timeout alert
- [ ] T050 Implement crash recovery
- [ ] T051 Implement scan failure UX with override audit log

### WP14 — Aaron UAT
**Prompt**: [`tasks/WP14-aaron-uat.md`](tasks/WP14-aaron-uat.md)
**Dependencies**: WP11, WP12, WP13
**Priority**: P2
**Execution**: manual
**Estimated prompt size**: ~150 lines

- [ ] T052 Execute Aaron UAT and document findings

---

## Effort Summary

| Phase | WPs | Subtasks | Critical Path |
|-------|-----|----------|---------------|
| Phase 1 | 7 (WP01–WP07) | 30 | WP01 → WP02 → WP05 → WP07 |
| Phase 2 | 3 (WP08–WP10) | 12 | WP07 → WP08 |
| Phase 3 | 4 (WP11–WP14) | 10 | WP11+WP12+WP13 → WP14 |
| **Total** | **14** | **52** | **6 weeks** |
