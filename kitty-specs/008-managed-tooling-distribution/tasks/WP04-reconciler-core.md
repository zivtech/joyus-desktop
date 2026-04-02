---
work_package_id: WP04
title: Reconciler Core — Hook & MCP Merge
lane: planned
dependencies: [WP01, WP02, WP03]
requirement_refs: [FR-001, FR-004, FR-005, FR-006, FR-008, FR-016, FR-017, FR-019]
planning_base_branch: feat/008-managed-tooling-distribution
merge_target_branch: feat/008-managed-tooling-distribution
branch_strategy: Planning artifacts for this feature were generated on feat/008-managed-tooling-distribution. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/008-managed-tooling-distribution unless the human explicitly redirects the landing branch.
subtasks: [T017, T018, T019, T020, T021, T022, T023]
history:
- date: '2026-04-01'
  event: created
  note: Generated from spec-kitty.tasks
---

# WP04: Reconciler Core — Hook & MCP Merge

**Implement command**: `spec-kitty implement WP04 --base WP01`

## Objective

Implement the core `reconcile()` function that merges managed hooks and MCP servers into settings.json, handles removals, routes entries to global or project settings, and rolls back on failure.

## Context

- This WP depends on WP01 (manifest types/validation), WP02 (registry read/write/repair), and WP03 (settings file read/write/backup/rollback)
- The reconciler is a pure library — it receives a manifest and config, returns a result. No scheduling, no network calls.
- Internal merge functions are pure (take objects, return new objects). Side effects only in the top-level `reconcile()`.
- The reconciler contract is defined in `contracts/reconciler-api.ts`
- Hook format reference: hooks are `{ [EventType]: Array<{ matcher: string, hooks: Array<{ type: "command", command: string, timeout?: number }> }> }`
- MCP format: `{ mcpServers: { [name: string]: { command, args?, env? } } }`

## Subtasks

### T017: Implement hook merge

**Purpose**: Append managed hook entries to settings.json without disturbing user hooks.

**Steps**:
1. Create `packages/settings-reconciler/src/reconciler.ts`
2. Implement internal function:
   ```typescript
   function mergeHooks(
     currentHooks: Record<string, unknown[]>,
     manifestHooks: readonly ManifestHook[]
   ): Record<string, unknown[]>
   ```
3. For each manifest hook:
   - Find or create the array for `hook.event` in currentHooks
   - Check if a matcher group with this matcher already exists (update it)
   - If not, append a new matcher group: `{ matcher: hook.matcher, hooks: [{ type: "command", command: hook.command, timeout: hook.timeout ?? 5 }] }`
4. Return a NEW object (do not mutate input)
5. Preserve all non-joyus: matcher groups exactly as-is

**Files**:
- `packages/settings-reconciler/src/reconciler.ts` (new, ~40 lines)

**Validation**:
- [ ] User hooks in same event type preserved
- [ ] New managed hooks appended
- [ ] Existing managed hooks updated (not duplicated)
- [ ] Input objects not mutated

---

### T018: Implement hook removal

**Purpose**: Remove managed hook entries that are no longer in the manifest.

**Steps**:
1. Implement internal function:
   ```typescript
   function removeStaleHooks(
     currentHooks: Record<string, unknown[]>,
     activeIds: ReadonlySet<string>
   ): Record<string, unknown[]>
   ```
2. For each event type array in currentHooks:
   - Filter out matcher groups where `matcher` starts with `joyus:` AND matcher is NOT in `activeIds`
   - Keep all non-joyus: matcher groups
3. If an event type array becomes empty after filtering, remove the key
4. Return a NEW object

**Files**:
- `packages/settings-reconciler/src/reconciler.ts` (extend, ~25 lines)

**Validation**:
- [ ] Stale managed hooks removed
- [ ] Active managed hooks preserved
- [ ] User hooks untouched
- [ ] Empty event type arrays cleaned up

---

### T019: Implement MCP server merge

**Purpose**: Add or update managed MCP server entries in settings.

**Steps**:
1. Implement internal function:
   ```typescript
   function mergeMcpServers(
     currentServers: Record<string, unknown>,
     manifestServers: readonly ManifestMcpServer[]
   ): Record<string, unknown>
   ```
2. For each manifest MCP server:
   - Set `currentServers[server.id]` to `{ command: server.command, args: server.args, env: server.env }` (omit undefined fields)
3. Return a NEW object (spread current, then set managed entries)

**Files**:
- `packages/settings-reconciler/src/reconciler.ts` (extend, ~20 lines)

**Validation**:
- [ ] New MCP servers added
- [ ] Existing managed MCP servers updated
- [ ] User MCP servers untouched

---

### T020: Implement MCP server removal

**Purpose**: Remove managed MCP server entries no longer in the manifest.

**Steps**:
1. Implement internal function:
   ```typescript
   function removeStaleMcpServers(
     currentServers: Record<string, unknown>,
     activeIds: ReadonlySet<string>
   ): Record<string, unknown>
   ```
