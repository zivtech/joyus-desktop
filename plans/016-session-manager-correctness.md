# Plan 016: Session manager creates one worktree per session, really removes worktrees, and detects merged branches

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> Every code block in the Steps was copied by a script from a reference
> implementation that was run (see "What was run"). Copy each block exactly.
> Lines of the form `<!-- block: name -->` are labels used to check this plan;
> ignore them.
>
> **Drift check (run first)**: `git diff --stat cea62f6 -- packages/session-manager/` must print nothing. The package was unchanged between `cea62f6` and the plan 008 branch when this plan was revised. If the command lists any file, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3 today, P1 before session features are switched on (see "Why this matters")
- **Effort**: M
- **Risk**: LOW–MED (three independent fixes in one package; one interface method gains two parameters)
- **Depends on**: plans/007-correct-agent-and-contributor-docs.md, plans/008-make-recon-tests-hermetic.md
- **Category**: bug
- **Planned at**: commit `cea62f6`, 2026-11-17
- **Revised**: 2026-11-18, against branch `fix/008-hermetic-recon-tests` (commit `1edaa59`), after the outside review recorded in `plans/README.md`. What changed:
  1. **Removal can no longer hide a failure** (review finding 3). After a failed `git worktree remove`, the check uses a listing that rejects when git fails. If the check itself fails, the original error is thrown. Both sides of the path comparison are resolved first, because git prints `/private/tmp/...` where the session stored `/tmp/...`.
  2. **The caller's `force` reaches git.** An ordinary delete runs `git worktree remove` without `--force`, so git itself refuses a worktree with modified or untracked files.
  3. **Merged detection needs a commit made on the branch** (review finding 4), read from the branch's reflog subjects. A fresh branch, and a branch that was only fast-forwarded, rebased or reset, are not marked. The rule was chosen with a real git repository; see "What git really prints". No database column is added: the experiment shows a recorded creation commit could not tell the two cases apart either.
  4. The test code that the first version left as `// ...` is written out, and a new test file runs the real git binary.
  Part A (one worktree per session) was not challenged and is unchanged in design. All of the code in the Steps was run against the package's existing tests before this revision was published. See "What was run".
- **Reviewed**: 2026-11-18 by an independent replay with real git. It executed cleanly and the full gates pass. Three items are open, one of them a relative-path case in which a failed removal is still reported as success. Read items 10–12 under "Independent replay of the revised plans" in `plans/README.md` before executing.

## Why this matters

`@joyus/session-manager` gives each AI coding session its own git branch and worktree inside the user's repository, tracks them in a SQLite table, and cleans up afterward. The sidecar wires it in by default. No UI path reaches it yet, because the Rust shell has no session commands (they are on the known-gaps list from plan 014). These three defects must be fixed before those commands are added:

1. **A burst of file events crashes the sidecar.** The first "file modified" event for a session checks the table, finds nothing, and then awaits `git worktree add` before inserting a row. A second event for the same session that arrives during that await also finds nothing and starts a second worktree. Its insert then violates the table's unique index on `session_id`. The handler was started with `void`, so the error becomes an unhandled promise rejection, and the sidecar treats every unhandled rejection as fatal and exits. An agent editing two files in a row is enough.
2. **Deleting a session never removes its worktree.** `git worktree remove` is run without a working directory, so it runs wherever the sidecar happens to be, fails with "not a git repository", and the failure is swallowed as "already gone". The row is marked deleted; the directory and its registration stay in the user's repository forever.
3. **No branch is ever marked merged.** The code parses `git branch --merged HEAD`, which prefixes a branch that is checked out in another worktree with `+`. Every session branch is checked out in its own worktree, so every one has that prefix, and the parser only strips `*`. Fixing only the prefix would introduce the opposite bug: git also lists a brand-new branch, and a branch that was merely fast-forwarded, as "merged", so sessions with no work would be marked merged at the next start.

## Current state

All excerpts were read from branch `fix/008-hermetic-recon-tests` on 2026-11-18. Files (all under `packages/session-manager/`):

- `src/sessionManager.ts` (213 lines) — the `SessionManager` class.
- `src/worktreeManager.ts` (102 lines) — `createWorktreeManager(execGit)`.
- `src/taskBranchStore.ts` (421 lines) — the SQLite store; `detectMerged` is at lines 375–395.
- `test/sessionManager.test.ts` (25 tests), `test/worktreeManager.test.ts` (11), `test/taskBranchStore.test.ts` (45). The package has 134 tests in 8 files.

The git runner type (`src/taskBranchStore.ts:45-48`). The second argument is the working directory. The production runner (`apps/desktop-companion/src/sidecar/sessionWiring.ts`) is `execFile("git", args, { cwd })`, which rejects when git exits non-zero:

```ts
export type ExecGit = (
  args: string[],
  cwd?: string,
) => Promise<{ stdout: string; stderr: string }>;
```

The unique index (`src/taskBranchStore.ts:137-138`):

```sql
  CREATE UNIQUE INDEX IF NOT EXISTS idx_task_branches_session_id
    ON task_branches (session_id) WHERE deleted_at IS NULL;
```

### Defect 1 — `src/sessionManager.ts:42-118`

```ts
export class SessionManager {
  private readonly repoModes = new Map<string, OperatingMode>();
  private globalMode: OperatingMode = "managed";

  constructor(
    private readonly store: TaskBranchStore,
    private readonly worktreeManager: WorktreeManager,
    private readonly detector: FileModificationDetector,
    private readonly execGit: ExecGit,
    private readonly staleDays: number = 14,
  ) {
    detector.onModification((event) => {
      void this.onFileModification(event);
    });
  }

  async onFileModification(event: FileModificationEvent): Promise<void> {
    if (this.getMode(event.repoPath) === "advisory") {
      return;
    }

    const existing = this.store.findBySessionId(event.sessionId);
    if (existing !== undefined) {
      this.store.updateActivity({
        taskBranchId: existing.id,
        lastActivityAt: Date.now(),
      });
      return;
    }

    const missionLabel = inferMissionLabel([event.filePath]);
    const missionSlug = missionLabel.replace(/^\d{4}-\d{2}-\d{2}-/, "");

    let worktreePath: string;
    let branchName: string;

    try {
      const result = await this.worktreeManager.createWorktree({
        repoPath: event.repoPath,
        missionSlug,
        sessionDate: todayString(),
      });
      worktreePath = result.worktreePath;
      branchName = result.branchName;
    } catch {
      this.store.create({
        sessionId: event.sessionId,
        repoPath: event.repoPath,
        worktreePath: "",
        branchName: "",
        missionLabel,
        missionSource: "inferred",
        mode: "managed",
      });
      // Update the broken record's status
      const broken = this.store.findBySessionId(event.sessionId);
      if (broken !== undefined) {
        this.store.updateStatus(broken.id, "broken");
      }
      return;
    }

    const branch = this.store.create({
      sessionId: event.sessionId,
      repoPath: event.repoPath,
      worktreePath,
      branchName,
      missionLabel,
      missionSource: "inferred",
      mode: "managed",
    });

    this.detector.startPolling(event.repoPath, event.sessionId);

    // Suppress unused variable — branch is created for side effect
    void branch;
  }
```

The factory at the bottom of the file (lines 197–213):

```ts
export interface SessionManagerDeps {
  readonly store: TaskBranchStore;
  readonly worktreeManager: WorktreeManager;
  readonly detector: FileModificationDetector;
  readonly execGit: ExecGit;
  readonly staleDays?: number;
}

export function createSessionManager(deps: SessionManagerDeps): SessionManager {
  return new SessionManager(
    deps.store,
    deps.worktreeManager,
    deps.detector,
    deps.execGit,
    deps.staleDays,
  );
}
```

### Defect 2 — `src/worktreeManager.ts`

The interface (lines 18–23), and the methods `removeWorktree` (61–67) and `listWorktrees` (84–100). `createWorktree` passes `repoPath` as the working directory; `removeWorktree` passes nothing and swallows every error; `listWorktrees` turns a git failure into an empty list:

```ts
export interface WorktreeManager {
  createWorktree(params: WorktreeCreateParams): Promise<WorktreeCreateResult>;
  removeWorktree(worktreePath: string): Promise<void>;
  isWorktreeHealthy(worktreePath: string, repoPath: string): Promise<boolean>;
  listWorktrees(repoPath: string): Promise<readonly string[]>;
}
```

