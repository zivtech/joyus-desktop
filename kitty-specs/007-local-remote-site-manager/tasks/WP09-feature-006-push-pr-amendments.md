---
work_package_id: WP09
title: Feature 006 Push/PR Amendments
dependencies: [WP03, WP08]
requirement_refs: [FR-019, FR-022]
planning_base_branch: claude/channels-spec-005-amendment
merge_target_branch: claude/channels-spec-005-amendment
branch_strategy: Planning artifacts for this feature were generated on claude/channels-spec-005-amendment. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into claude/channels-spec-005-amendment unless the human explicitly redirects the landing branch.
subtasks: [T044, T045, T046, T047, T048, T049]
history:
- date: '2026-04-01'
  action: created
  by: spec-kitty.tasks
authoritative_surface: ''
execution_mode: code_change
mission_id: 01KPR4E967F61H0B7K24440QG5
owned_files:
- kitty-specs/006-managed-git-sessions/spec.md
- src/gitPusher.ts
- src/prCreator.ts
- src/sessionCloser.ts
- src/taskBranchStore.ts
- src/worktreeManager.ts
- test/gitPusher.test.ts
- test/prCreator.test.ts
- test/sessionCloser.test.ts
- test/taskBranchStore.test.ts
wp_code: WP09
---

# WP09: Feature 006 Push/PR Amendments

**Implement with**: `spec-kitty implement WP09 --base WP08`

## Objective

Implement the Feature 006 amendments (FR-018–FR-023) in `packages/session-manager`: push-to-remote, draft PR creation, auto-commit at session close, and PR association on the TaskBranch entity. This closes the branch→PR→environment loop.

## Context

- **Existing code**: `packages/session-manager/src/taskBranchStore.ts` — needs schema migration for PR fields
- **Existing code**: `packages/session-manager/src/worktreeManager.ts` — git operations via `ExecGit`
- **FR-018**: Push to configured remote on session close (managed mode)
- **FR-019**: Create draft PR via `gh pr create --draft`
- **FR-020**: PR association fields on TaskBranch
- **FR-023**: Auto-commit — silent for desktop GUI, prompted for CLI
- **FR-022**: Advisory mode — suggest but don't execute
- **Spec**: See `kitty-specs/006-managed-git-sessions/spec.md` — User Story 8

## Subtasks

### T044: Add PR association fields to TaskBranch schema

**Purpose**: Extend the SQLite schema with PR fields.

**Steps**:
1. Add columns to `task_branches` table:
   ```sql
   ALTER TABLE task_branches ADD COLUMN pr_number INTEGER;
   ALTER TABLE task_branches ADD COLUMN pr_url TEXT;
   ALTER TABLE task_branches ADD COLUMN pr_status TEXT CHECK (pr_status IN ('draft','open','merged','closed') OR pr_status IS NULL);
   ALTER TABLE task_branches ADD COLUMN preview_environment_url TEXT;
   ```
