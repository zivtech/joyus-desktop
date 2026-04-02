---
work_package_id: WP03
title: Settings File Operations
lane: in_progress
dependencies: []
requirement_refs: [FR-012, FR-014, FR-015]
planning_base_branch: feat/008-managed-tooling-distribution
merge_target_branch: feat/008-managed-tooling-distribution
branch_strategy: Planning artifacts for this feature were generated on feat/008-managed-tooling-distribution. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/008-managed-tooling-distribution unless the human explicitly redirects the landing branch.
subtasks: [T012, T013, T014, T015, T016]
history:
- date: '2026-04-01'
  event: created
  note: Generated from spec-kitty.tasks
---

# WP03: Settings File Operations

**Implement command**: `spec-kitty implement WP03`

## Objective

Implement settings.json file operations — read (with graceful error handling), atomic write, backup with rotation, and rollback on failure.

## Context

- These are generic JSON file operations used by the reconciler for both `~/.claude/settings.json` (global) and `.claude/settings.json` (project)
- The backup/rotation pattern mirrors `packages/skill-sync/src/sync.ts` (`createBackup` function)
- Atomic write uses write-to-temp-then-rename (same as registry write in WP02)
- These functions are building blocks — the reconciler (WP04) orchestrates them

## Subtasks

### T012: Implement settings.json read

**Purpose**: Read and parse a settings.json file, handling all error states gracefully.

**Steps**:
1. Create `packages/settings-reconciler/src/settingsFile.ts`
2. Implement `readSettingsFile(path: string): Promise<Record<string, unknown>>`
3. Handle cases:
   - File exists with valid JSON → return parsed object
   - File doesn't exist (ENOENT) → return `{}` (empty settings)
   - File exists but empty → return `{}`
   - File exists but invalid JSON → return `{}` (caller handles logging/backup)
4. Return type is a plain object (settings.json is always a top-level object, never an array)

**Files**:
- `packages/settings-reconciler/src/settingsFile.ts` (new, ~25 lines)

**Validation**:
- [ ] Valid JSON returns parsed object
- [ ] Missing file returns empty object
- [ ] Corrupted JSON returns empty object (no throw)

---

### T013: Implement atomic write

**Purpose**: Write settings.json atomically to prevent corruption on crash.

**Steps**:
1. Implement `writeSettingsFile(path: string, settings: Record<string, unknown>): Promise<void>`
2. Serialize with `JSON.stringify(settings, null, 2) + "\n"` (pretty-print, trailing newline)
3. Write to `${path}.tmp` in same directory
4. `fs.rename(path + ".tmp", path)` for atomic replacement
5. Create parent directory if missing (`mkdir -p`)

**Files**:
- `packages/settings-reconciler/src/settingsFile.ts` (extend, ~15 lines)

---

### T014: Implement backup creation with rotation

**Purpose**: Before reconciliation, back up the current settings.json so it can be restored on failure.

**Steps**:
1. Implement:
   ```typescript
   async function createSettingsBackup(
     settingsPath: string,
     backupDir: string,
     maxBackups: number,
     now?: () => Date
   ): Promise<string | undefined>
   ```
2. If `settingsPath` doesn't exist, return `undefined` (nothing to back up)
3. Copy current settings to `${backupDir}/${timestamp}-settings.json` (ISO timestamp with colons/dots replaced by dashes)
4. List backup dir, sort by name (oldest first), delete overflow beyond `maxBackups`
5. Return the backup file path

**Files**:
- `packages/settings-reconciler/src/settingsFile.ts` (extend, ~35 lines)

**Validation**:
- [ ] Backup file created with correct content
- [ ] Old backups pruned when exceeding maxBackups
- [ ] Returns undefined when source file missing

---

### T015: Implement rollback from backup

**Purpose**: Restore settings.json from the most recent backup when reconciliation fails.

**Steps**:
1. Implement `rollbackSettings(settingsPath: string, backupPath: string): Promise<void>`
2. Copy backup file to settings path (overwrite)
3. Use atomic write pattern (copy to temp, rename)
4. If backup file doesn't exist, throw (this is a critical error — backup should have been verified)

**Files**:
- `packages/settings-reconciler/src/settingsFile.ts` (extend, ~15 lines)

**Validation**:
- [ ] Restores settings from backup
- [ ] Uses atomic write for restoration
- [ ] Throws if backup file missing

---

### T016: Tests for settings file operations

**Purpose**: Achieve 100% coverage on settingsFile.ts.

**Steps**:
1. Create `packages/settings-reconciler/test/settingsFile.test.ts`
2. Test `readSettingsFile`:
   - Valid JSON file → returns parsed object
   - Missing file → returns `{}`
   - Empty file → returns `{}`
   - Corrupted JSON → returns `{}`
   - File with nested objects → returns full structure
3. Test `writeSettingsFile`:
   - Writes valid pretty-printed JSON with trailing newline
   - Creates parent directories
   - Atomic (verify temp file doesn't persist after success)
4. Test `createSettingsBackup`:
   - Creates backup file with correct content
   - Rotates old backups (create maxBackups+2, verify oldest deleted)
   - Returns undefined for missing source file
   - Creates backup directory if needed
5. Test `rollbackSettings`:
   - Restores settings from backup
   - Throws if backup missing
   - Atomically writes restored file

All tests should use temp directories (vitest's `tmpdir` or Node's `mkdtemp`).

**Files**:
- `packages/settings-reconciler/test/settingsFile.test.ts` (new, ~160 lines)

**Validation**:
- [ ] All tests pass
- [ ] 100% coverage on settingsFile.ts

## Definition of Done

- [ ] Read handles all error states without throwing
- [ ] Write is atomic (temp-then-rename)
- [ ] Backup creates timestamped copies and rotates
- [ ] Rollback restores from backup atomically
- [ ] 100% test coverage

## Reviewer Guidance

- Verify atomic write temp file is in the SAME directory as target (cross-volume rename is not atomic)
- Verify backup rotation sorts by filename (timestamp format must sort lexicographically)
- Verify rollback is also atomic (don't just `copyFile` — use temp-then-rename)

## Activity Log

- 2026-04-02T02:40:37Z – unknown – lane=in_progress – Dispatching to codex