```ts
    async removeWorktree(worktreePath: string): Promise<void> {
      try {
        await execGit(["worktree", "remove", "--force", worktreePath]);
      } catch {
        // If worktree doesn't exist, treat as success (idempotent)
      }
    },
```

```ts
    async listWorktrees(repoPath: string): Promise<readonly string[]> {
      try {
        const { stdout } = await execGit(
          ["worktree", "list", "--porcelain"],
          repoPath,
        );
        const paths: string[] = [];
        for (const line of stdout.split("\n")) {
          if (line.startsWith("worktree ")) {
            paths.push(line.slice("worktree ".length));
          }
        }
        return paths;
      } catch {
        return [];
      }
    },
```

Its only caller, `SessionManager.delete` (`src/sessionManager.ts:144-160`). It checks for uncommitted changes and then forces the removal regardless:

```ts
  async delete(taskBranchId: string, opts: { force: boolean }): Promise<void> {
    const branch = this.store.findById(taskBranchId);
    if (branch === undefined) {
      throw new SessionNotFoundError(taskBranchId);
    }

    if (!opts.force) {
      const hasChanges = await this.hasUncommittedChanges(taskBranchId);
      if (hasChanges) {
        throw new UncommittedChangesError(taskBranchId);
      }
    }

    await this.worktreeManager.removeWorktree(branch.worktreePath);
    this.store.softDelete(taskBranchId);
    this.detector.stopPolling(branch.sessionId);
  }
```

A session whose worktree could not be created is stored with `worktreePath: ""` (the `catch` branch quoted under Defect 1).

### Defect 3 — `src/taskBranchStore.ts:375-395`

```ts
    async detectMerged(execGit: ExecGit): Promise<void> {
      const rows = detectMergedListStmt.all() as unknown as Array<{
        id: string;
        branch_name: string;
        repo_path: string;
      }>;

      for (const row of rows) {
        try {
          const { stdout } = await execGit(
            ["branch", "--merged", "HEAD"],
            row.repo_path,
          );
          const branches = stdout
            .split("\n")
            .map((line) => line.replace(/^\*?\s+/, "").trim());
          if (branches.includes(row.branch_name)) {
            updateStatusStmt.run("merged", row.id);
          }
        } catch {
          // execGit errors must not throw — skip and continue
```

### What git really prints

Measured on 2026-11-18 with git 2.50.1 on macOS, in throwaway repositories. Each session branch was made with `git worktree add -b joyus/<name> .joyus-worktrees/<name>`, as the worktree manager does.

`git branch --merged HEAD` prints one branch per line with a two-character prefix: `* ` for the current branch, `+ ` for a branch checked out in another worktree, two spaces for anything else. It lists a branch whenever the branch tip is reachable from `HEAD`. That includes a branch that never had a commit of its own.

`git reflog show --format=%gs refs/heads/<branch>` prints the subject of every recorded movement of the branch, newest first:

| What happened to the session branch | Newest reflog subject | Listed by `--merged` after main has it |
|---|---|---|
| created, nothing else | `branch: Created from HEAD` | yes |
| `git commit` | `commit: <message>` | yes, once merged |
| `git commit --amend` | `commit (amend): <message>` | yes, once merged |
| fast-forwarded to a newer main (`git merge main`) | `merge main: Fast-forward` | yes |
| fast-forwarded with `git pull -q --ff-only . main` | `pull -q --ff-only . main: Fast-forward` | yes |
| `git cherry-pick --ff main` (a move, no new commit) | `cherry-pick: fast-forward` | yes |
| rebased onto main, with a commit of its own | `rebase (finish): refs/heads/<branch> onto <hash>` (the earlier `commit:` line stays in the reflog) | yes, once merged |
| rebased onto main, with no commit of its own | `rebase (finish): ...` | yes |
| `git reset --hard main` | `reset: moving to main` | yes |
| `git switch -C <branch> main` | `branch: Reset to main` | yes |
| `git cherry-pick <commit>` | `cherry-pick: <message>` | yes, once merged |
| `git revert <commit>` | `revert: Revert "<message>"` | yes, once merged |
| `git am` | `am: <message>` | yes, once merged |
| `git merge main` that needed a merge commit | `merge main: Merge made by the 'ort' strategy.` | yes, once merged |
| moved with `git update-ref` | *(empty subject)* | depends |

So "is listed by `--merged`" cannot tell work that landed from no work at all. The reflog can: only `git commit` writes a subject that starts with `commit`.

**Why not record the commit the branch was created from.** That was the other candidate. Two repositories were built: in one, a commit was made on the session branch and main was fast-forwarded to it; in the other, the same commit was made on main and the session branch was fast-forwarded to it. In both, the branch tip equals main, the tip differs from the creation commit, and `git rev-list <created-from>..<tip>` counts one commit. The commit graphs are identical. Only the reflog subject differs (`commit: change` against `merge main: Fast-forward`). A stored creation commit would mark both as merged, so no column is added.

`git worktree remove`, run inside the repository:

