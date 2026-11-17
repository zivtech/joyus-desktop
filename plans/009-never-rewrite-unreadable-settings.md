# Plan 009: The settings reconciler never rewrites a settings file it could not read

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat cea62f6..HEAD -- packages/settings-reconciler/src/settingsFile.ts packages/settings-reconciler/src/reconciler.ts packages/settings-reconciler/test/settingsFile.test.ts packages/settings-reconciler/test/reconciler.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/007-correct-agent-and-contributor-docs.md, plans/008-make-recon-tests-hermetic.md (008 must land first because this plan runs the full test suite, which deletes a real user folder until 008 is in)
- **Category**: bug
- **Planned at**: commit `cea62f6`, 2026-11-17

## Why this matters

The settings reconciler installs managed hooks and MCP servers into the user's `~/.claude/settings.json`. When that file exists but cannot be parsed, the reader returns an empty object, exactly as if the file were missing. The reconciler then merges the managed entries into that empty object and writes the result back. The user's permissions (including deny rules), environment variables, model choice and their own hooks are gone, and the reconcile result says `success`.

A parse failure is not exotic. A hand-edit typo causes one. So does reading the file while another program is halfway through writing it.

A backup is taken before the write, but only five are kept, and nothing tells the user that anything went wrong. After this plan, a settings file that exists but cannot be read is left byte-for-byte untouched, and the reconcile result carries an error.

## Current state

Files:

- `packages/settings-reconciler/src/settingsFile.ts` — reads, writes, backs up and restores settings files.
- `packages/settings-reconciler/src/reconciler.ts` — `reconcile()` and its helper `reconcileSettingsTarget()`.
- `packages/settings-reconciler/src/index.ts` — has `export * from "./settingsFile";`, so anything exported from `settingsFile.ts` is public automatically. Do not edit it.
- `packages/settings-reconciler/test/settingsFile.test.ts` and `test/reconciler.test.ts` — existing tests; you will add to both.

The lenient reader (complete function):

```ts
// packages/settings-reconciler/src/settingsFile.ts:4-27
export async function readSettingsFile(path: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(path, "utf8");
    if (raw.trim() === "") {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return {};
    }
    // Corrupted JSON or other read errors
    return {};
  }
}
```

It has two callers, both in `reconciler.ts`:

```ts
// reconciler.ts:293  — inside the registry-repair helper. READ-ONLY use. Leave it lenient.
  const projectSettings = await readSettingsFile(projectSettingsPath);

// reconciler.ts:407-430  — the write path. THE DEFECT.
async function reconcileSettingsTarget(options: {
  settingsPath: string;
  backupDir: string;
  maxBackups: number;
  now: () => Date;
  hooks: readonly ManifestHook[];
  mcps: readonly ManifestMcpServer[];
}): Promise<SettingsUpdateResult> {
  const currentSettings = await readSettingsFile(options.settingsPath);
  // ... merge managed hooks and MCP servers ...
  const nextSettings: Record<string, unknown> = { ...currentSettings };

// reconciler.ts:460-467
  const backupPath = await createSettingsBackup(
    options.settingsPath,
    options.backupDir,
    options.maxBackups,
    options.now
  );

  await writeSettingsFile(options.settingsPath, nextSettings);
```

`reconcile()` already turns any thrown error into a `rolled_back` result and restores anything it changed (`reconciler.ts:541-600`):

```ts
  try {
    globalUpdate = await reconcileSettingsTarget({ settingsPath: globalSettingsPath, /* ... */ });
    projectUpdate = await reconcileSettingsTarget({ settingsPath: projectSettingsPath, /* ... */ });
    // ... writeRegistry ...
    return withOptionalBackupPath({ status: "success", /* ... */ }, /* ... */);
  } catch (error) {
    try { await rollbackReconciledSettings(globalSettingsPath, globalUpdate); } catch { /* best-effort */ }
    try { await rollbackReconciledSettings(projectSettingsPath, projectUpdate); } catch { /* best-effort */ }
    return withOptionalBackupPath({
      status: "rolled_back",
      entriesAdded: 0, entriesUpdated: 0, entriesRemoved: 0,
      registryPath,
      error: error instanceof Error ? error.message : String(error),
    }, globalUpdate.backupPath ?? projectUpdate.backupPath);
  }
```

So the fix is small: make the write path throw when the file exists but is unreadable. The existing `catch` does the rest.

Existing tests that pin the lenient behavior, and must keep passing unchanged:

```ts
// packages/settings-reconciler/test/settingsFile.test.ts:50-55
  it("returns {} for corrupted JSON", async () => {
    const path = join(tmpDir, "corrupt.json");
    await writeFile(path, "{ invalid json {{");
    const result = await readSettingsFile(path);
    expect(result).toEqual({});
  });
```

Test helpers already defined in `test/reconciler.test.ts` that you will reuse: `createWorkspace()` (returns `globalSettingsPath`, `projectSettingsPath`, `registryPath`, `backupDir`, `now` under a temp dir that is removed in `afterEach`), `writeJson(path, value)`, `readJson(path)`, `createHook(overrides)`, `createMcp(overrides)`, `createManifest({ hooks, mcps })`, `createConfig(workspace)`. `createMcp({ target: "project" })` routes an MCP entry to the project settings file. The structural pattern to copy is the test at line 762, "rolls back global and project settings if registry persistence fails".

