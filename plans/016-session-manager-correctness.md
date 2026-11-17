# Plan 016: Session manager creates one worktree per session, really removes worktrees, and detects merged branches

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat cea62f6..HEAD -- packages/session-manager/`
> If any file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P3 today, P1 before session features are switched on (see "Why this matters")
- **Effort**: M
- **Risk**: LOW–MED (three independent fixes in one package; one interface gains a parameter)
- **Depends on**: plans/007-correct-agent-and-contributor-docs.md, plans/008-make-recon-tests-hermetic.md
- **Category**: bug
- **Planned at**: commit `cea62f6`, 2026-11-17

## Why this matters

`@joyus/session-manager` gives each AI coding session its own git branch and worktree inside the user's repository, tracks them in a SQLite table, and cleans up afterward. The sidecar wires it in by default. No UI path reaches it yet, because the Rust shell has no session commands (they are on the known-gaps list from plan 014). These three defects must be fixed before those commands are added:

1. **A burst of file events crashes the sidecar.** The first "file modified" event for a session checks the table, finds nothing, and then awaits `git worktree add` before inserting a row. A second event for the same session that arrives during that await also finds nothing and starts a second worktree. Its insert then violates the table's unique index on `session_id`. The handler was started with `void`, so the error becomes an unhandled promise rejection, and the sidecar treats every unhandled rejection as fatal and exits. An agent editing two files in a row is enough.
2. **Deleting a session never removes its worktree.** `git worktree remove` is run without a working directory, so it runs wherever the sidecar happens to be, fails with "not a git repository", and the failure is swallowed as "already gone". The row is marked deleted; the directory and its registration stay in the user's repository forever.
3. **No branch is ever marked merged.** The code parses `git branch --merged HEAD`, which prefixes a branch that is checked out in another worktree with `+`. Every session branch is checked out in its own worktree, so every one has that prefix, and the parser only strips `*`. Fixing only the prefix would introduce the opposite bug: git also lists a brand-new branch with no commits as "merged", so every fresh session would be marked merged at the next start.

## Current state

Files (all under `packages/session-manager/`):

- `src/sessionManager.ts` (213 lines) — the `SessionManager` class.
- `src/worktreeManager.ts` (102 lines) — `createWorktreeManager(execGit)`.
- `src/taskBranchStore.ts` (421 lines) — the SQLite store; `detectMerged` is at lines 375–395.
- `test/sessionManager.test.ts`, `test/worktreeManager.test.ts`, `test/taskBranchStore.test.ts`.

The git runner type (`src/taskBranchStore.ts:45-48`). The second argument is the working directory:

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
      // ... creates a record with status "broken" and returns
    }

    const branch = this.store.create({
      sessionId: event.sessionId,
      // ...
    });

    this.detector.startPolling(event.repoPath, event.sessionId);

    // Suppress unused variable — branch is created for side effect
    void branch;
  }
```

The factory at the bottom of the file:

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

The interface (lines 19–24) and the two relevant methods. `createWorktree` passes `repoPath` as the working directory; `removeWorktree` passes nothing:

```ts
export interface WorktreeManager {
  createWorktree(params: WorktreeCreateParams): Promise<WorktreeCreateResult>;
  removeWorktree(worktreePath: string): Promise<void>;
  isWorktreeHealthy(worktreePath: string, repoPath: string): Promise<boolean>;
  listWorktrees(repoPath: string): Promise<readonly string[]>;
}
```

```ts
export function createWorktreeManager(execGit: ExecGit): WorktreeManager {
  return {
    async createWorktree(
      // ...
          await execGit(
            ["worktree", "add", "-b", branchName, worktreePath],
            repoPath,
          );
    // ...
    async removeWorktree(worktreePath: string): Promise<void> {
      try {
        await execGit(["worktree", "remove", "--force", worktreePath]);
      } catch {
        // If worktree doesn't exist, treat as success (idempotent)
      }
    },
```

Its only caller, in `SessionManager.delete` (`src/sessionManager.ts:164-166`):

```ts
    await this.worktreeManager.removeWorktree(branch.worktreePath);
    this.store.softDelete(taskBranchId);
    this.detector.stopPolling(branch.sessionId);
```

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
        }
      }
    },