| Situation | Without `--force` | With `--force` | Still in `git worktree list` afterward |
|---|---|---|---|
| clean worktree | removed, exit 0 | removed, exit 0 | no |
| modified or untracked files | exit 128, `contains modified or untracked files, use --force to delete it` | removed, exit 0 | yes / no |
| folder already deleted by hand | exit 0 (git drops the registration) | exit 0 | no |
| path that is not a worktree (or removed twice) | — | exit 128, `is not a working tree` | no |
| locked worktree | — | exit 128, `cannot remove a locked working tree` | yes |
| run outside any repository (today's bug) | — | exit 128, `not a git repository` | yes |

`git worktree list --porcelain` prints resolved paths. For a repository reached as `/tmp/x/repo`, it printed `worktree /private/tmp/x/repo/.joyus-worktrees/one`. The same happens for a repository reached through a symbolic link. A plain string comparison between the stored path and git's list therefore misses, and a failed removal would again look like "already gone".

### Test conventions

`test/sessionManager.test.ts` builds mocks with `makeBranch()`, `makeStore(overrides)`, `makeWorktreeManager(overrides)` and `makeExecGit(stdout)`, and constructs the class directly: `new SessionManager(store, worktreeManager, detector, execGit)`. The detector emits an event with `detector.handleIpcEvent({ sessionId, repoPath, filePath })`.

`test/taskBranchStore.test.ts`, `describe("detectMerged")`, uses a real temporary database (`store`, opened in `beforeEach`), `makeInput({...})` and a mocked git runner.

Five existing tests pin behavior that this plan changes. Each was found by running the reference implementation against the unmodified test files; no other test in the package, and none of the app's tests that use the session manager, failed.

1. `test/worktreeManager.test.ts`: "calls git worktree remove --force" and "does not throw when worktree is missing (idempotent)". Both call `removeWorktree` with one argument.
2. `test/sessionManager.test.ts`: "force:true proceeds even with uncommitted changes" asserts `toHaveBeenCalledWith(branch.worktreePath)`.
3. `test/taskBranchStore.test.ts`: "marks branch as merged when git reports it merged" and "checks stale branches too". Their git mock answers every command with the branch list, so the new reflog question gets no `commit` subject.

Repo conventions: TypeScript strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Vitest. Coverage must stay at 100% lines, functions, branches and statements. Errors are handled explicitly, never silently dropped. `pnpm typecheck` does not check test files; four type errors already exist in this package's test files and are not part of this plan.

### What was run

On 2026-11-18, outside the repository, in a copy of branch `fix/008-hermetic-recon-tests` with a `node_modules` borrowed from an existing worktree (Vitest 3.2.4, git 2.50.1, macOS). Every test run used a throwaway `HOME`.

- The unmodified package: 134 tests pass. The app's tests that use the session manager (`apps/desktop-companion/test/integration`, `test/acceptance` and `test/sidecar/sessionWiring.test.ts`, 156 tests, several of them with real git worktrees): all pass.
- All source changes with the test files untouched: exactly the five tests named above fail. The 156 app tests still pass.
- After all steps: 162 package tests pass, eight of them against the real git binary; the 156 app tests pass; `tsc --noEmit` over the whole workspace exits 0; coverage is 100% statements, branches, functions and lines for `sessionManager.ts`, `worktreeManager.ts` and `taskBranchStore.ts`.
- Eight deliberate defects were put into the reference one at a time, among them the two the review found (verify with a listing that hides git failures; count any movement of the branch as work), plus: compare paths as plain strings, always pass `--force`, strip only the `*` prefix, drop the empty-path guard, skip the wait for a creation in flight, and force every delete. Each made at least one new test fail. The plain-string comparison failed two of the real-git tests on this machine, because its temp folder is under `/tmp`.
- This plan was then replayed: a script took the code blocks from this file, applied them to a fresh copy as the Steps describe, and ran the tests after each step. Result: 134 tests pass after Step 1, 139 after Step 2; exactly the three named tests fail after Step 3; 148 pass after Step 4; exactly the two named tests fail after Step 5; 154 pass after Step 6 and 162 after Step 7; the 156 app tests pass; coverage is 100% for the three source files; and the seven resulting files were byte-identical to the reference.

Not run: `pnpm coverage` over the whole repository; any git version other than 2.50.1; Linux or Windows; the code inside the real application (nothing in the UI reaches it yet).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Package tests | `pnpm vitest run packages/session-manager` | all pass (134 before this plan, 162 after) |
| App tests that use the session manager | `pnpm vitest run apps/desktop-companion/test/integration apps/desktop-companion/test/acceptance apps/desktop-companion/test/sidecar/sessionWiring.test.ts` | all pass (156) |
| Full coverage gate | `pnpm coverage` | exit 0, thresholds met |

Never run `pnpm ci` (that is clean-install in pnpm). The full pipeline is `pnpm run ci`.

Run tests only on a branch that contains plan 008 (`git merge-base --is-ancestor 1edaa59 HEAD && echo safe` prints `safe`). Without it, the unit tests delete `~/Documents/joyus-recon-engagements`.

The new test file needs the `git` binary on `PATH`. `packages/skill-sync/test/sync.test.ts` and the app's integration tests already need it.

Known flaky tests, unrelated to this plan: `apps/desktop-companion/test/ui/SessionsPage.test.ts` ("clears mode note timers…"), `apps/desktop-companion/test/ui/components/LocalSiteCard.test.ts`, and a timing-dependent coverage gap in `ReconSetup.tsx`. If `pnpm coverage` fails only in one of those, rerun it once. If it fails again, treat it as a STOP condition.

## Scope

**In scope** (the only files you should modify):
- `packages/session-manager/src/sessionManager.ts`
- `packages/session-manager/src/worktreeManager.ts`
- `packages/session-manager/src/taskBranchStore.ts` (`detectMerged` and one new helper only)
- `packages/session-manager/test/sessionManager.test.ts`
- `packages/session-manager/test/worktreeManager.test.ts`
- `packages/session-manager/test/taskBranchStore.test.ts`
- `packages/session-manager/test/realGit.test.ts` (new file)
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch, even though they look related):
- `apps/desktop-companion/src/sidecar/sessionWiring.ts` and the Rust shell. Adding the session commands to the Rust shell is separate work.
- The database schema. Do not add a column.
- Deleting the `joyus/...` branch when a session is deleted. Only the worktree is removed; the branch keeps the user's commits. That is the current design.
- `isWorktreeHealthy` in `worktreeManager.ts` and the function of the same name in `taskBranchStore.ts`. Both still compare paths as plain strings. See "Maintenance notes".
- `hasUncommittedChanges` and the check before it in `delete`.
- `sessionCloser.ts`, `gitPusher.ts`, `prCreator.ts`.
- Any test under `apps/`. None needs to change.

## Git workflow

- Branch: `fix/016-session-manager-correctness`, cut from `fix/008-hermetic-recon-tests` (or from `main` once plan 008 has merged there).
- Four commits: (1) `fix: create one worktree per session and report event failures`, (2) `fix: remove session worktrees from their own repository and report failures`, (3) `fix: mark a session branch merged only when a commit was made on it`, (4) `test: check merged detection and worktree removal against real git`. Conventional commits, matching `git log`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Part A — one worktree per session

#### Step 1: Serialize creation per session and report failures

In `src/sessionManager.ts`:

**1a.** Replace the start of the class: everything from the line `export class SessionManager {` up to, but not including, the line `  async resume(taskBranchId: string): Promise<TaskBranch> {`, with the block below. It adds the `creating` map and the `onError` parameter, makes the listener report failures, and splits `onFileModification` in two. The body of the new `createSession` method is the old tail of `onFileModification`, unchanged.

<!-- block: sm-class-head -->

```ts
export class SessionManager {
  private readonly repoModes = new Map<string, OperatingMode>();
  private globalMode: OperatingMode = "managed";
  /** Session ids whose first event is still creating a worktree and record. */
  private readonly creating = new Map<string, Promise<void>>();

  constructor(
    private readonly store: TaskBranchStore,
    private readonly worktreeManager: WorktreeManager,
    private readonly detector: FileModificationDetector,
    private readonly execGit: ExecGit,
    private readonly staleDays: number = 14,
    private readonly onError: (error: unknown) => void = (error) => {
      console.error("[session-manager] failed to handle a file modification:", error);
    },
  ) {
    detector.onModification((event) => {
      // The sidecar treats an unhandled promise rejection as fatal. A failed
      // event must be reported here, never left to reject on its own.
      this.onFileModification(event).catch((error: unknown) => {
        this.onError(error);
      });
    });
  }

  async onFileModification(event: FileModificationEvent): Promise<void> {
    if (this.getMode(event.repoPath) === "advisory") {
      return;
    }

    // Events for a new session arrive in bursts. Wait for any creation that
    // is already running for this session, so that exactly one worktree and
    // one record are created.
    let inFlight = this.creating.get(event.sessionId);
    while (inFlight !== undefined) {
      // The event that owns the creation reports its own failure. A waiting
      // event only needs to know that it has finished.
      await inFlight.catch(() => undefined);
      inFlight = this.creating.get(event.sessionId);
    }

    const existing = this.store.findBySessionId(event.sessionId);
    if (existing !== undefined) {
      this.store.updateActivity({
        taskBranchId: existing.id,
        lastActivityAt: Date.now(),
      });
      return;
    }

    const creation = this.createSession(event);
    this.creating.set(event.sessionId, creation);
    try {
      await creation;
    } finally {
      this.creating.delete(event.sessionId);
    }
  }

  private async createSession(event: FileModificationEvent): Promise<void> {
    const missionLabel = inferMissionLabel([event.filePath]);
    const missionSlug = missionLabel.replace(/^\d{4}-\d{2}-\d{2}-/, "");

    let worktreePath: string;
    let branchName: string;

    try {
      const result = await this.worktreeManager.createWorktree({
        repoPath: event.repoPath,
        missionSlug,
        sessionDate: todayString(),
      });
      worktreePath = result.worktreePath;
      branchName = result.branchName;
    } catch {
      this.store.create({
        sessionId: event.sessionId,
        repoPath: event.repoPath,
        worktreePath: "",
        branchName: "",
        missionLabel,
        missionSource: "inferred",
        mode: "managed",
      });
      // Update the broken record's status
      const broken = this.store.findBySessionId(event.sessionId);
      if (broken !== undefined) {
        this.store.updateStatus(broken.id, "broken");
      }
      return;
    }

    const branch = this.store.create({
      sessionId: event.sessionId,
      repoPath: event.repoPath,
      worktreePath,
      branchName,
      missionLabel,
      missionSource: "inferred",
      mode: "managed",
    });

    this.detector.startPolling(event.repoPath, event.sessionId);

    // Suppress unused variable — branch is created for side effect
    void branch;
  }
```

`console.error` writes to stderr, which is safe: the sidecar uses stdout for its protocol. The `inFlight.catch(() => undefined)` is not a swallowed error: the event that owns the creation reports its own failure.

**1b.** Replace the factory section (from the line `export interface SessionManagerDeps {` to the end of the file) with:

<!-- block: sm-factory-src -->

