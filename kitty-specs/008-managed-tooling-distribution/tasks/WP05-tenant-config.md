---
work_package_id: WP05
title: Tenant Config Module
lane: approved
dependencies: [WP01]
requirement_refs: [FR-009]
planning_base_branch: feat/008-managed-tooling-distribution
merge_target_branch: feat/008-managed-tooling-distribution
branch_strategy: Planning artifacts for this feature were generated on feat/008-managed-tooling-distribution. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/008-managed-tooling-distribution unless the human explicitly redirects the landing branch.
subtasks: [T024, T025, T026, T027]
agent: codex
shell_pid: '76971'
review_status: approved
reviewed_by: Alex Urevick-Ackelsberg
history:
- date: '2026-04-01'
  event: created
  note: Generated from spec-kitty.tasks
---

# WP05: Tenant Config Module

**Implement command**: `spec-kitty implement WP05 --base WP01`

## Objective

Implement tenant config aggregation and file write. This enables hook scripts to read per-tenant configuration values (e.g., chat-length threshold) from a well-known local file.

## Context

- Tenant config is aggregated from the `config` field of each ManifestBundle
- Written to `~/.claude/.joyus-config.json` by default (overridable via `manifest.config_path`)
- Hook scripts read this file at runtime — it must be valid JSON with tenant_id and metadata
- This is a leaf module with only a dependency on WP01 (manifest types)

## Subtasks

### T024: Implement tenant config aggregation

**Purpose**: Merge config objects from all bundles in a manifest into a single TenantConfig.

**Steps**:
1. Create `packages/settings-reconciler/src/tenantConfig.ts`
2. Define type:
   ```typescript
   interface TenantConfig {
     readonly tenant_id: string;
     readonly parameters: Readonly<Record<string, unknown>>;
     readonly updated_at: string;
   }
   ```
3. Implement:
   ```typescript
   function aggregateTenantConfig(
     manifest: DistributionManifest,
     now?: () => Date
   ): TenantConfig
   ```
4. Iterate bundles in key order (deterministic). For each bundle with a `config` field, shallow-merge into `parameters`. Later bundles override earlier ones for duplicate keys.
5. Set `tenant_id` from manifest, `updated_at` from clock

**Files**:
- `packages/settings-reconciler/src/tenantConfig.ts` (new, ~30 lines)

**Validation**:
- [ ] Single bundle config → parameters match
- [ ] Multiple bundles → later overrides earlier for same key
- [ ] No config in any bundle → empty parameters
- [ ] tenant_id from manifest

---

### T025: Implement tenant config file write

**Purpose**: Write the aggregated tenant config to a local file.

**Steps**:
1. Implement:
   ```typescript
   async function writeTenantConfig(
     config: TenantConfig,
     configPath: string
   ): Promise<void>
   ```
2. Use atomic write (temp-then-rename, same as settings file)
3. Pretty-print JSON with trailing newline
4. Create parent directory if missing

**Files**:
- `packages/settings-reconciler/src/tenantConfig.ts` (extend, ~15 lines)

---

### T026: Handle config path override

**Purpose**: Resolve the config file path from manifest or use default.

**Steps**:
1. Implement:
   ```typescript
   function resolveConfigPath(manifest: DistributionManifest): string
   ```
2. If `manifest.config_path` is set, resolve it (handle `~` home path expansion using `resolveHomePath` from skill-sync or reimplement)
3. If not set, return default: `~/.claude/.joyus-config.json`

**Files**:
- `packages/settings-reconciler/src/tenantConfig.ts` (extend, ~15 lines)

---

### T027: Tests for tenant config

**Purpose**: Achieve 100% coverage on tenantConfig.ts.

**Steps**:
1. Create `packages/settings-reconciler/test/tenantConfig.test.ts`
2. Test `aggregateTenantConfig`:
   - Single bundle with config → correct parameters
   - Multiple bundles → merge with override order
   - No config fields → empty parameters
   - Empty bundles → empty parameters
   - Verify tenant_id carried from manifest
3. Test `writeTenantConfig`:
   - Writes valid JSON
   - Creates parent directory
   - Atomic write (temp-then-rename)
4. Test `resolveConfigPath`:
   - Manifest with config_path → resolved path
   - Manifest without config_path → default path
   - Path with `~` → expanded to home directory

**Files**:
- `packages/settings-reconciler/test/tenantConfig.test.ts` (new, ~100 lines)

**Validation**:
- [ ] All tests pass
- [ ] 100% coverage on tenantConfig.ts

## Definition of Done

- [ ] Config aggregation merges bundles deterministically
- [ ] File write is atomic
- [ ] Path override works with home expansion
- [ ] 100% test coverage

## Reviewer Guidance

- Verify bundle iteration order is deterministic (sorted keys, not insertion order)
- Verify shallow merge semantics (no deep merge — bundle config values can be objects but they replace, not merge)
- Verify home path expansion handles both `~` and `~/...` patterns

## Activity Log

- 2026-04-02T03:03:15Z – codex – shell_pid=76971 – lane=doing – Started implementation via workflow command
- 2026-04-02T03:20:16Z – codex – shell_pid=76971 – lane=for_review – Ready for review: tenant config aggregation, atomic write, path resolution, 100% coverage
- 2026-04-02T11:52:23Z – codex – shell_pid=76971 – lane=approved – Approved: codex implementation reviewed and accepted