2. Filter out keys starting with `joyus:` that are NOT in `activeIds`
3. Return a NEW object

**Files**:
- `packages/settings-reconciler/src/reconciler.ts` (extend, ~15 lines)

---

### T021: Implement global vs project target routing

**Purpose**: Route managed entries to the correct settings file based on manifest `target` field.

**Steps**:
1. Implement internal function:
   ```typescript
   function partitionByTarget(
     hooks: readonly ManifestHook[],
     mcpServers: readonly ManifestMcpServer[]
   ): { global: { hooks: ManifestHook[], mcps: ManifestMcpServer[] }, project: { hooks: ManifestHook[], mcps: ManifestMcpServer[] } }
   ```
2. Partition hooks by `target ?? "global"` (default to global)
3. Partition MCP servers by `target ?? "global"`
4. The reconcile() function calls this first, then reconciles global and project settings separately

**Files**:
- `packages/settings-reconciler/src/reconciler.ts` (extend, ~20 lines)

---

### T022: Implement full reconcile() pipeline

**Purpose**: The top-level public API that orchestrates the entire reconciliation.

**Steps**:
1. Implement:
   ```typescript
   async function reconcile(
     manifest: DistributionManifest,
     config?: ReconcileConfig
   ): Promise<ReconcileResult>
   ```
2. Pipeline:
   a. Resolve paths (globalSettingsPath, projectSettingsPath, registryPath, backupDir, defaults)
   b. Read current registry (or repair if missing/corrupted)
   c. Partition manifest entries by target (global vs project)
   d. For global settings:
      - Read current settings
      - Create backup
      - Compute active IDs from manifest
      - Merge hooks → remove stale hooks
      - Merge MCP servers → remove stale MCP servers
      - Write updated settings (atomic)
   e. For project settings (if any project-targeted entries exist):
      - Same pipeline as global
   f. Count additions, updates, removals by comparing old/new registry
   g. Build new registry from manifest (replace "unknown" bundle/version from repair with actual values)
   h. Write registry
   i. Return ReconcileResult with counts and status
3. Wrap entire pipeline in try/catch:
   - On failure: rollback both settings files from backups
   - Set status to "rolled_back"
   - Include error message in result
4. If manifest schema_version is unsupported: return `{ status: "skipped", ... }` without modifying anything

**Files**:
- `packages/settings-reconciler/src/reconciler.ts` (extend, ~80 lines)

**Validation**:
- [ ] Full pipeline completes successfully for valid manifest
- [ ] Rollback triggered on any write failure
- [ ] Unsupported schema version returns skipped status
- [ ] Entry counts accurate (added, updated, removed)

---

### T023: Tests for reconciler

**Purpose**: Achieve 100% coverage on reconciler.ts.

**Steps**:
1. Create `packages/settings-reconciler/test/reconciler.test.ts`
2. Test pure merge functions:
   - `mergeHooks`: user hooks preserved, managed hooks appended, existing managed hooks updated
   - `removeStaleHooks`: stale removed, active kept, user untouched, empty arrays cleaned
   - `mergeMcpServers`: user servers preserved, managed added/updated
   - `removeStaleMcpServers`: stale removed, active kept, user untouched
   - `partitionByTarget`: correct routing, default to global
3. Test `reconcile()` pipeline:
   - Fresh reconciliation (no prior registry) → entries added, registry created
   - Update reconciliation (prior registry exists) → entries updated, counts correct
   - Removal (entry removed from manifest) → cleaned from settings + registry
   - Full revocation (empty bundles) → all managed entries removed
   - Rollback on write failure (inject failing writeSettingsFile) → original settings restored
   - Unsupported schema version → skipped status, no changes
   - Mixed global + project entries → routed to correct files
   - Registry repair path (missing registry, entries exist in settings) → repaired and reconciled
4. Use temp directories for all file operations

**Files**:
- `packages/settings-reconciler/test/reconciler.test.ts` (new, ~300 lines)

**Validation**:
- [ ] All tests pass
- [ ] 100% coverage on reconciler.ts

## Definition of Done

- [ ] All four merge/removal functions are pure (no mutations)
- [ ] Target routing correctly partitions entries
- [ ] Full pipeline handles success, failure/rollback, and skip paths
- [ ] User settings never modified
- [ ] Registry updated with accurate metadata
- [ ] 100% test coverage

## Risks

- **Settings.json may have unexpected structure**: The reconciler assumes `hooks` is an object of arrays and `mcpServers` is an object. If settings.json has a different shape (e.g., hooks as a flat array), the merge will need adaptation. Mitigation: handle missing/non-object hooks/mcpServers gracefully (treat as empty).

## Reviewer Guidance

- Verify all merge functions return NEW objects (no mutation of inputs)
- Verify rollback covers BOTH global and project settings files
- Verify empty manifest bundles triggers full removal of managed entries
- Verify registry repair is triggered when readRegistry returns undefined
- Verify the reconcile function doesn't depend on WP05 (tenant config) — that's separate