```ts
export interface SessionManagerDeps {
  readonly store: TaskBranchStore;
  readonly worktreeManager: WorktreeManager;
  readonly detector: FileModificationDetector;
  readonly execGit: ExecGit;
  readonly staleDays?: number;
  readonly onError?: (error: unknown) => void;
}

export function createSessionManager(deps: SessionManagerDeps): SessionManager {
  return new SessionManager(
    deps.store,
    deps.worktreeManager,
    deps.detector,
    deps.execGit,
    deps.staleDays,
    deps.onError,
  );
}
```

**Verify**: `pnpm typecheck` → exit 0. `pnpm vitest run packages/session-manager` → 134 pass.

#### Step 2: Test Part A

In `test/sessionManager.test.ts`:

**2a.** At the end of `describe("onFileModification — managed mode")`, add:

<!-- block: sm-managed -->

```ts
    it("creates one worktree and one record when two events arrive together", async () => {
      let created: TaskBranch | undefined;
      const store = makeStore({
        findBySessionId: vi.fn(() => created),
        create: vi.fn(() => {
          created = makeBranch();
          return created;
        }),
      });
      let finishWorktree: (value: { worktreePath: string; branchName: string }) => void = () =>
        undefined;
      const worktreeManager = makeWorktreeManager({
        createWorktree: vi.fn(
          () =>
            new Promise<{ worktreePath: string; branchName: string }>((resolve) => {
              finishWorktree = resolve;
            }),
        ),
      });
      const execGit = makeExecGit();
      const detector = new FileModificationDetector(execGit, 10_000);
      const manager = new SessionManager(store, worktreeManager, detector, execGit);
      const event = {
        sessionId: "sess-burst",
        repoPath: "/repo",
        filePath: "/repo/src/foo.ts",
        detectedAt: Date.now(),
        source: "hook" as const,
      };

      const first = manager.onFileModification(event);
      const second = manager.onFileModification({ ...event, filePath: "/repo/src/bar.ts" });
      finishWorktree({ worktreePath: "/repo/.joyus-worktrees/x", branchName: "joyus/x" });
      await Promise.all([first, second]);

      expect(worktreeManager.createWorktree).toHaveBeenCalledOnce();
      expect(store.create).toHaveBeenCalledOnce();
      expect(store.updateActivity).toHaveBeenCalledOnce();
    });

    it("lets a waiting event retry when the first creation failed without a record", async () => {
      let created: TaskBranch | undefined;
      const create = vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error("disk full");
        })
        .mockImplementationOnce(() => {
          created = makeBranch();
          return created;
        });
      const store = makeStore({ findBySessionId: vi.fn(() => created), create });
      const worktreeManager = makeWorktreeManager();
      const execGit = makeExecGit();
      const detector = new FileModificationDetector(execGit, 10_000);
      const manager = new SessionManager(store, worktreeManager, detector, execGit);
      const event = {
        sessionId: "sess-retry",
        repoPath: "/repo",
        filePath: "/repo/src/foo.ts",
        detectedAt: Date.now(),
        source: "hook" as const,
      };

      const first = manager.onFileModification(event);
      const second = manager.onFileModification(event);

      await expect(first).rejects.toThrow("disk full");
      await expect(second).resolves.toBeUndefined();
      expect(create).toHaveBeenCalledTimes(2);
    });
```

**2b.** At the end of `describe("detector listener registration")`, add:

<!-- block: sm-listener -->

```ts
    it("reports a failed event through onError instead of an unhandled rejection", async () => {
      const failure = new Error("store unavailable");
      const store = makeStore({
        findBySessionId: vi.fn(() => {
          throw failure;
        }),
      });
      const onError = vi.fn();
      const execGit = makeExecGit();
      const detector = new FileModificationDetector(execGit, 10_000);
      new SessionManager(store, makeWorktreeManager(), detector, execGit, 14, onError);

      detector.handleIpcEvent({
        sessionId: "sess-x",
        repoPath: "/repo",
        filePath: "/repo/x.ts",
      });

      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalledWith(failure);
      });
    });

    it("logs to stderr by default when no onError is given", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const store = makeStore({
        findBySessionId: vi.fn(() => {
          throw new Error("store unavailable");
        }),
      });
      const execGit = makeExecGit();
      const detector = new FileModificationDetector(execGit, 10_000);
      new SessionManager(store, makeWorktreeManager(), detector, execGit);

      detector.handleIpcEvent({
        sessionId: "sess-x",
        repoPath: "/repo",
        filePath: "/repo/x.ts",
      });

      await vi.waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          "[session-manager] failed to handle a file modification:",
          expect.any(Error),
        );
      });
      consoleError.mockRestore();
    });
```

**2c.** At the end of `describe("createSessionManager")` (the last block in the file), add:

<!-- block: sm-factory -->

```ts
  it("passes onError through to the manager", async () => {
    const failure = new Error("store unavailable");
    const store = makeStore({
      findBySessionId: vi.fn(() => {
        throw failure;
      }),
    });
    const onError = vi.fn();
    const execGit = makeExecGit();
    const detector = new FileModificationDetector(execGit, 10_000);
    const manager = createSessionManager({
      store,
      worktreeManager: makeWorktreeManager(),
      detector,
      execGit,
      onError,
    });

    detector.handleIpcEvent({ sessionId: "sess-x", repoPath: "/repo", filePath: "/repo/x.ts" });

    expect(manager).toBeInstanceOf(SessionManager);
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(failure);
    });
  });
```

**Verify**: `pnpm vitest run packages/session-manager` → 139 pass. Commit (commit 1).

### Part B — real worktree removal

#### Step 3: Run the removal in the repository, pass `force` through, and stop hiding failures

**3a.** Replace the whole content of `src/worktreeManager.ts` with:

<!-- block: wm-file -->

```ts
import { realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { ExecGit } from "./taskBranchStore";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WorktreeCreateParams {
  readonly repoPath: string;
  readonly missionSlug: string;
  readonly sessionDate: string;
}

export interface WorktreeCreateResult {
  readonly worktreePath: string;
  readonly branchName: string;
}

export interface WorktreeRemoveOptions {
  /** Pass `--force` to git: remove even with modified or untracked files. */
  readonly force: boolean;
}

/** Resolves symbolic links in a path that exists; rejects when it does not. */
export type ResolveRealPath = (path: string) => Promise<string>;

export interface WorktreeManager {
  createWorktree(params: WorktreeCreateParams): Promise<WorktreeCreateResult>;
  /**
   * Removes the worktree, running git inside `repoPath`. Resolves when the
   * worktree is gone, including when it was gone already. Rejects with git's
   * error when the worktree is still registered, or when that cannot be checked.
   */
  removeWorktree(
    worktreePath: string,
    repoPath: string,
    opts: WorktreeRemoveOptions,
  ): Promise<void>;
  isWorktreeHealthy(worktreePath: string, repoPath: string): Promise<boolean>;
  listWorktrees(repoPath: string): Promise<readonly string[]>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_COLLISION_RETRIES = 10;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * `path` with symbolic links resolved, the way git prints worktree paths
 * (`/private/tmp/x` for `/tmp/x` on macOS). The trailing parts that no longer
 * exist are kept as given, so a removed worktree still gets a comparable path.
 */
async function resolveLikeGit(
  path: string,
  resolveRealPath: ResolveRealPath,
): Promise<string> {
  let existing = path;
  let missing = "";

  for (;;) {
    try {
      return join(await resolveRealPath(existing), missing);
    } catch {
      const parent = dirname(existing);
      if (parent === existing) {
        // Not even the root resolves: compare the path as given.
        return path;
      }
      missing = join(basename(existing), missing);
      existing = parent;
    }
  }
}

function parseWorktreePaths(porcelain: string): string[] {
  const paths: string[] = [];
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      paths.push(line.slice("worktree ".length));
    }
  }
  return paths;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createWorktreeManager(
  execGit: ExecGit,
  resolveRealPath: ResolveRealPath = realpath,
): WorktreeManager {
  /** Unlike `listWorktrees`, this rejects when git fails. */
  async function listWorktreesStrict(repoPath: string): Promise<string[]> {
    const { stdout } = await execGit(
      ["worktree", "list", "--porcelain"],
      repoPath,
    );
    return parseWorktreePaths(stdout);
  }

  async function isStillRegistered(
    worktreePath: string,
    repoPath: string,
  ): Promise<boolean> {
    const wanted = await resolveLikeGit(worktreePath, resolveRealPath);
    for (const listed of await listWorktreesStrict(repoPath)) {
      if ((await resolveLikeGit(listed, resolveRealPath)) === wanted) {
        return true;
      }
    }
    return false;
  }

  return {
    async createWorktree(
      params: WorktreeCreateParams,
    ): Promise<WorktreeCreateResult> {
      const { repoPath, missionSlug, sessionDate } = params;

      let lastError: unknown;

      for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
        const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
        const baseName = `${sessionDate}-${missionSlug}${suffix}`;
        const branchName = `joyus/${baseName}`;
        const worktreePath = join(repoPath, ".joyus-worktrees", baseName);

        try {
          await execGit(
            ["worktree", "add", "-b", branchName, worktreePath],
            repoPath,
          );
          return { worktreePath, branchName };
        } catch (err: unknown) {
          lastError = err;
          // Non-zero exit code — assume collision, retry with suffix
        }
      }

      throw lastError;
    },

    async removeWorktree(
      worktreePath: string,
      repoPath: string,
      opts: WorktreeRemoveOptions,
    ): Promise<void> {
      // A session whose worktree was never created has nothing to remove.
      if (worktreePath === "") {
        return;
      }

      const args = opts.force
        ? ["worktree", "remove", "--force", worktreePath]
        : ["worktree", "remove", worktreePath];

      try {
        await execGit(args, repoPath);
      } catch (error: unknown) {
        // Already gone counts as success, but only if git says so. If git
        // still lists the worktree, or cannot be asked, the removal failed
        // and the caller must know.
        let registered: boolean;
        try {
          registered = await isStillRegistered(worktreePath, repoPath);
        } catch {
          throw error;
        }
        if (registered) {
          throw error;
        }
      }
    },

    async isWorktreeHealthy(
      worktreePath: string,
      repoPath: string,
    ): Promise<boolean> {
      try {
        const { stdout } = await execGit(
          ["worktree", "list", "--porcelain"],
          repoPath,
        );
        return stdout.includes(`worktree ${worktreePath}`);
      } catch {
        return false;
      }
    },

    async listWorktrees(repoPath: string): Promise<readonly string[]> {
      try {
        return await listWorktreesStrict(repoPath);
      } catch {
        return [];
      }
    },
  };
}
```