Repo conventions: TypeScript strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Relative imports inside this package use the `.js` suffix in `reconciler.ts` (for example `from "./settingsFile.js"`). Error handling in this package checks `error.code === "ENOENT"` with the long-form guard shown above; match it. Coverage must stay at 100% lines, functions, branches and statements.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Package tests | `pnpm vitest run packages/settings-reconciler` | all pass |
| Full coverage gate | `pnpm coverage` | exit 0, thresholds met |

Never run `pnpm ci` (that is clean-install in pnpm). The full pipeline is `pnpm run ci`.

Known flaky tests, unrelated to this plan: `apps/desktop-companion/test/ui/SessionsPage.test.ts` ("clears mode note timers…"), `apps/desktop-companion/test/ui/components/LocalSiteCard.test.ts`, and a timing-dependent coverage gap in `ReconSetup.tsx`. If `pnpm coverage` fails only in one of those, rerun it once. If it fails again, treat it as a STOP condition.

## Scope

**In scope** (the only files you should modify):
- `packages/settings-reconciler/src/settingsFile.ts`
- `packages/settings-reconciler/src/reconciler.ts` (one import and one call)
- `packages/settings-reconciler/test/settingsFile.test.ts`
- `packages/settings-reconciler/test/reconciler.test.ts`
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch, even though they look related):
- `readSettingsFile` itself — keep its behavior and its tests exactly as they are. The registry-repair caller at `reconciler.ts:293` relies on it and only reads.
- `packages/settings-reconciler/src/registry.ts` and `test/registry.test.ts` — the test "returns empty registry for corrupted settings file" is correct for a read-only repair.
- Hook ownership and removal logic (`mergeHooks`, `removeStaleHooks`, `buildActiveHookIds`) — a separate plan covers it.
- `apps/desktop-companion/src/sidecar/configCheckWiring.ts` — it already logs `rolled_back` results with their error text.
- The `ReconcileStatus` type — do not add or rename statuses.

## Git workflow