```

What `git branch --merged HEAD` prints: one branch per line, with a two-character prefix. `* ` is the current branch, `+ ` is a branch checked out in another worktree, two spaces is anything else.

What `git reflog show --format=%H <branch>` prints: one commit hash per line, newest first. The first line is the branch's current tip. The last line is the commit the branch was created from. A branch with no commits of its own has exactly one line.

### Test conventions

`test/sessionManager.test.ts` builds mocks with helpers and constructs the class directly:

```ts
function makeStore(overrides: Partial<TaskBranchStore> = {}): TaskBranchStore {
  return {
    create: vi.fn().mockReturnValue(makeBranch()),
    findById: vi.fn().mockReturnValue(undefined),
    findBySessionId: vi.fn().mockReturnValue(undefined),
    // ...
    ...overrides,
  };
}

function makeWorktreeManager(overrides: Partial<WorktreeManager> = {}): WorktreeManager {
  return {
    createWorktree: vi.fn().mockResolvedValue({
      worktreePath: "/repo/.joyus-worktrees/2026-03-19-session",
      branchName: "joyus/2026-03-19-session",
    }),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    // ...
  };
}

// inside a test:
      const execGit = makeExecGit();
      const detector = new FileModificationDetector(execGit, 10_000);
      const manager = new SessionManager(store, worktreeManager, detector, execGit);

      await manager.onFileModification({
        sessionId: "sess-1",
        repoPath: "/repo",
        filePath: "/repo/src/foo.ts",
        detectedAt: Date.now(),
        source: "hook",
      });
```

`describe("detector listener registration")` in the same file has a test named "constructor registers onModification listener that calls onFileModification". It shows how to make the detector emit an event. Read it before Step 2.

`test/worktreeManager.test.ts`, the two existing removal tests:

```ts
  it("calls git worktree remove --force", async () => {
    const execGit: ExecGit = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });

    const mgr = createWorktreeManager(execGit);
    await mgr.removeWorktree("/repo/.joyus-worktrees/test");

    expect(execGit).toHaveBeenCalledWith([
      "worktree",
      "remove",
      "--force",
      "/repo/.joyus-worktrees/test",
    ]);
  });

  it("does not throw when worktree is missing (idempotent)", async () => {
    const execGit: ExecGit = vi.fn().mockRejectedValue(new Error("not a worktree"));
    // ...
```

`test/taskBranchStore.test.ts`, `describe("detectMerged")`, uses a real temporary database and a mocked git runner:

```ts
  it("marks branch as merged when git reports it merged", async () => {
    const created = store.create(
      makeInput({
        sessionId: "sess-detect-merged",
        branchName: "joyus/2026-03-19-feature",
        repoPath: "/repo",
      }),
    );

    const execGit: ExecGit = vi.fn().mockResolvedValue({
      stdout: "  main\n  joyus/2026-03-19-feature\n",
      stderr: "",
    });

    await store.detectMerged(execGit);

    const found = store.findBySessionId("sess-detect-merged");
    expect(found?.status).toBe("merged");
  });
```

Repo conventions: TypeScript strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Vitest. Coverage must stay at 100% lines, functions, branches and statements. Errors are handled explicitly, never silently dropped.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Package tests | `pnpm vitest run packages/session-manager` | all pass |
| Sidecar wiring tests (a consumer) | `pnpm vitest run apps/desktop-companion/test/sidecar` | all pass |
| Full coverage gate | `pnpm coverage` | exit 0, thresholds met |

Never run `pnpm ci` (that is clean-install in pnpm). The full pipeline is `pnpm run ci`.

Known flaky tests, unrelated to this plan: `apps/desktop-companion/test/ui/SessionsPage.test.ts` ("clears mode note timers…"), `apps/desktop-companion/test/ui/components/LocalSiteCard.test.ts`, and a timing-dependent coverage gap in `ReconSetup.tsx`. If `pnpm coverage` fails only in one of those, rerun it once. If it fails again, treat it as a STOP condition.

## Scope

**In scope** (the only files you should modify):
- `packages/session-manager/src/sessionManager.ts`
- `packages/session-manager/src/worktreeManager.ts`
- `packages/session-manager/src/taskBranchStore.ts` (`detectMerged` and one new helper only)
- `packages/session-manager/test/sessionManager.test.ts`
- `packages/session-manager/test/worktreeManager.test.ts`
- `packages/session-manager/test/taskBranchStore.test.ts`
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch, even though they look related):
- `apps/desktop-companion/src/sidecar/sessionWiring.ts` and the Rust shell. Adding the session commands to the Rust shell is separate work.
- The database schema. Do not add a column.
- Deleting the `joyus/...` branch when a session is deleted. Only the worktree is removed; the branch keeps the user's commits. That is the current design.
- `isWorktreeHealthy`. It compares paths as plain strings, like the new code in Step 3.
- `sessionCloser.ts`, `gitPusher.ts`, `prCreator.ts`.

## Git workflow

- Branch: `fix/016-session-manager-correctness`
- Three commits, one per part: (1) `fix: create one worktree per session and report event failures`, (2) `fix: remove session worktrees from their own repository`, (3) `fix: detect merged session branches checked out in worktrees`. Conventional commits, matching `git log`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Part A — one worktree per session

#### Step 1: Serialize creation per session and report failures

In `src/sessionManager.ts`:

**1a.** Add a field below `private globalMode`:

```ts
  /** Session ids whose first event is still creating a worktree and record. */
  private readonly creating = new Map<string, Promise<void>>();
```

**1b.** Add a sixth constructor parameter after `staleDays`, and replace the listener body:

```ts
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
```

`console.error` writes to stderr, which is safe: the sidecar uses stdout for its protocol.

**1c.** Replace the start of `onFileModification`, up to and including the `existing !== undefined` block, and move the rest of the method body into a new private method. The result:

```ts
  async onFileModification(event: FileModificationEvent): Promise<void> {
    if (this.getMode(event.repoPath) === "advisory") {
      return;
    }

    // Events for a new session arrive in bursts. Wait for any creation that
    // is already running for this session, so that exactly one worktree and
    // one record are created.
    let inFlight = this.creating.get(event.sessionId);
    while (inFlight !== undefined) {
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
    // ... the rest of the old method body, unchanged, from this line to the end
  }
```

Move the old body exactly; do not rewrite it. The `inFlight.catch(() => undefined)` is not a swallowed error: the event that owns the creation reports its own failure, and the waiting event only needs to know that it has finished.

**1d.** In `SessionManagerDeps`, add `readonly onError?: (error: unknown) => void;` and pass `deps.onError` as the sixth argument in `createSessionManager`.

**Verify**: `pnpm typecheck` → exit 0. `pnpm vitest run packages/session-manager/test/sessionManager.test.ts` → existing tests pass.

#### Step 2: Test Part A

Add to `test/sessionManager.test.ts`, inside `describe("onFileModification — managed mode")`:

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
      let finishWorktree: (value: { worktreePath: string; branchName: string }) => void = () => undefined;
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

If `source: "hook"` is not a valid value of the event's `source` type in this codebase, use the value the existing tests in this file use.

Add to `describe("detector listener registration")`, following the existing test there for how to make the detector emit an event:

```ts
    it("reports a failed event through onError instead of an unhandled rejection", async () => {
      const failure = new Error("store unavailable");
      const store = makeStore({
        findBySessionId: vi.fn(() => {
          throw failure;
        }),
      });
      const onError = vi.fn();
      // Build the manager with onError as the sixth constructor argument,
      // then emit one event through the detector exactly as the existing
      // test in this block does.
      // ...
      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalledWith(failure);
      });
    });

    it("logs to stderr by default when no onError is given", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
      // Same as the previous test, but construct the manager with five
      // arguments (no onError).
      // ...
      await vi.waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          "[session-manager] failed to handle a file modification:",
          expect.any(Error),
        );
      });
      consoleError.mockRestore();
    });