What changed against the old file: `removeWorktree` takes the repository path and the caller's `force`; it returns at once for an empty path; after a failed removal it asks git, through `listWorktreesStrict`, whether the worktree is still registered, and throws the original error if it is or if that question fails. `resolveLikeGit` resolves symbolic links on both sides before comparing. `createWorktree`, `isWorktreeHealthy` and the public `listWorktrees` behave as before.

**3b.** In `src/sessionManager.ts`, in `delete`, replace the line `await this.worktreeManager.removeWorktree(branch.worktreePath);` with:

<!-- block: sm-delete-src -->

```ts
    // The caller's choice is passed on: without force, git itself refuses to
    // remove a worktree with modified or untracked files, which also covers a
    // change made after the check above. If removal fails, this throws and the
    // session is not marked deleted.
    await this.worktreeManager.removeWorktree(branch.worktreePath, branch.repoPath, {
      force: opts.force,
    });
```

**Verify**: `pnpm typecheck` → exit 0. Then `pnpm vitest run packages/session-manager`: **exactly three tests must fail**: the two in `worktreeManager.test.ts` and the one in `sessionManager.test.ts` named in "Current state". If any other test fails, STOP.

#### Step 4: Test Part B

**4a.** In `test/worktreeManager.test.ts`, replace the whole `describe("removeWorktree", ...)` block (two tests) with:

<!-- block: wm-remove -->

```ts
describe("removeWorktree", () => {
  const LISTING = "worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\n";

  it("runs git worktree remove --force inside the repository when forced", async () => {
    const execGit: ExecGit = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });

    const mgr = createWorktreeManager(execGit);
    await mgr.removeWorktree("/repo/.joyus-worktrees/test", "/repo", { force: true });

    expect(execGit).toHaveBeenCalledOnce();
    expect(execGit).toHaveBeenCalledWith(
      ["worktree", "remove", "--force", "/repo/.joyus-worktrees/test"],
      "/repo",
    );
  });

  it("leaves --force out when not forced", async () => {
    const execGit: ExecGit = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });

    const mgr = createWorktreeManager(execGit);
    await mgr.removeWorktree("/repo/.joyus-worktrees/test", "/repo", { force: false });

    expect(execGit).toHaveBeenCalledWith(
      ["worktree", "remove", "/repo/.joyus-worktrees/test"],
      "/repo",
    );
  });

  it("does not call git for a session that never had a worktree", async () => {
    const execGit: ExecGit = vi.fn();

    const mgr = createWorktreeManager(execGit);
    await mgr.removeWorktree("", "/repo", { force: true });

    expect(execGit).not.toHaveBeenCalled();
  });

  it("does not throw when the worktree is already gone", async () => {
    const execGit: ExecGit = vi
      .fn()
      .mockRejectedValueOnce(new Error("is not a working tree"))
      .mockResolvedValueOnce({ stdout: LISTING, stderr: "" });

    const mgr = createWorktreeManager(execGit);
    await expect(
      mgr.removeWorktree("/repo/.joyus-worktrees/missing", "/repo", { force: true }),
    ).resolves.toBeUndefined();
    expect(execGit).toHaveBeenNthCalledWith(2, ["worktree", "list", "--porcelain"], "/repo");
  });

  it("throws git's error when git still lists the worktree after a failed removal", async () => {
    const execGit: ExecGit = vi
      .fn()
      .mockRejectedValueOnce(new Error("contains modified or untracked files"))
      .mockResolvedValueOnce({
        stdout: `${LISTING}worktree /repo/.joyus-worktrees/stuck\nHEAD def456\n\n`,
        stderr: "",
      });

    const mgr = createWorktreeManager(execGit);
    await expect(
      mgr.removeWorktree("/repo/.joyus-worktrees/stuck", "/repo", { force: false }),
    ).rejects.toThrow("contains modified or untracked files");
  });

  it("throws the removal error when the listing fails too", async () => {
    const execGit: ExecGit = vi
      .fn()
      .mockRejectedValueOnce(new Error("remove failed"))
      .mockRejectedValueOnce(new Error("list failed"));

    const mgr = createWorktreeManager(execGit);
    await expect(
      mgr.removeWorktree("/repo/.joyus-worktrees/stuck", "/repo", { force: true }),
    ).rejects.toThrow("remove failed");
  });

  it("recognizes the worktree when git lists it under its resolved path", async () => {
    // The repository is reached through a link: /link -> /real. Git prints /real.
    const resolveRealPath = vi.fn(async (path: string) => {
      if (path === "/link" || path === "/real") {
        return "/real";
      }
      throw new Error("ENOENT");
    });
    const execGit: ExecGit = vi
      .fn()
      .mockRejectedValueOnce(new Error("locked"))
      .mockResolvedValueOnce({
        stdout: "worktree /real\n\nworktree /real/.joyus-worktrees/stuck\n\n",
        stderr: "",
      });

    const mgr = createWorktreeManager(execGit, resolveRealPath);
    await expect(
      mgr.removeWorktree("/link/.joyus-worktrees/stuck", "/link", { force: true }),
    ).rejects.toThrow("locked");
  });

  it("compares paths as given when nothing on the path can be resolved", async () => {
    const resolveRealPath = vi.fn().mockRejectedValue(new Error("EACCES"));
    const stillListed: ExecGit = vi
      .fn()
      .mockRejectedValueOnce(new Error("locked"))
      .mockResolvedValueOnce({ stdout: "worktree /repo/.joyus-worktrees/stuck\n", stderr: "" });
    const gone: ExecGit = vi
      .fn()
      .mockRejectedValueOnce(new Error("is not a working tree"))
      .mockResolvedValueOnce({ stdout: "worktree /repo\n", stderr: "" });

    await expect(
      createWorktreeManager(stillListed, resolveRealPath).removeWorktree(
        "/repo/.joyus-worktrees/stuck",
        "/repo",
        { force: true },
      ),
    ).rejects.toThrow("locked");
    await expect(
      createWorktreeManager(gone, resolveRealPath).removeWorktree(
        "/repo/.joyus-worktrees/stuck",
        "/repo",
        { force: true },
      ),
    ).resolves.toBeUndefined();
  });
});
```

