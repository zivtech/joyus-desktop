# Work Packages: Skill & MCP Server Distribution

**Total**: 11 work packages (6 Phase 1, 5 Phase 2)
**Subtasks**: 64 (T001–T064)

## Dependency Graph

```
Phase 1:
  Layer 0: WP01 (skill packaging), WP02 (MCP connector setup)   [parallel]
  Layer 1: WP03 (git sync), WP04 (version pinning)              [parallel, depend on WP01]
  Layer 2: WP05 (telemetry)                                      [depends on WP01, WP02]
  Layer 3: WP10 (Phase 1 verification)                           [depends on WP01–WP05]

Phase 2:
  Layer 0: WP06 (fix mcp-tools bugs)                             [can start anytime]
  Layer 1: WP07 (desktop MCP provisioning)                       [depends on WP06]
           WP08 (desktop git sync)                               [depends on WP06, WP03]
  Layer 2: WP09 (governance & telemetry integration)             [depends on WP07, WP05]
  Layer 3: WP11 (Phase 2 verification & rollout)                 [depends on WP07–WP10]
```

## Parallelization Opportunities

- **Layer 0**: WP01 + WP02 + WP06 can all start simultaneously
- **Layer 1**: WP03 + WP04 can run in parallel (both depend only on WP01)
- **Phase 2 Layer 1**: WP07 + WP08 can run in parallel (both depend on WP06)

---

## Phase 1 — Cowork Distribution

### WP01 — Skill Packaging & Bundling
**Prompt**: [`tasks/WP01-skill-packaging.md`](tasks/WP01-skill-packaging.md)
**Dependencies**: none
**Subtasks**: T001–T005 (5 subtasks, ~350 lines)

- [ ] T001: Audit all 29 skills for Cowork plugin format compatibility
- [ ] T002: Define bundle manifests (PM Bundle, Developer Bundle, Milk Jawn Bundle, Full Bundle)
- [ ] T003: Adapt skill markdown to Cowork plugin format (if needed)
- [ ] T004: Publish skill bundles to Cowork for both orgs
- [ ] T005: Verify at least one skill is invocable by a non-admin user

### WP02 — First-Party MCP Connector Setup
**Prompt**: [`tasks/WP02-mcp-connector-setup.md`](tasks/WP02-mcp-connector-setup.md)
**Dependencies**: none
**Subtasks**: T006–T012 (7 subtasks, ~450 lines)

- [ ] T006: Configure Atlassian connector for Zivtech org
- [ ] T007: Configure Slack connector for Zivtech org
- [ ] T008: Configure Google Workspace connector for Zivtech org
- [ ] T009: Configure connectors for Milk Jawn org
- [ ] T010: Configure additional connectors (Figma, Notion, Playwright)
- [ ] T011: Document OAuth consent flow for end users
- [ ] T012: Verify each connector responds to tool calls from a non-admin user

### WP03 — Git Sync for CLI Developers
**Prompt**: [`tasks/WP03-git-sync.md`](tasks/WP03-git-sync.md)
**Dependencies**: WP01
**Subtasks**: T013–T018 (6 subtasks, ~400 lines)

- [ ] T013: Build sync script that clones/pulls zivtech-meta-skills at pinned tag
- [ ] T014: Integrate as Claude Code session hook (startup trigger, <10s)
- [ ] T015: Handle offline gracefully (last good state, no error surfaced)
- [ ] T016: Handle local modification conflicts (overwrite + warn)
- [ ] T017: Document one-time developer setup
- [ ] T018: Verify with 2 developer testers

### WP04 — Version Pinning & Admin Controls
**Prompt**: [`tasks/WP04-version-pinning.md`](tasks/WP04-version-pinning.md)
**Dependencies**: WP01
**Subtasks**: T019–T023 (5 subtasks, ~350 lines)

- [ ] T019: Establish semver tagging convention for zivtech-meta-skills
- [ ] T020: Create admin config for pinned version per bundle
- [ ] T021: Ensure Cowork plugin updates respect pin
- [ ] T022: Ensure git sync respects the same pin
- [ ] T023: Verify version pin change propagates within one session restart

### WP05 — Telemetry Foundation
**Prompt**: [`tasks/WP05-telemetry.md`](tasks/WP05-telemetry.md)
**Dependencies**: WP01, WP02
**Subtasks**: T024–T030 (7 subtasks, ~480 lines)

- [ ] T024: Define telemetry event schema
- [ ] T025: Identify Cowork-side collection mechanism
- [ ] T026: Identify CLI-side collection mechanism
- [ ] T027: Stand up aggregation endpoint or reuse joyus-ai infrastructure
- [ ] T028: Build admin usage report (script or dashboard)
- [ ] T029: Implement per-user telemetry opt-out mechanism (FR-008)
- [ ] T030: Verify events appear for both Cowork and CLI usage