```

Replace each `// ...` with real code copied from the existing test in that block. In `describe("createSessionManager")`, add one test that passes `onError` in the deps object and asserts the returned object is a `SessionManager`.

**Verify**: `pnpm vitest run packages/session-manager/test/sessionManager.test.ts` → all pass. Commit (commit 1).

### Part B — real worktree removal

#### Step 3: Run the removal in the repository and stop hiding real failures

In `src/worktreeManager.ts`:

1. Change the interface line to `removeWorktree(worktreePath: string, repoPath: string): Promise<void>;`.
2. Change `createWorktreeManager` so the object is held in a constant (`const manager: WorktreeManager = { ... }; return manager;`), and replace `removeWorktree` with:

```ts
    async removeWorktree(worktreePath: string, repoPath: string): Promise<void> {
      try {
        await execGit(["worktree", "remove", "--force", worktreePath], repoPath);
      } catch (error: unknown) {
        // Already gone counts as success. If git still lists the worktree,
        // the removal really failed and the caller must know.
        const remaining = await manager.listWorktrees(repoPath);
        if (remaining.includes(worktreePath)) {
          throw error;
        }
      }
    },
```

In `src/sessionManager.ts`, change the call in `delete` to:

```ts
    await this.worktreeManager.removeWorktree(branch.worktreePath, branch.repoPath);
```

**Verify**: `pnpm typecheck` → exit 0.

#### Step 4: Test Part B