**4b.** In `test/sessionManager.test.ts`, directly below the line `import type { WorktreeManager } from "../src/worktreeManager.js";`, add:

<!-- block: sm-import -->

```ts
import { createWorktreeManager } from "../src/worktreeManager.js";
```

**4c.** In the test "force:true proceeds even with uncommitted changes", replace the line `expect(worktreeManager.removeWorktree).toHaveBeenCalledWith(branch.worktreePath);` with:

<!-- block: sm-force-assert -->

```ts
      expect(worktreeManager.removeWorktree).toHaveBeenCalledWith(
        branch.worktreePath,
        branch.repoPath,
        { force: true },
      );
```

**4d.** At the end of `describe("delete")`, add:

<!-- block: sm-delete -->

```ts
    it("passes force:false through, so git can refuse a worktree that became dirty", async () => {
      const branch = makeBranch();
      const store = makeStore({ findById: vi.fn().mockReturnValue(branch) });
      const execGit = makeExecGit();
      const worktreeManager = makeWorktreeManager();
      const detector = new FileModificationDetector(execGit, 10_000);
      const manager = new SessionManager(store, worktreeManager, detector, execGit);

      await manager.delete(branch.id, { force: false });

      expect(worktreeManager.removeWorktree).toHaveBeenCalledWith(
        branch.worktreePath,
        branch.repoPath,
        { force: false },
      );
      expect(store.softDelete).toHaveBeenCalledWith(branch.id);
    });

    it("keeps the session when the worktree cannot be removed", async () => {
      const branch = makeBranch();
      const store = makeStore({ findById: vi.fn().mockReturnValue(branch) });
      const worktreeManager = makeWorktreeManager({
        removeWorktree: vi.fn().mockRejectedValue(new Error("worktree is locked")),
      });
      const execGit = makeExecGit();
      const detector = new FileModificationDetector(execGit, 10_000);
      const stopPollingSpy = vi.spyOn(detector, "stopPolling");
      const manager = new SessionManager(store, worktreeManager, detector, execGit);

      await expect(manager.delete(branch.id, { force: true })).rejects.toThrow(
        "worktree is locked",
      );
      expect(store.softDelete).not.toHaveBeenCalled();
      expect(stopPollingSpy).not.toHaveBeenCalled();
    });

    it("keeps the session when both the removal and the check that follows it fail", async () => {
      const branch = makeBranch();
      const store = makeStore({ findById: vi.fn().mockReturnValue(branch) });
      // The real worktree manager, with a git that fails every time: first
      // "worktree remove", then "worktree list".
      const execGit = vi
        .fn()
        .mockRejectedValueOnce(new Error("remove failed"))
        .mockRejectedValueOnce(new Error("list failed"));
      const detector = new FileModificationDetector(execGit, 10_000);
      const manager = new SessionManager(
        store,
        createWorktreeManager(execGit),
        detector,
        execGit,
      );

      await expect(manager.delete(branch.id, { force: true })).rejects.toThrow("remove failed");
      expect(execGit).toHaveBeenNthCalledWith(
        1,
        ["worktree", "remove", "--force", branch.worktreePath],
        branch.repoPath,
      );
      expect(execGit).toHaveBeenNthCalledWith(2, ["worktree", "list", "--porcelain"], branch.repoPath);
      expect(store.softDelete).not.toHaveBeenCalled();
    });
```

The third of these is the case the review asked for: the real worktree manager, with a git that fails both the removal and the listing.

**Verify**: `pnpm vitest run packages/session-manager` → 148 pass. The app tests command from "Commands you will need" → 156 pass. Commit (commit 2).

### Part C — merged detection

#### Step 5: Recognize worktree branches, and require a commit made on the branch

In `src/taskBranchStore.ts`:

**5a.** Directly above the comment line `// ─── Factory ───...` that precedes `export function openTaskBranchStore(`, add:

<!-- block: tb-helper-src -->

```ts
// ─── Merged Detection (used by detectMerged) ─────────────────────────────────

/**
 * Reflog subjects that `git commit` writes: "commit: ...",
 * "commit (amend): ...", "commit (merge): ...". Movements of the branch that
 * create no commit on it have other subjects ("branch: Created from HEAD",
 * "merge main: Fast-forward", "rebase (finish): ...", "reset: moving to ...").
 */
const COMMIT_REFLOG_SUBJECT = /^commit( \([^)]*\))?: /;

/**
 * True when the branch's reflog shows at least one commit made on it.
 * `git branch --merged` also lists a branch that never had a commit of its
 * own, including one that was only fast-forwarded, and such a branch must
 * not be reported as merged. No reflog (expired or disabled) means false.
 */
async function hasCommitsMadeOnBranch(
  execGit: ExecGit,
  branchName: string,
  repoPath: string,
): Promise<boolean> {
  const { stdout } = await execGit(
    ["reflog", "show", "--format=%gs", `refs/heads/${branchName}`],
    repoPath,
  );
  return stdout.split("\n").some((subject) => COMMIT_REFLOG_SUBJECT.test(subject));
}
```

**5b.** In `detectMerged`, replace these lines:

```ts
          const branches = stdout
            .split("\n")
            .map((line) => line.replace(/^\*?\s+/, "").trim());
          if (branches.includes(row.branch_name)) {
            updateStatusStmt.run("merged", row.id);
          }
```

with:

<!-- block: tb-detect-src -->

```ts
          const branches = stdout
            .split("\n")
            // "*" marks the current branch, "+" one checked out in another worktree.
            .map((line) => line.replace(/^[*+]?\s+/, "").trim());
          if (
            branches.includes(row.branch_name) &&
            (await hasCommitsMadeOnBranch(execGit, row.branch_name, row.repo_path))
          ) {
            updateStatusStmt.run("merged", row.id);
          }
```

**Verify**: `pnpm typecheck` → exit 0. Then `pnpm vitest run packages/session-manager`: **exactly two tests must fail**, "marks branch as merged when git reports it merged" and "checks stale branches too". If any other test fails, STOP.

#### Step 6: Test Part C

In `test/taskBranchStore.test.ts`, inside `describe("detectMerged")`:

**6a.** Directly below the line `let dbPath: string;` at the top of that block (and the blank line after it), add:

<!-- block: tb-helper -->

```ts
  /** A git that answers `branch --merged` with one text and `reflog show` with another. */
  function gitWith(branchList: string, reflogSubjects: string): ExecGit {
    return vi.fn(async (args: string[]) => ({
      stdout: args[0] === "reflog" ? reflogSubjects : branchList,
      stderr: "",
    }));
  }

  // Every reflog subject in this block is copied from what git 2.50.1 printed
  // in a throwaway repository.
  const CREATED = "branch: Created from HEAD\n";
  const COMMITTED = `commit: add feature\n${CREATED}`;
```

**6b.** In "marks branch as merged when git reports it merged", replace the four-line statement that starts with `const execGit: ExecGit = vi.fn().mockResolvedValue({` with:

<!-- block: tb-fix-merged -->

```ts
    const execGit = gitWith("  main\n  joyus/2026-03-19-feature\n", COMMITTED);
```

**6c.** In "checks stale branches too", replace the same four-line statement with:

<!-- block: tb-fix-stale -->

```ts
    const execGit = gitWith("  main\n  joyus/2026-03-19-stale-feat\n", COMMITTED);
```

**6d.** At the end of `describe("detectMerged")`, add:

<!-- block: tb-tests -->