### WP10 — Phase 1 Verification & Rollout
**Prompt**: [`tasks/WP10-phase1-verification.md`](tasks/WP10-phase1-verification.md)
**Dependencies**: WP01, WP02, WP03, WP04, WP05
**Subtasks**: T053–T060 (8 subtasks, ~500 lines)

- [ ] T053: E2E — New Cowork user onboards, receives skills, uses cloud MCPs
- [ ] T054: E2E — Developer onboards CLI, git sync works, skills available
- [ ] T055: Verify Cowork skills and cloud MCPs function without desktop companion (FR-014)
- [ ] T056: SC-001 — All target users invoke a skill in Cowork within 24h
- [ ] T057: SC-002 — Atlassian, Slack, Google MCPs functional within 48h
- [ ] T058: SC-003 — CLI developer sync works without manual git (2 testers)
- [ ] T059: SC-004 — Admin views aggregated telemetry within 1 week
- [ ] T060: SC-005 — Version pin change propagates within one session restart

---

## Phase 2 — Desktop Companion

### WP06 — Fix zivtech-mcp-tools Critical Issues
**Prompt**: [`tasks/WP06-mcp-tools-fixes.md`](tasks/WP06-mcp-tools-fixes.md)
**Dependencies**: none (can start anytime)
**Subtasks**: T031–T038 (8 subtasks, ~500 lines)

- [ ] T031: Fix async/await bug in all MCP server executors (CRITICAL-1)
- [ ] T032: Add per-package tsconfig.json files (CRITICAL-2)
- [ ] T033: Fix workspace protocol to match package manager (MAJOR-1)
- [ ] T034: Move governance enforcement inside try/catch (MAJOR-6)
- [ ] T035: Fix or exclude shell packages from build (MAJOR-5)
- [ ] T036: Wire telemetry config values through collector (MAJOR-2, MAJOR-3)
- [ ] T037: Align documentation defaults with code defaults (MINOR-3)
- [ ] T038: Verify npm run build and npm run typecheck pass at root

### WP07 — Desktop MCP Provisioning
**Prompt**: [`tasks/WP07-desktop-mcp-provisioning.md`](tasks/WP07-desktop-mcp-provisioning.md)
**Dependencies**: WP06
**Subtasks**: T039–T043 (5 subtasks, ~400 lines)

- [ ] T039: Add MCP registry module to joyus-desktop
- [ ] T040: Auto-register local MCPs in Claude Code .mcp.json
- [ ] T041: Integrate with packages/updater for version checks
- [ ] T042: Ensure clean start/stop (no orphaned Node processes)
- [ ] T043: Verify local MCP tools respond to calls in Claude Code

### WP08 — Desktop Git Sync Integration
**Prompt**: [`tasks/WP08-desktop-git-sync.md`](tasks/WP08-desktop-git-sync.md)
**Dependencies**: WP06, WP03
**Subtasks**: T044–T047 (4 subtasks, ~300 lines)

- [ ] T044: Embed git sync into desktop companion lifecycle
- [ ] T045: Desktop manages clone directory transparently
- [ ] T046: Respect same version pin as Cowork distribution
- [ ] T047: Verify skills update when pin changes without user action

### WP09 — Governance & Telemetry Integration
**Prompt**: [`tasks/WP09-governance-telemetry.md`](tasks/WP09-governance-telemetry.md)
**Dependencies**: WP07, WP05
**Subtasks**: T048–T052 (5 subtasks, ~380 lines)

- [ ] T048: Connect local MCP governance to feature 001 policy enforcement
- [ ] T049: Route local telemetry through @zivtech-mcp/shared pipeline
- [ ] T050: Make governance mode (off/audit/enforce) remotely configurable
- [ ] T051: Verify tool blocking works in enforce mode
- [ ] T052: Verify telemetry events from local MCPs appear in admin report

### WP11 — Phase 2 Verification & Documentation
**Prompt**: [`tasks/WP11-phase2-verification.md`](tasks/WP11-phase2-verification.md)
**Dependencies**: WP07, WP08, WP09, WP10
**Subtasks**: T061–T064 (4 subtasks, ~300 lines)

- [ ] T061: E2E — Desktop companion install provisions local MCPs
- [ ] T062: SC-006 — Desktop companion provisions local MCPs for 2 testers
- [ ] T063: Collect user feedback from initial rollout group
- [ ] T064: Document known limitations and next steps
