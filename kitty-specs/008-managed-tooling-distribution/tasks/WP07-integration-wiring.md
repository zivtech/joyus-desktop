---
work_package_id: WP07
title: Integration Wiring & Acceptance
lane: approved
dependencies: [WP04, WP05, WP06]
requirement_refs: [FR-011, FR-012, FR-018]
planning_base_branch: feat/008-managed-tooling-distribution
merge_target_branch: feat/008-managed-tooling-distribution
branch_strategy: Planning artifacts for this feature were generated on feat/008-managed-tooling-distribution. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/008-managed-tooling-distribution unless the human explicitly redirects the landing branch.
subtasks: [T034, T035, T036, T037, T038]
review_status: approved
reviewed_by: Alex Urevick-Ackelsberg
history:
- date: '2026-04-01'
  event: created
  note: Generated from spec-kitty.tasks
---

# WP07: Integration Wiring & Acceptance

**Implement command**: `spec-kitty implement WP07 --base WP04`

## Objective

Wire the config-check poller, skill-sync, and settings reconciler together in desktop-companion. Validate the full pipeline end-to-end including revocation. Pass all CI gates.

## Context

- Desktop-companion already has sidecar modules (`usage-collector.ts`, `sessionWiring.ts`) — this adds `configCheckPoller` wiring
- The orchestration is deliberately simple: three function calls in sequence
- Existing `packages/skill-sync` is used as-is — no modifications
- Integration tests use temp directories and mock fetch (same patterns as existing desktop-companion tests)
- The full CI pipeline is `pnpm ci` (typecheck + 100% coverage)

## Subtasks

### T034: Wire configCheckPoller into desktop-companion sidecar

**Purpose**: Initialize and start the config-check poller when the desktop app starts.

**Steps**:
1. In the desktop-companion sidecar initialization (find the existing pattern in `src/sidecar/`), import and configure the poller:
   ```typescript
   import { startConfigCheckPoller } from "./configCheckPoller";
   ```
2. Create a wiring function:
   ```typescript
   function createConfigCheckWiring(config: {
     manifestUrl: string;
     intervalMs?: number;
     onSync: (manifest: DistributionManifest) => Promise<void>;
   }): PollerHandle
   ```
3. Start the poller with the `onChangeDetected` callback wired to the sync+reconcile pipeline (T035)
4. Return the handle so the app can stop the poller on shutdown

**Files**:
- `apps/desktop-companion/src/sidecar/configCheckWiring.ts` (new, ~30 lines)

**Validation**:
- [ ] Poller starts on initialization
- [ ] Handle returned for lifecycle management

---

### T035: Wire sequential orchestration

**Purpose**: Implement the callback that runs syncSkills → reconcile → writeTenantConfig when a config change is detected.

**Steps**:
1. In `configCheckWiring.ts`, implement the `onSync` callback:
   ```typescript
   async function handleConfigChange(manifest: DistributionManifest): Promise<void> {
     // 1. Resolve version from manifest for skill-sync
     // 2. Run syncSkills() with the resolved config
     // 3. Run reconcile() with the manifest
     // 4. Run writeTenantConfig() with aggregated config
   }
   ```
2. Error handling:
   - If `syncSkills()` fails with `offline` status: skip reconcile (no new files to process), but still run reconcile with cached manifest if it's a revocation
   - If `syncSkills()` fails with `error` status: log, skip reconcile
   - If `reconcile()` fails: it handles its own rollback internally, log the error
   - If `writeTenantConfig()` fails: log but don't rollback settings (tenant config is independent)
3. Each step is independent in terms of failure — one failure doesn't prevent the others from attempting (except sync failure skips reconcile)

**Files**:
- `apps/desktop-companion/src/sidecar/configCheckWiring.ts` (extend, ~40 lines)

**Validation**:
- [ ] Full sequence runs on config change
- [ ] syncSkills failure skips reconcile
- [ ] reconcile failure doesn't affect tenant config write
- [ ] All errors logged, no unhandled throws

---

### T036: Integration test — full pipeline

**Purpose**: Validate the complete flow from manifest to settings.json changes.