In `test/worktreeManager.test.ts`, replace the two existing removal tests with three:

```ts
  it("runs git worktree remove --force inside the repository", async () => {
    const execGit: ExecGit = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });

    const mgr = createWorktreeManager(execGit);
    await mgr.removeWorktree("/repo/.joyus-worktrees/test", "/repo");

    expect(execGit).toHaveBeenCalledWith(
      ["worktree", "remove", "--force", "/repo/.joyus-worktrees/test"],
      "/repo",
    );
  });

  it("does not throw when the worktree is already gone", async () => {
    const execGit: ExecGit = vi
      .fn()
      .mockRejectedValueOnce(new Error("not a working tree"))
      .mockResolvedValueOnce({ stdout: "worktree /repo\n", stderr: "" });

    const mgr = createWorktreeManager(execGit);
    await expect(
      mgr.removeWorktree("/repo/.joyus-worktrees/missing", "/repo"),
    ).resolves.toBeUndefined();
  });

  it("throws when git still lists the worktree after a failed removal", async () => {
    const execGit: ExecGit = vi
      .fn()
      .mockRejectedValueOnce(new Error("worktree is locked"))
      .mockResolvedValueOnce({
        stdout: "worktree /repo\nworktree /repo/.joyus-worktrees/stuck\n",
        stderr: "",
      });

    const mgr = createWorktreeManager(execGit);
    await expect(
      mgr.removeWorktree("/repo/.joyus-worktrees/stuck", "/repo"),
    ).rejects.toThrow("worktree is locked");
  });
```

In `test/sessionManager.test.ts`, in "force:true proceeds even with uncommitted changes", change the assertion to:

```ts
      expect(worktreeManager.removeWorktree).toHaveBeenCalledWith(branch.worktreePath, branch.repoPath);
```

Add one test to `describe("delete")`:

```ts
    it("keeps the session when the worktree cannot be removed", async () => {
      const branch = makeBranch();
      const store = makeStore({ findById: vi.fn().mockReturnValue(branch) });
      const worktreeManager = makeWorktreeManager({
        removeWorktree: vi.fn().mockRejectedValue(new Error("worktree is locked")),
      });
      const execGit = makeExecGit();
      const detector = new FileModificationDetector(execGit, 10_000);
      const manager = new SessionManager(store, worktreeManager, detector, execGit);

      await expect(manager.delete(branch.id, { force: true })).rejects.toThrow("worktree is locked");
      expect(store.softDelete).not.toHaveBeenCalled();
    });
```

**Verify**: `pnpm vitest run packages/session-manager` → all pass. `pnpm vitest run apps/desktop-companion/test/sidecar` → all pass. Commit (commit 2).

### Part C — merged detection

#### Step 5: Recognize worktree branches, and ignore branches with no work

In `src/taskBranchStore.ts`, add this function above the function that contains `detectMerged` (at module level, next to the other helpers):

```ts
/**
 * True when the branch has moved past the commit it was created from.
 * `git branch --merged` also lists a branch with no commits of its own, and
 * such a branch must not be reported as merged.
 */
async function hasOwnCommits(
  execGit: ExecGit,
  branchName: string,
  repoPath: string,
): Promise<boolean> {
  const { stdout } = await execGit(["reflog", "show", "--format=%H", branchName], repoPath);
  const entries = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const tip = entries[0];
  const createdFrom = entries[entries.length - 1];
  // No reflog (expired, or never recorded): do not mark.
  return tip !== undefined && createdFrom !== undefined && tip !== createdFrom;
}
```

Replace the body of the `try` block in `detectMerged` with:

```ts
          const { stdout } = await execGit(
            ["branch", "--merged", "HEAD"],
            row.repo_path,
          );
          const branches = stdout
            .split("\n")
            // "*" marks the current branch, "+" one checked out in another worktree.
            .map((line) => line.replace(/^[*+]?\s+/, "").trim());
          if (
            branches.includes(row.branch_name) &&
            (await hasOwnCommits(execGit, row.branch_name, row.repo_path))
          ) {
            updateStatusStmt.run("merged", row.id);
          }
```

**Verify**: `pnpm typecheck` → exit 0.

#### Step 6: Test Part C

In `test/taskBranchStore.test.ts`, inside `describe("detectMerged")`, add this helper at the top of the block:

```ts
  function gitWith(branchList: string, reflog: string): ExecGit {
    return vi.fn(async (args: string[]) => ({
      stdout: args[0] === "reflog" ? reflog : branchList,
      stderr: "",
    }));
  }
```