- Branch: `fix/009-unreadable-settings`
- One commit: `fix: leave unreadable settings files untouched during reconcile`. Conventional commits, matching `git log` (example: `fix: harden desktop security and CI gates`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a strict reader next to the lenient one

In `packages/settings-reconciler/src/settingsFile.ts`, directly below `readSettingsFile`, add:

```ts
export class SettingsFileUnreadableError extends Error {
  readonly settingsPath: string;

  constructor(settingsPath: string, reason: string) {
    super(`Settings file exists but could not be read (${reason}): ${settingsPath}`);
    this.name = "SettingsFileUnreadableError";
    this.settingsPath = settingsPath;
  }
}

/**
 * Like readSettingsFile, but for callers that will write the file back.
 * A missing, empty or whitespace-only file yields {}. A file that exists and
 * cannot be read as a JSON object throws, so the caller cannot overwrite
 * content it never saw.
 */
export async function readSettingsFileStrict(path: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return {};
    }
    throw new SettingsFileUnreadableError(path, "read failed");
  }

  if (raw.trim() === "") {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SettingsFileUnreadableError(path, "not valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new SettingsFileUnreadableError(path, "not a JSON object");
  }

  return parsed as Record<string, unknown>;
}
```

The error message must contain the path and the reason only. Never include file content in it: settings files can hold tokens in their `env` block.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Use the strict reader on the write path

In `packages/settings-reconciler/src/reconciler.ts`:

1. Add `readSettingsFileStrict` to the existing import from `"./settingsFile.js"` (lines 14–19). Keep `readSettingsFile` in that import; line 293 still uses it.
2. In `reconcileSettingsTarget` (line 415), change `await readSettingsFile(options.settingsPath)` to `await readSettingsFileStrict(options.settingsPath)`.

Change nothing else.

**Verify**: `pnpm typecheck` → exit 0. `grep -c 'readSettingsFileStrict' packages/settings-reconciler/src/reconciler.ts` → 2. `grep -c 'readSettingsFile(' packages/settings-reconciler/src/reconciler.ts` → 1.

### Step 3: Test the strict reader

In `packages/settings-reconciler/test/settingsFile.test.ts`, add `readSettingsFileStrict` and `SettingsFileUnreadableError` to the import from `"../src/index"`, then add a new `describe("readSettingsFileStrict", ...)` block after the existing `describe("readSettingsFile", ...)` block. It uses the same `tmpDir` set up at the top of the file. Write these seven tests:

1. returns the parsed object for a valid JSON object file.
2. returns `{}` for a missing file.
3. returns `{}` for an empty file.
4. returns `{}` for a whitespace-only file (`"   \n  "`).
5. rejects with `SettingsFileUnreadableError` for corrupted JSON (`"{ invalid json {{"`). Assert `error.settingsPath` equals the path, `error.message` contains `"not valid JSON"`, and `error.message` does NOT contain `"invalid json {{"`.
6. rejects with `SettingsFileUnreadableError` whose message contains `"not a JSON object"` for a file holding `[1, 2, 3]`.
7. rejects with `SettingsFileUnreadableError` whose message contains `"read failed"` when the path is a directory (create it with `mkdir(path)`; reading a directory fails with a non-ENOENT error).

Do not change or delete any existing test in this file.

**Verify**: `pnpm vitest run packages/settings-reconciler/test/settingsFile.test.ts` → all pass, 7 more tests than before.

### Step 4: Test that reconcile leaves an unreadable file alone

In `packages/settings-reconciler/test/reconciler.test.ts`, add two tests next to the one at line 762 ("rolls back global and project settings if registry persistence fails"), using the same helpers:

**Test A — "does not write a global settings file that is not valid JSON"**

- `const workspace = await createWorkspace();`
- Create the directory and write the exact string `'{ "permissions": { "deny": ["Bash(rm:*)"] }, '` (deliberately truncated JSON) to `workspace.globalSettingsPath` with `mkdir(dirname(path), { recursive: true })` then `writeFile`.
- Call `reconcile(createManifest({ hooks: [createHook()] }), createConfig(workspace))`.
- Assert `result.status` is `"rolled_back"`.
- Assert `result.error` contains `"not valid JSON"` and contains `workspace.globalSettingsPath`.
- Assert `await readFile(workspace.globalSettingsPath, "utf8")` equals the exact string written.
- Assert no backup was made: `await expect(readdir(join(workspace.backupDir, "global"))).rejects.toMatchObject({ code: "ENOENT" })` (add `readdir` to the `node:fs/promises` import).
- Assert the registry was not written: `await expect(readFile(workspace.registryPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" })`.

**Test B — "restores global settings when the project settings file is not valid JSON"**

- `const workspace = await createWorkspace();`
- `const originalGlobal = { model: "example-model", hooks: {} };` and `await writeJson(workspace.globalSettingsPath, originalGlobal);`
- Write the string `"{ broken"` to `workspace.projectSettingsPath` (create its directory first).
- Call `reconcile(createManifest({ hooks: [createHook()], mcps: [createMcp({ id: "joyus:project-mcp", target: "project" })] }), createConfig(workspace))`.
- Assert `result.status` is `"rolled_back"` and `result.error` contains `workspace.projectSettingsPath`.
- Assert `await readJson(workspace.globalSettingsPath)` equals `originalGlobal`.
- Assert `await readFile(workspace.projectSettingsPath, "utf8")` equals `"{ broken"`.

**Verify**: `pnpm vitest run packages/settings-reconciler` → all pass.

### Step 5: Run the full gates

Run `pnpm typecheck`, then `pnpm coverage`.

**Verify**: both exit 0. In the coverage table, `settingsFile.ts` and `reconciler.ts` show 100% in all four columns.

## Test plan

- 7 new tests for `readSettingsFileStrict` in `test/settingsFile.test.ts` (listed in Step 3). They cover every branch of the new function.
- 2 new tests in `test/reconciler.test.ts` (Step 4): Test A is the regression test for the data-loss defect; Test B proves an earlier, successful write is undone when a later file is unreadable.
- Pattern to follow: the test at `test/reconciler.test.ts:762`.
- Verification: `pnpm vitest run packages/settings-reconciler` → all pass, 9 new tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm vitest run packages/settings-reconciler` exits 0
- [ ] `pnpm coverage` exits 0
- [ ] `grep -c 'readSettingsFileStrict' packages/settings-reconciler/src/reconciler.ts` prints 2
- [ ] `grep -c 'returns {} for corrupted JSON' packages/settings-reconciler/test/settingsFile.test.ts` prints 1 (the existing lenient test is still there)
- [ ] `git status --short` lists only the four in-scope source and test files and `plans/README.md`
- [ ] `plans/README.md` status row for 009 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" does not match the excerpts.
- An existing test in `packages/settings-reconciler/test/` fails after Step 2. That would mean some existing test depends on reconcile overwriting a corrupted file. Report the test name; do not edit or delete it.
- Test A cannot be made to pass without changing the `catch` block in `reconcile()`.
- You find a third caller of `readSettingsFile` that writes the result back to disk.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Status naming: an unreadable global file produces `rolled_back` even though nothing was written, because the existing `catch` in `reconcile()` handles every failure the same way. The `error` text is what distinguishes it. A dedicated status would touch `ReconcileStatus` and its consumer in `configCheckWiring.ts`; that was left out to keep this change minimal.
- Empty files: an empty or whitespace-only settings file is still treated as `{}` and will be written. That matches existing tests. It leaves one narrow race open: a reader that catches another program between truncating the file and writing it. If that proves real, treat an existing zero-length file as unreadable too.
- The reconciler still has no user-visible signal. A `rolled_back` result is only logged to the sidecar's stderr. Surfacing it in the desktop UI is a separate piece of work.
- Reviewer focus: confirm the error message cannot contain file content, and that `reconciler.ts:293` still uses the lenient reader.
- Interaction: a later plan changes how hook ownership is tracked in `reconciler.ts`. It must keep `reconcileSettingsTarget` on the strict reader.