2. Handle schema migration: check if columns exist before ALTER (SQLite doesn't support IF NOT EXISTS on ALTER). Use `PRAGMA table_info(task_branches)` to check.
3. Add methods to `TaskBranchStore`:
   - `updatePrAssociation(id, prNumber, prUrl, prStatus)`
   - `updatePreviewUrl(id, previewEnvironmentUrl)`
4. Update `TaskBranch` interface with optional PR fields:
   ```typescript
   readonly prNumber: number | undefined;
   readonly prUrl: string | undefined;
   readonly prStatus: 'draft' | 'open' | 'merged' | 'closed' | undefined;
   readonly previewEnvironmentUrl: string | undefined;
   ```
5. Update `mapRowToTaskBranch` to include new fields
6. Update `StoredRow` type

**Files**: `packages/session-manager/src/taskBranchStore.ts` (~40 lines of additions)

### T045: Implement `gitPusher.ts` in session-manager

**Purpose**: Push task branch to configured remote with retry on failure.

**Steps**:
1. Implement `createGitPusher(execGit: ExecGit)` factory:
   ```typescript
   export interface GitPusher {
     push(repoPath: string, branchName: string): Promise<PushResult>;
     hasRemote(repoPath: string): Promise<boolean>;
   }
   export type PushResult = { success: true } | { success: false; error: string; retryable: boolean };
   ```
2. `push()`:
   a. `execGit(['push', '-u', 'origin', branchName], repoPath)`
   b. On success: return `{ success: true }`
   c. On failure: classify error:
      - "Could not resolve host" / "Network is unreachable" → `retryable: true`, error: "Could not share your work — check your internet connection"
      - "Authentication failed" / "Permission denied" → `retryable: false`, error: "Authentication expired — please sign in to GitHub again"
      - Default → `retryable: true`, error: "Something went wrong while sharing your work"
3. `hasRemote()`: `execGit(['remote', 'get-url', 'origin'])` — returns true if exit 0

**Files**: `packages/session-manager/src/gitPusher.ts` (~60 lines)

### T046: Implement `prCreator.ts` in session-manager

**Purpose**: Create draft PRs via `gh` CLI.

**Steps**:
1. Implement `createPrCreator(execCommand: ExecCommand)` factory:
   ```typescript
   export interface PrCreator {
     createDraftPr(repoPath: string, branchName: string, title: string): Promise<PrCreateResult>;
     findExistingPr(repoPath: string, branchName: string): Promise<ExistingPr | undefined>;
   }
   export interface PrCreateResult { prNumber: number; prUrl: string; }
   export interface ExistingPr { prNumber: number; prUrl: string; state: string; }
   ```
2. `findExistingPr()`:
   ```
   gh pr list --head <branchName> --json number,url,state --jq '.[0]'
   ```
3. `createDraftPr()`:
   a. First call `findExistingPr()` — if PR exists, return it (don't create duplicate)
   b. If no PR: `gh pr create --draft --title "<title>" --body "Created by Joyus Desktop"` in `repoPath`
   c. Parse output for PR number and URL
   d. Return `PrCreateResult`

**Files**: `packages/session-manager/src/prCreator.ts` (~50 lines)

### T047: Implement auto-commit behavior (FR-023)

**Purpose**: Commit uncommitted changes at session close based on client context.

**Steps**:
1. Add to `SessionManager` or create `sessionCloser.ts`:
   ```typescript
   export interface SessionCloser {
     closeSession(sessionId: string, context: CloseContext): Promise<CloseResult>;
   }
   export interface CloseContext {
     clientType: 'desktop-gui' | 'claude-code-cli';
     autoCommitPreference?: boolean; // user override
   }
   ```
2. `closeSession()`:
   a. Check for uncommitted changes: `execGit(['status', '--porcelain'], worktreePath)`
   b. If no changes: skip commit, proceed to push
   c. If changes exist:
      - Desktop GUI (`clientType: 'desktop-gui'`): auto-commit silently
        ```
        execGit(['add', '-A'], worktreePath)
        execGit(['commit', '-m', 'Changes from [mission-label] session'], worktreePath)
        ```
      - Claude Code CLI: check `autoCommitPreference`
        - If true: auto-commit silently
        - If false/undefined: return `{ needsUserConfirmation: true, ... }` — caller prompts user
   d. After commit (or if already committed): call `gitPusher.push()`
   e. After push: call `prCreator.createDraftPr()` with mission label as title
   f. Update TaskBranch with PR association
3. FR-022 (advisory mode): if mode is `advisory`, return suggestion instead of executing

**Files**: `packages/session-manager/src/sessionCloser.ts` (~80 lines)

### T048: Implement event emission

**Purpose**: Emit events that Feature 007's environment-monitor can consume.

**Steps**:
1. Use Node.js `EventEmitter` pattern:
   ```typescript
   export interface SessionEvents {
     on(event: 'push-complete', listener: (data: { repoPath: string; branchName: string }) => void): void;
     on(event: 'pr-created', listener: (data: { repoOwner: string; repoName: string; prNumber: number; taskBranchId: string }) => void): void;
   }
   ```
2. In `sessionCloser.closeSession()`:
   - After successful push: emit `push-complete`
   - After PR creation: emit `pr-created` with repo owner/name parsed from remote URL
3. Parse remote URL to extract owner/name: `execGit(['remote', 'get-url', 'origin'])` → parse `github.com/{owner}/{repo}`
4. Export the event emitter from the session-manager package

**Files**: `packages/session-manager/src/sessionCloser.ts` (extend, ~20 lines)

### T049: Write tests

**Steps**:
1. **taskBranchStore PR fields**: test schema migration, updatePrAssociation, updatePreviewUrl, mapRowToTaskBranch with PR fields
2. **gitPusher**: mock execGit for success, network error (retryable), auth error (not retryable), no remote
3. **prCreator**: mock execCommand for findExistingPr (found/not found), createDraftPr (success/failure), duplicate prevention
4. **sessionCloser**:
   - Desktop GUI + uncommitted changes → auto-commit + push + PR
   - CLI + no auto-commit preference → returns needsUserConfirmation
   - CLI + auto-commit enabled → auto-commit + push + PR
   - No changes → skip commit, push existing commits
   - Advisory mode → returns suggestion, no git ops
   - Push failure → retryable error, no PR created
5. **Event emission**: verify push-complete and pr-created events fire with correct data

**Files**: `packages/session-manager/test/taskBranchStore.test.ts` (extend), `packages/session-manager/test/gitPusher.test.ts`, `packages/session-manager/test/prCreator.test.ts`, `packages/session-manager/test/sessionCloser.test.ts`

## Definition of Done

- [ ] TaskBranch schema migrated with PR fields
- [ ] `gitPusher.ts` pushes with error classification and retry info
- [ ] `prCreator.ts` creates draft PRs, prevents duplicates
- [ ] `sessionCloser.ts` handles auto-commit per client context
- [ ] Events emitted for push-complete and pr-created
- [ ] Advisory mode returns suggestions without executing
- [ ] All tests pass, 100% coverage on new files
- [ ] Existing session-manager tests still pass

## Risks

- **Schema migration**: SQLite ALTER TABLE is limited. Test migration on a database with existing data to ensure no data loss.
- **Remote URL parsing**: GitHub remote URLs can be HTTPS or SSH format. Handle both: `https://github.com/owner/repo.git` and `git@github.com:owner/repo.git`.
- **Existing test coverage**: This WP modifies `taskBranchStore.ts` which has 100% coverage. Ensure existing tests still pass after schema changes.