Change "marks branch as merged when git reports it merged" to use `gitWith("  main\n  joyus/2026-03-19-feature\n", "bbb222\naaa111\n")`. Then add:

```ts
  it("marks a branch that is checked out in another worktree", async () => {
    store.create(
      makeInput({
        sessionId: "sess-worktree-merged",
        branchName: "joyus/2026-03-19-feature",
        repoPath: "/repo",
      }),
    );

    await store.detectMerged(gitWith("* main\n+ joyus/2026-03-19-feature\n", "bbb222\naaa111\n"));

    expect(store.findBySessionId("sess-worktree-merged")?.status).toBe("merged");
  });

  it("does not mark a new branch that has no commits of its own", async () => {
    store.create(
      makeInput({
        sessionId: "sess-fresh",
        branchName: "joyus/2026-03-19-fresh",
        repoPath: "/repo",
      }),
    );

    await store.detectMerged(gitWith("* main\n+ joyus/2026-03-19-fresh\n", "aaa111\n"));

    expect(store.findBySessionId("sess-fresh")?.status).not.toBe("merged");
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

    expect(store.findBySessionId("sess-no-reflog")?.status).not.toBe("merged");
  });
```

Leave the other existing tests in this block as they are unless one fails; if one does, switch its git mock to `gitWith(...)` with a two-line reflog.

**Verify**: `pnpm vitest run packages/session-manager` → all pass. Commit (commit 3).

### Step 7: Run the full gates

Run `pnpm typecheck`, then `pnpm coverage`.

**Verify**: both exit 0, and the coverage summary shows 100% for `sessionManager.ts`, `worktreeManager.ts` and `taskBranchStore.ts`. If a line or branch you added is uncovered, add a focused test; do not add a `v8 ignore` comment.

## Test plan

- Part A: two concurrent events create one worktree and one record; a waiting event retries after a failed creation; a failing event reaches `onError`; the default handler logs to stderr; the factory passes `onError` through.
- Part B: removal runs in the repository; an already-missing worktree is success; a worktree git still lists is an error; `delete` does not mark the session deleted when removal fails.
- Part C: a `+`-prefixed branch is recognized; a branch with one reflog entry is not marked; an empty reflog is not marked.
- Structural patterns: the existing tests quoted in "Current state".
- Verification: `pnpm vitest run packages/session-manager` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm vitest run packages/session-manager` exits 0
- [ ] `pnpm vitest run apps/desktop-companion/test/sidecar` exits 0
- [ ] `pnpm coverage` exits 0
- [ ] `grep -c 'void this.onFileModification' packages/session-manager/src/sessionManager.ts` prints 0
- [ ] `grep -c '"worktree", "remove", "--force", worktreePath\], repoPath' packages/session-manager/src/worktreeManager.ts` prints 1
- [ ] `grep -c 'hasOwnCommits' packages/session-manager/src/taskBranchStore.ts` prints 2
- [ ] `git status --short` lists only the in-scope files
- [ ] `plans/README.md` status row for 016 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" does not match the excerpts.
- Another caller of `removeWorktree` exists outside `sessionManager.ts` (`grep -rn 'removeWorktree(' apps packages --include='*.ts' | grep -v test`). Report it; do not guess its repository path.
- A test under `apps/desktop-companion/test/sidecar` fails after Step 3. A consumer depends on the old one-argument signature.
- The burst test in Step 2 fails with `createWorktree` called twice. The serialization is not working; do not relax the assertion.
- You find yourself adding a database column or editing a file under `apps/`.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- **Not reachable from the UI yet.** The sidecar registers the session methods, but the Rust shell has no commands for them and nothing sends `session.fileModified`. When those are added, wire `onError` in `sessionWiring.ts` to the sidecar's error notification instead of relying on the stderr default.
- **Path comparison.** `removeWorktree` and `isWorktreeHealthy` compare paths as strings with git's output. Git prints resolved paths; if a repository is reached through a symbolic link, the comparison can miss, and a failed removal would again be treated as "already gone".
- **Squash and rebase merges.** `git branch --merged` does not list a branch that was squash-merged or rebased by the hosting service. Those sessions stay "active" or "stale". Detecting them needs the pull-request state, which `sessionCloser.ts` already tracks.
- **Reflog expiry.** Git prunes old reflog entries (90 days by default). A branch older than that with an empty reflog is never marked merged. That is the conservative choice.
- **Session branches are kept.** Deleting a session removes its worktree, not its `joyus/...` branch.
- Reviewer focus: no code path may start `onFileModification` without a `.catch`, and `delete` must not call `softDelete` after a failed removal.