**Steps**:
1. Create `apps/desktop-companion/test/sidecar/configCheckWiring.test.ts`
2. Test "full pipeline — deploy hooks and MCPs":
   - Set up temp directories for settings, registry, backups, skills, tenant config
   - Create a manifest with 1 hook (joyus:test-hook, PreToolUse) and 1 MCP server (joyus:test-mcp)
   - Write a pre-existing user hook in settings.json
   - Mock syncSkills to succeed (or use real syncSkills with a local git repo if feasible)
   - Call handleConfigChange with the manifest
   - Assert: settings.json contains the managed hook AND the user hook
   - Assert: settings.json contains the managed MCP server
   - Assert: sidecar registry contains both entries with correct metadata
   - Assert: tenant config file exists with correct parameters
3. Test "update — manifest changes hook command":
   - Start with deployed state from previous test
   - Update manifest with changed command for the hook
   - Call handleConfigChange
   - Assert: hook command updated in settings.json
   - Assert: user hook still intact

**Files**:
- `apps/desktop-companion/test/sidecar/configCheckWiring.test.ts` (new, ~120 lines)

---

### T037: Integration test — revocation + user preservation

**Purpose**: Validate that revocation removes all managed entries while preserving user config.

**Steps**:
1. In the same test file, test "revocation — empty manifest removes managed entries":
   - Start with deployed state (managed hook + managed MCP + user hook + user MCP)
   - Create manifest with empty bundles: `{ schema_version: "1.0", tenant_id: "test", bundles: {} }`
   - Call handleConfigChange
   - Assert: settings.json has NO joyus:-prefixed hooks
   - Assert: settings.json has NO joyus:-prefixed MCP servers
   - Assert: user hook still present and byte-identical
   - Assert: user MCP server still present and byte-identical
   - Assert: sidecar registry has no entries
2. Test "partial revocation — one bundle removed, another kept":
   - Deploy two bundles (bundle-a with hook, bundle-b with MCP)
   - Remove bundle-a from manifest, keep bundle-b
   - Call handleConfigChange
   - Assert: bundle-a's hook removed
   - Assert: bundle-b's MCP still present
   - Assert: registry reflects removal

**Files**:
- `apps/desktop-companion/test/sidecar/configCheckWiring.test.ts` (extend, ~100 lines)

---

### T038: Full CI validation

**Purpose**: Verify all packages pass typecheck and 100% coverage.

**Steps**:
1. Run `pnpm typecheck` — assert zero errors
2. Run `pnpm coverage` — assert 100% on all packages including the new settings-reconciler
3. Fix any coverage gaps or type errors found
4. Verify the new package is included in the root vitest/coverage configuration (check `vitest.config.ts` or `package.json` coverage settings)

**Files**:
- May require updates to root `vitest.config.ts` or `package.json` to include `packages/settings-reconciler` in coverage collection

**Validation**:
- [ ] `pnpm typecheck` passes
- [ ] `pnpm coverage` passes with 100% on all thresholds
- [ ] No type errors in any package
- [ ] New package included in coverage collection

## Definition of Done

- [ ] Config-check poller wired and starting on app init
- [ ] Sequential orchestration handles success and all failure modes
- [ ] Integration tests cover deploy, update, and revocation flows
- [ ] User settings preserved in all scenarios
- [ ] `pnpm ci` passes (typecheck + 100% coverage)

## Risks

- **syncSkills dependency in integration tests**: If integration tests call real syncSkills, they need a git repo fixture. Alternative: mock syncSkills at the wiring boundary.
- **Coverage configuration**: The new package may not be auto-discovered by the root coverage config. Verify the glob patterns in vitest.config.ts.

## Reviewer Guidance

- Verify user hooks/MCPs are byte-identical after reconciliation (not just "present" — must be unchanged)
- Verify error handling: each step's failure is isolated and logged
- Verify the revocation integration test checks BOTH that managed entries are gone AND user entries are untouched
- Verify `pnpm ci` output shows 100% on the new package

## Activity Log

- 2026-04-02T11:22:36Z – unknown – lane=in_progress – Starting implementation via codex
- 2026-04-02T11:44:27Z – unknown – lane=for_review – Ready for review: integration wiring complete, full CI passes (typecheck + 100% coverage)
- 2026-04-02T11:52:24Z – unknown – lane=approved – Approved: codex implementation reviewed and accepted