```ts
  it("marks a branch that is checked out in another worktree", async () => {
    store.create(
      makeInput({
        sessionId: "sess-worktree-merged",
        branchName: "joyus/2026-03-19-feature",
        repoPath: "/repo",
      }),
    );
    const execGit = gitWith("* main\n+ joyus/2026-03-19-feature\n", COMMITTED);

    await store.detectMerged(execGit);

    expect(store.findBySessionId("sess-worktree-merged")?.status).toBe("merged");
    expect(execGit).toHaveBeenCalledWith(
      ["reflog", "show", "--format=%gs", "refs/heads/joyus/2026-03-19-feature"],
      "/repo",
    );
  });

  it("marks a branch whose only commit was amended", async () => {
    store.create(
      makeInput({
        sessionId: "sess-amended",
        branchName: "joyus/2026-03-19-amended",
        repoPath: "/repo",
      }),
    );

    await store.detectMerged(
      gitWith("+ joyus/2026-03-19-amended\n", `commit (amend): reword\n${CREATED}`),
    );

    expect(store.findBySessionId("sess-amended")?.status).toBe("merged");
  });

  it("does not mark a new branch that has no commits of its own", async () => {
    store.create(
      makeInput({
        sessionId: "sess-fresh",
        branchName: "joyus/2026-03-19-fresh",
        repoPath: "/repo",
      }),
    );

    await store.detectMerged(gitWith("* main\n+ joyus/2026-03-19-fresh\n", CREATED));

    expect(store.findBySessionId("sess-fresh")?.status).toBe("active");
  });

  it("does not mark a branch that only moved: fast-forward, rebase, reset, switch -C", async () => {
    const movedOnly = [
      "merge main: Fast-forward",
      "pull -q --ff-only . main: Fast-forward",
      "rebase (finish): refs/heads/joyus/2026-03-19-moved onto 795644e1f87eae4eb574c5beaee7104f31116c68",
      "reset: moving to main",
      "branch: Reset to main",
      "cherry-pick: fast-forward",
    ];

    for (const [index, subject] of movedOnly.entries()) {
      const sessionId = `sess-moved-${index}`;
      const branchName = `joyus/2026-03-19-moved-${index}`;
      store.create(makeInput({ sessionId, branchName, repoPath: "/repo" }));

      await store.detectMerged(gitWith(`+ ${branchName}\n`, `${subject}\n${CREATED}`));

      expect(store.findBySessionId(sessionId)?.status).toBe("active");
    }
  });

  it("does not mark a branch whose reflog is empty", async () => {
    store.create(
      makeInput({
        sessionId: "sess-no-reflog",
        branchName: "joyus/2026-03-19-old",
        repoPath: "/repo",
      }),
    );

    await store.detectMerged(gitWith("+ joyus/2026-03-19-old\n", ""));

    expect(store.findBySessionId("sess-no-reflog")?.status).toBe("active");
  });

  it("does not mark a branch when its reflog cannot be read", async () => {
    store.create(
      makeInput({
        sessionId: "sess-reflog-error",
        branchName: "joyus/2026-03-19-error",
        repoPath: "/repo",
      }),
    );
    const execGit: ExecGit = vi.fn(async (args: string[]) => {
      if (args[0] === "reflog") {
        throw new Error("fatal: ambiguous argument");
      }
      return { stdout: "+ joyus/2026-03-19-error\n", stderr: "" };
    });

    await expect(store.detectMerged(execGit)).resolves.toBeUndefined();

    expect(store.findBySessionId("sess-reflog-error")?.status).toBe("active");
  });
```

**Verify**: `pnpm vitest run packages/session-manager` → 154 pass. Commit (commit 3).

### Part D — the same checks against real git

#### Step 7: Add the real-git test file

Create `packages/session-manager/test/realGit.test.ts` with:

<!-- block: real-git -->

```ts
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openTaskBranchStore } from "../src/taskBranchStore.js";
import type { ExecGit, TaskBranchStore } from "../src/taskBranchStore.js";
import { createWorktreeManager } from "../src/worktreeManager.js";

// These tests run the real git binary in throwaway repositories. Mocked git
// output cannot show what git really prints for a fast-forward, or how it
// spells a worktree path.

const execFileAsync = promisify(execFile);

let root: string;
let repo: string;
let execGit: ExecGit;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "session-manager-real-git-"));
  repo = join(root, "repo");
  await mkdir(repo);
  // An empty global config and a fixed identity: the developer's own git
  // settings (signing, hooks, default branch) must not reach these tests.
  const emptyConfig = join(root, "gitconfig");
  await writeFile(emptyConfig, "");
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.invalid",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.invalid",
  };
  execGit = async (args, cwd) => {
    const { stdout, stderr } = await execFileAsync("git", args, { cwd, env });
    return { stdout, stderr };
  };

  await execGit(["init", "-q"], repo);
  await execGit(["symbolic-ref", "HEAD", "refs/heads/main"], repo);
  await commitFile(repo, "base.txt", "base");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function commitFile(cwd: string, name: string, message: string): Promise<void> {
  await writeFile(join(cwd, name), `${message}\n`);
  await execGit(["add", name], cwd);
  await execGit(["commit", "-q", "-m", message], cwd);
}

/** A session branch in its own worktree, the way the worktree manager makes one. */
async function addSessionWorktree(name: string, repoPath = repo): Promise<string> {
  const worktreePath = join(repoPath, ".joyus-worktrees", name);
  await execGit(["worktree", "add", "-q", "-b", `joyus/${name}`, worktreePath], repoPath);
  return worktreePath;
}

describe("detectMerged against real git", () => {
  let store: TaskBranchStore;

  beforeEach(() => {
    store = openTaskBranchStore(join(root, "sessions.db"));
  });

  afterEach(() => {
    store.close();
  });

  function track(name: string, worktreePath: string): void {
    store.create({
      sessionId: `sess-${name}`,
      repoPath: repo,
      worktreePath,
      branchName: `joyus/${name}`,
      missionLabel: name,
      missionSource: "inferred",
      mode: "managed",
    });
  }

  function statusOf(name: string): string | undefined {
    return store.findBySessionId(`sess-${name}`)?.status;
  }

  it("does not mark a fresh session branch", async () => {
    track("fresh", await addSessionWorktree("fresh"));

    await store.detectMerged(execGit);

    expect(statusOf("fresh")).toBe("active");
  });

  it("does not mark a session branch that was only fast-forwarded to a newer main", async () => {
    const worktree = await addSessionWorktree("ff");
    track("ff", worktree);
    await commitFile(repo, "main-1.txt", "main moves on");
    await execGit(["merge", "-q", "main"], worktree);

    // Git lists it as merged, with the "+" of a branch checked out elsewhere.
    const { stdout } = await execGit(["branch", "--merged", "HEAD"], repo);
    expect(stdout).toContain("+ joyus/ff");

    await store.detectMerged(execGit);

    expect(statusOf("ff")).toBe("active");
  });

  it("marks a session branch whose commit was merged into main", async () => {
    const worktree = await addSessionWorktree("work");
    track("work", worktree);
    await commitFile(worktree, "work.txt", "session work");

    await store.detectMerged(execGit);
    expect(statusOf("work")).toBe("active");

    await commitFile(repo, "main-1.txt", "main moves on");
    await execGit(["merge", "-q", "--no-edit", "joyus/work"], repo);
    await store.detectMerged(execGit);

    expect(statusOf("work")).toBe("merged");
  });

  it("marks a session branch that was rebased and then fast-forwarded into main", async () => {
    const worktree = await addSessionWorktree("rebased");
    track("rebased", worktree);
    await commitFile(worktree, "work.txt", "session work");
    await commitFile(repo, "main-1.txt", "main moves on");
    await execGit(["rebase", "-q", "main"], worktree);
    await execGit(["merge", "-q", "--ff-only", "joyus/rebased"], repo);

    await store.detectMerged(execGit);

    expect(statusOf("rebased")).toBe("merged");
  });
});

describe("removeWorktree against real git", () => {
  async function listed(): Promise<string> {
    return (await execGit(["worktree", "list", "--porcelain"], repo)).stdout;
  }

  it("removes a clean worktree without force", async () => {
    const worktree = await addSessionWorktree("clean");

    await createWorktreeManager(execGit).removeWorktree(worktree, repo, { force: false });

    expect(existsSync(worktree)).toBe(false);
    expect(await listed()).not.toContain(".joyus-worktrees/clean");
  });

  it("refuses a worktree with an untracked file unless forced", async () => {
    const worktree = await addSessionWorktree("dirty");
    await writeFile(join(worktree, "new.txt"), "not committed\n");
    const manager = createWorktreeManager(execGit);

    await expect(manager.removeWorktree(worktree, repo, { force: false })).rejects.toThrow(
      "contains modified or untracked files",
    );
    expect(existsSync(join(worktree, "new.txt"))).toBe(true);

    await manager.removeWorktree(worktree, repo, { force: true });
    expect(existsSync(worktree)).toBe(false);
  });

  it("resolves when the worktree folder was deleted by hand, and again when nothing is left", async () => {
    const worktree = await addSessionWorktree("gone");
    await rm(worktree, { recursive: true, force: true });
    const manager = createWorktreeManager(execGit);

    await expect(manager.removeWorktree(worktree, repo, { force: true })).resolves.toBeUndefined();
    await expect(manager.removeWorktree(worktree, repo, { force: true })).resolves.toBeUndefined();
    expect(await listed()).not.toContain(".joyus-worktrees/gone");
  });

  it("still sees a refused worktree when the repository is reached through a symbolic link", async () => {
    // Git lists the resolved path; the session stored the path through the link.
    const link = join(root, "link");
    await symlink(repo, link);
    const worktree = await addSessionWorktree("linked", link);
    await writeFile(join(worktree, "new.txt"), "not committed\n");
    expect(await listed()).toContain(join(await realpath(repo), ".joyus-worktrees", "linked"));
    expect(await listed()).not.toContain(worktree);

    await expect(
      createWorktreeManager(execGit).removeWorktree(worktree, link, { force: false }),
    ).rejects.toThrow("contains modified or untracked files");
    expect(existsSync(worktree)).toBe(true);
  });
});
```

