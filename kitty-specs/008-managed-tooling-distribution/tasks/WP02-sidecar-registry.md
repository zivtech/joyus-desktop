---
work_package_id: WP02
title: Sidecar Registry Module
lane: planned
dependencies: []
requirement_refs: [FR-007, FR-013]
planning_base_branch: feat/008-managed-tooling-distribution
merge_target_branch: feat/008-managed-tooling-distribution
branch_strategy: Planning artifacts for this feature were generated on feat/008-managed-tooling-distribution. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/008-managed-tooling-distribution unless the human explicitly redirects the landing branch.
subtasks: [T007, T008, T009, T010, T011]
history:
- date: '2026-04-01'
  event: created
  note: Generated from spec-kitty.tasks
---

# WP02: Sidecar Registry Module

**Implement command**: `spec-kitty implement WP02`

## Objective

Implement the `.claude/.joyus-managed.json` sidecar registry that tracks ownership of managed entries. The registry supports read, write, and self-repair (rebuild from prefix scanning).

## Context

- The registry lives at `~/.claude/.joyus-managed.json` by default (path configurable)
- It's a cache/acceleration layer — the `joyus:` prefix is the canonical ownership signal
- If the registry is missing or corrupted, the reconciler must be able to rebuild it by scanning settings.json for `joyus:`-prefixed entries
- Registry types are defined in `contracts/managed-registry.ts`
- Follow the same file I/O patterns as `packages/skill-sync/src/metadata.ts` (readSyncMetadata/writeSyncMetadata)

## Subtasks

### T007: Define registry types

**Purpose**: Create TypeScript types for the managed registry.

**Steps**:
1. Create `packages/settings-reconciler/src/registry.ts`
2. Define types adapted from `contracts/managed-registry.ts`:
   - `RegistryEntry` — `{ type: "hook" | "mcp", bundle, manifest_version, event?, target, installed_at }`
   - `ManagedRegistry` — `{ schema_version, entries: Record<string, RegistryEntry>, last_reconciled }`
3. All properties readonly

**Files**:
- `packages/settings-reconciler/src/registry.ts` (new, ~25 lines)

---

### T008: Implement registry read

**Purpose**: Read the sidecar registry from disk, gracefully handling missing or corrupted files.

**Steps**:
1. Implement `readRegistry(registryPath: string): Promise<ManagedRegistry | undefined>`
2. On ENOENT: return `undefined` (no registry exists yet)
3. On JSON parse error: log warning, return `undefined` (triggers repair path in reconciler)
4. On success: return parsed ManagedRegistry
5. Do NOT validate schema_version here — that's the reconciler's responsibility

**Files**:
- `packages/settings-reconciler/src/registry.ts` (extend, ~20 lines)

**Validation**:
- [ ] Returns parsed registry on valid file
- [ ] Returns undefined on missing file
- [ ] Returns undefined on corrupted JSON (doesn't throw)

---

### T009: Implement registry write

**Purpose**: Write the registry atomically to prevent corruption on crash.

**Steps**:
1. Implement `writeRegistry(registryPath: string, registry: ManagedRegistry): Promise<void>`
2. Use write-to-temp-then-rename pattern:
   - Write to `${registryPath}.tmp`
   - `fs.rename()` to final path
3. Create parent directory if it doesn't exist (`mkdir -p`)
4. Pretty-print JSON with 2-space indent + trailing newline (matching skill-sync metadata format)

**Files**:
- `packages/settings-reconciler/src/registry.ts` (extend, ~15 lines)

**Validation**:
- [ ] Written file is valid JSON
- [ ] Parent directories created if missing
- [ ] Atomic write (temp-then-rename)

---

### T010: Implement registry repair from prefix scanning

**Purpose**: Rebuild the registry by scanning settings.json for `joyus:`-prefixed entries when the registry is missing or corrupted.

**Steps**:
1. Implement `repairRegistry(settingsPath: string, now?: () => Date): Promise<ManagedRegistry>`
2. Read settings.json from `settingsPath`
3. Scan `hooks` object: for each event type array, find matcher groups where `matcher` starts with `joyus:`
   - Create a RegistryEntry with `type: "hook"`, `event` from the event type key, `bundle: "unknown"`, `manifest_version: "unknown"`, `target: "global"`, `installed_at` from clock
4. Scan `mcpServers` object: find keys starting with `joyus:`
   - Create a RegistryEntry with `type: "mcp"`, `bundle: "unknown"`, `manifest_version: "unknown"`, `target: "global"`, `installed_at` from clock
5. Return a ManagedRegistry with `schema_version: "1.0"`, the discovered entries, and `last_reconciled` from clock
6. If settings.json is missing or corrupted, return an empty registry

**Files**:
- `packages/settings-reconciler/src/registry.ts` (extend, ~50 lines)

**Validation**:
- [ ] Finds joyus: hooks across all event types
- [ ] Finds joyus: MCP server keys
- [ ] Returns empty registry for missing/corrupted settings
- [ ] Sets bundle/manifest_version to "unknown" (will be corrected on next reconciliation)

---

### T011: Tests for registry module

**Purpose**: Achieve 100% coverage on the registry module.

**Steps**:
1. Create `packages/settings-reconciler/test/registry.test.ts`
2. Test `readRegistry`:
   - Valid JSON file → returns ManagedRegistry
   - Missing file (ENOENT) → returns undefined
   - Corrupted JSON → returns undefined (no throw)
   - Empty file → returns undefined
3. Test `writeRegistry`:
   - Writes valid JSON
   - Creates parent directories
   - Atomic write (verify temp file doesn't persist)
4. Test `repairRegistry`:
   - Settings with joyus: hooks in multiple event types → all found
   - Settings with joyus: MCP servers → all found
   - Settings with mixed user + managed entries → only joyus: entries in result
   - Missing settings file → empty registry
   - Corrupted settings file → empty registry
   - Settings with no joyus: entries → empty registry

**Files**:
- `packages/settings-reconciler/test/registry.test.ts` (new, ~150 lines)

**Validation**:
- [ ] All tests pass
- [ ] 100% coverage on registry.ts

## Definition of Done

- [ ] Registry types defined with readonly properties
- [ ] Read handles missing, corrupted, and valid files
- [ ] Write is atomic (temp-then-rename)
- [ ] Repair scans both hooks and MCP servers for joyus: prefix
- [ ] 100% test coverage

## Reviewer Guidance

- Verify repair scanning covers ALL Claude Code hook event types (not just PreToolUse)
- Verify atomic write uses same-directory temp file (required for rename atomicity)
- Verify corrupted file handling never throws — always returns undefined or empty registry