**Verify**: `pnpm vitest run packages/session-manager` → 162 pass. If a test in the new file fails, STOP and report the test name, the assertion, and the output of `git --version`. Do not change an assertion to match what your git prints. Commit (commit 4).

### Step 8: Run the full gates

Run `pnpm typecheck`, then `pnpm coverage`.

**Verify**: both exit 0, and the coverage summary shows 100% for `sessionManager.ts`, `worktreeManager.ts` and `taskBranchStore.ts`. If a line or branch is uncovered in code this plan added, STOP and report it: the reference run showed 100% for the three files. Do not add a `v8 ignore` comment.

## Test plan

- Part A (5 tests): two concurrent events create one worktree and one record; a waiting event retries after a failed creation; a failing event reaches `onError`; the default handler logs to stderr; the factory passes `onError` through.
- Part B, worktree manager (8 tests, replacing 2): `--force` only when forced, inside the repository; an empty path calls nothing; an already-missing worktree is success; a worktree git still lists is an error; removal and listing both failing is an error; a resolved path is recognized; paths are compared as given when nothing resolves.
- Part B, `delete` (3 new tests, 1 changed): `force:false` reaches the worktree manager; a failed removal does not mark the session deleted or stop polling; removal and listing both failing, through the real worktree manager, makes `delete` reject without marking the session deleted.
- Part C (6 new tests, 2 changed): a `+`-prefixed branch with a commit is marked; an amended commit counts; a fresh branch is not marked; a branch that only moved (fast-forward, pull, rebase, reset, `switch -C`, cherry-pick fast-forward) is not marked; an empty reflog is not marked; an unreadable reflog is not marked and does not throw.
- Part D (8 tests, real git): fresh branch; fast-forwarded without work; a real commit before and after a true merge; a real commit that was rebased and fast-forwarded into main; clean removal without force; a dirty worktree refused, then forced; a folder deleted by hand, removed twice; a refused worktree in a repository reached through a symbolic link.
- Verification: `pnpm vitest run packages/session-manager` → 162 pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm vitest run packages/session-manager` exits 0 with 162 tests
- [ ] `pnpm vitest run apps/desktop-companion/test/integration apps/desktop-companion/test/acceptance apps/desktop-companion/test/sidecar/sessionWiring.test.ts` exits 0
- [ ] `pnpm coverage` exits 0
- [ ] `grep -c 'void this.onFileModification' packages/session-manager/src/sessionManager.ts` prints 0
- [ ] `grep -c 'listWorktreesStrict' packages/session-manager/src/worktreeManager.ts` prints 3
- [ ] `grep -c 'hasCommitsMadeOnBranch' packages/session-manager/src/taskBranchStore.ts` prints 2
- [ ] `grep -c '"--force"' packages/session-manager/src/worktreeManager.ts` prints 1
- [ ] `git diff --stat cea62f6 -- apps/desktop-companion/src/sidecar/sessionWiring.ts` prints nothing
- [ ] `git status --short` lists only the in-scope files
- [ ] `plans/README.md` status row for 016 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" does not match the excerpts.
- Another caller of `removeWorktree` exists outside `sessionManager.ts` (`grep -rn 'removeWorktree(' apps packages --include='*.ts' | grep -v /test/`). Report it; do not guess its repository path or its `force`.
- After Step 3 or Step 5, the set of failing tests is anything other than the ones named there.
- A test under `apps/` fails at any point. The reference run needed no change there.
- The burst test in Step 2 fails, or hangs until its timeout. The serialization is not working; do not relax the assertion.
- A real-git test in Step 7 fails. Report it with your `git --version`.
- You find yourself adding a database column or editing a file under `apps/`.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

What the merged rule still gets wrong, stated plainly:

- **Work that was committed and then thrown away.** A branch that once had a commit, was then reset back to main, and so has nothing of its own, is listed by `--merged` and has a `commit` subject in its reflog. It is marked merged although nothing landed. Nothing is lost by that: the branch holds no work.
- **Work that reached the branch without `git commit`.** A branch whose only changes came from `git cherry-pick`, `git revert`, `git am`, or a tool that moves the ref directly has no `commit` subject. It is never marked merged and stays active or stale. This is the cautious side: a session is never marked merged without evidence. Widening the rule to `cherry-pick:` needs care, because `cherry-pick: fast-forward` is a move.
- **Reflog expiry and disabled reflogs.** Git prunes reflog entries (90 days by default). A branch whose `commit` entries have expired, or a repository with `core.logAllRefUpdates=false`, is never marked merged.
- **Squash and rebase merges by a hosting service.** `git branch --merged` does not list a branch that was squash-merged or rebased on the server. Those sessions stay active or stale. Detecting them needs the pull-request state, which `sessionCloser.ts` already tracks.
- **"Merged into what".** The question is asked against `HEAD` of the main checkout, whatever branch that is. Unchanged by this plan.
- **Measured on one git version.** The reflog subjects were read from git 2.50.1. `commit: ` and `commit (amend): ` have been stable for many years, but the real-git tests are the guard: they fail if a git version words these differently.

About removal:

- **If git cannot be asked, a session cannot be deleted.** When the removal fails and the listing fails too (the repository folder is gone, git is not installed, the disk is unreadable), `delete` rejects and the session stays. That is the point of review finding 3, and it means a session whose whole repository was deleted needs manual cleanup. Deciding that "repository folder missing" may count as "gone" is a small follow-up, not taken here.
- **A locked worktree is not removed**, with or without `force`. Git wants `--force` twice for that. `delete` rejects with git's message.
- **Without `force`, two things can refuse.** The check in `delete` throws `UncommittedChangesError` when `git status --porcelain` prints anything. If a file changes after that check, git itself refuses and `delete` rejects with git's message instead. Callers must handle both.
- **Health checks still compare plain strings.** `isWorktreeHealthy` in `worktreeManager.ts` and its twin in `taskBranchStore.ts` look for the stored path in git's listing. For a repository under a symbolic link (every repository under `/tmp` on macOS) they report "not found". Found while revising this plan; recorded in `plans/README.md` as a follow-up.
- **A broken session and a non-forced delete.** A session stored with `worktreePath: ""` makes the uncommitted-changes check run `git status` in the sidecar's own working directory. Found while revising this plan; recorded in `plans/README.md` as a follow-up. A forced delete of such a session works: `removeWorktree` returns at once for an empty path.
- **Session branches are kept.** Deleting a session removes its worktree, not its `joyus/...` branch.
- **Not reachable from the UI yet.** The sidecar registers the session methods, but the Rust shell has no commands for them and nothing sends `session.fileModified`. When those are added, wire `onError` in `sessionWiring.ts` to the sidecar's error notification instead of relying on the stderr default.
- Reviewer focus: no code path may start `onFileModification` without a `.catch`; `delete` must not call `softDelete` after a failed removal; `removeWorktree` must not resolve unless git removed the worktree or a successful listing shows it is gone; and `detectMerged` must not mark a branch without a `commit` subject in its reflog.
