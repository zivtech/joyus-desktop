# Plan 019: A failed managed-tooling cycle keeps the earlier manifest, so its retry can still sync

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> Every code block in the Steps was copied from a reference implementation
> that was run (see "What was run"). Copy each block exactly. Lines of the
> form `<!-- block: name -->` are labels used to check this plan; ignore them.
>
> **Drift check (run first)**:
> 1. `git merge-base --is-ancestor 3842835 HEAD && echo present` must print `present`. This plan continues plan 013 on its branch. If it prints nothing, STOP.
> 2. `grep -c 'lastManifest = manifest;' apps/desktop-companion/src/sidecar/configCheckWiring.ts` must print `1`.
> 3. `pnpm vitest run apps/desktop-companion/test/sidecar/configCheckWiring.test.ts` must report 57 tests, all passing. If the count differs, STOP.

## Status

- **Priority**: P2 (same as plan 013, which it completes)
- **Effort**: S
- **Risk**: LOW (one statement moves; two tests are added; no existing test changes)
- **Depends on**: plans/013-revocations-always-applied.md, executed (commit `3842835` on branch `fix/013-revocations-always-applied`)
- **Category**: bug
- **Planned at**: commit `3842835`, 2026-11-18. Finding F23 in `plans/README.md`.

## Why this matters

The sidecar polls a manifest of managed hooks and MCP servers. When the manifest changes, a handler syncs skill files and then edits the user's Claude Code settings. Since plan 013, the handler rejects when either half did not finish, and the poller calls it again with the same manifest on its next tick (every five minutes by default).

The skill sync needs a version to fetch. It takes the version of the bundle named by `SKILL_SYNC_BUNDLE` from the new manifest. If the new manifest no longer has that bundle, it falls back to the version in the earlier manifest, which the handler keeps in memory as `lastManifest`.

The handler overwrites `lastManifest` at the end of every cycle, including a cycle that rejects. So when the cycle that drops the configured bundle fails once (git host unreachable, lock file present), the retry compares the new manifest with itself, finds no version, never calls sync again, and stays incomplete forever. Revocations are still applied. Everything the remaining bundles add is never installed.

Measured on commit `3842835`, through the handler and the real reconciler on temp paths: earlier manifest with bundle `core`; new manifest with only bundle `other`, which adds one MCP server; sync offline in the first cycle and working afterward; three cycles. Sync was called once, all three cycles rejected, and the server was never installed. With a working sync in the first cycle, the same manifest installs it.

After this plan, only a cycle that completes replaces the earlier manifest. A retry sees what the first attempt saw.

**What this plan does not change.** Once a cycle *completes* with a manifest that lacks the configured bundle, that manifest becomes the earlier one, and the next manifest change finds no version again. That state is permanent and already recorded as an open product question in `plans/README.md` ("should a missing configured bundle count as nothing to sync?"). This plan does not decide it. See "Maintenance notes".

## Current state

`apps/desktop-companion/src/sidecar/configCheckWiring.ts`, read from commit `3842835`. `lastManifest` appears three times. The declaration and the read (lines 122 and 125):

```ts
  let lastManifest = config.initialManifest;

  return async (manifest: DistributionManifest): Promise<void> => {
    const previousManifest = lastManifest;
```

The end of the handler (lines 204–225). The assignment sits above the check that rejects:

```ts
    try {
      const tenantConfig = aggregateTenantConfigFn(manifest);
      const tenantConfigPath =
        config.tenantConfigPath ?? resolveConfigPathFn(manifest);
      await writeTenantConfigFn(tenantConfig, tenantConfigPath);
    } catch (error: unknown) {
      logger.error(
        `configCheckWiring: tenant config write failed: ${formatError(error)}`,
      );
    }

    lastManifest = manifest;

    if (!syncOk || !reconcileOk) {
      // Rejecting tells the poller this manifest is not finished. The poller
      // keeps the old content hash and calls this handler again next tick.
      throw new Error(
        `configCheckWiring: managed tooling update incomplete (skill sync ${syncOk ? "ok" : "failed"}, reconcile ${reconcileOk ? "ok" : "failed"}); will retry.`,
      );
    }
  };
}
```

`previousManifest` is used in one place, as the fallback for the sync version:

```ts
        targetVersion = resolveSyncTargetVersion(
          manifest,
          previousManifest,
          config.syncConfig.bundleName,
        );
```

`apps/desktop-companion/test/sidecar/configCheckWiring.test.ts` (1,901 lines, 57 tests). `describe("createConfigChangeHandler failure isolation")` ends with the test "keeps retrying when the configured bundle is missing and no earlier manifest is known". The end of that test and of the block, followed by the next block:

```ts
    expect(syncSkillsFn).not.toHaveBeenCalled();
    expect(reconcileFn).toHaveBeenCalledWith(manifest, { removalsOnly: true });
  });
});

describe("resolveSidecarManagedToolingConfigFromEnv", () => {
```

The helper the new tests use already exists in that file:

```ts
function createReconcileResult(
  status: ReconcileResult["status"] = "success",
  registryPath = "/tmp/registry.json",
  error?: string,
): ReconcileResult {
```

Repo conventions: TypeScript strict. Vitest. Coverage must stay at 100% lines, functions, branches and statements. `pnpm typecheck` does not check test files.

### What was run

On 2026-11-18, outside the repository: a copy of `configCheckWiring.ts`, `configCheckPoller.ts` and `configCheckWiring.test.ts` from commit `3842835`, with the workspace packages and `node_modules` of an existing worktree (Vitest 3.2.4).

- Unchanged copy: 57 tests pass.
- The two new tests added, source unchanged: exactly those two fail, both with "promise rejected … instead of resolving". The other 57 pass.
- Source change added: 59 pass. No existing test needed a change.
- One deliberate defect: replace the earlier manifest whenever sync succeeded, even if reconcile did not finish. The second new test fails.

Not run before this plan was written: `pnpm coverage` over the whole repository with the change. Step 3 runs it. The change adds no branch.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Wiring tests | `pnpm vitest run apps/desktop-companion/test/sidecar/configCheckWiring.test.ts` | all pass (57 before this plan, 59 after) |
| Full coverage gate | `pnpm coverage` | exit 0, thresholds met (2,388 tests before this plan, 2,390 after) |

Never run `pnpm ci` (that is clean-install in pnpm).

Run tests only on a branch that contains plan 008 (`git merge-base --is-ancestor 1edaa59 HEAD && echo safe` prints `safe`).

Home-directory safety: both new tests mock `reconcileFn`, so they cannot reach the real reconciler. Before the first test run and after the last, run `ls -l ~/.claude/.joyus-managed.json 2>&1; ls -d ~/.claude/.joyus-reconciler-backups 2>&1`; the two outputs must be identical. Do not set `HOME` on a command if your environment refuses that.

Known flaky tests, unrelated to this plan, on a branch that does not contain `main` commits `76a88f2` and `ff58490`: `apps/desktop-companion/test/ui/SessionsPage.test.ts` ("clears mode note timers…"), `test/ui/components/LocalSiteCard.test.ts`, `test/ui/OnboardingPage.test.ts`, and a coverage gap with all tests passing at `ReconSetup.tsx` lines 336–342 or in the `safeListen` catch in `Sessions.tsx`, `Sites.tsx` or `src/ui/hooks`. If `pnpm coverage` fails only there, rerun it once. If it fails again, treat it as a STOP condition.

## Scope

**In scope** (the only files you should modify):
- `apps/desktop-companion/src/sidecar/configCheckWiring.ts` (the end of the handler only)
- `apps/desktop-companion/test/sidecar/configCheckWiring.test.ts` (two tests added)
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch, even though they look related):
- `resolveTargetVersion` and `resolveSyncTargetVersion`. What counts as "nothing to sync" is an open product question.
- `configCheckPoller.ts`, `main.ts`, `packages/settings-reconciler`, `packages/skill-sync`.
- The existing test "keeps retrying when the configured bundle is missing and no earlier manifest is known". It pins the state this plan does not change.

## Git workflow

- Branch: stay on `fix/013-revocations-always-applied`. Do not create a branch.
- One commit: `fix: keep the earlier manifest until a managed-tooling cycle completes`. Conventional commits, matching `git log`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the two tests first

In `apps/desktop-companion/test/sidecar/configCheckWiring.test.ts`, at the end of `describe("createConfigChangeHandler failure isolation")`: directly after the closing `  });` of the test "keeps retrying when the configured bundle is missing and no earlier manifest is known", and before the `});` that closes the block, add a blank line and then:

<!-- block: tests -->

```ts
  it("retries the sync with the earlier version after a failed sync in the cycle that dropped the configured bundle", async () => {
    const reconcileFn = vi.fn().mockResolvedValue(createReconcileResult());
    const syncSkillsFn = vi
      .fn()
      .mockResolvedValueOnce({
        status: "offline",
        filesUpdated: 0,
        metadataPath: "/tmp/meta.json",
        version: "v1.0.0",
        noop: true,
      })
      .mockResolvedValueOnce({
        status: "success",
        filesUpdated: 0,
        metadataPath: "/tmp/meta.json",
        version: "v1.0.0",
        noop: true,
      });
    const handler = createConfigChangeHandler({
      syncConfig: {
        repoUrl: "file:///repo.git",
        bundleName: "core",
        destDir: "/tmp/skills",
        cacheDir: "/tmp/cache",
      },
      initialManifest: {
        schema_version: "1.0",
        tenant_id: "tenant-1",
        bundles: { core: { version: "v1.0.0" } },
      },
      tenantConfigPath: "/tmp/tenant-config.json",
      syncSkillsFn,
      reconcileFn,
      writeTenantConfigFn: vi.fn().mockResolvedValue(undefined),
    });
    // The new manifest drops the configured bundle and keeps another one.
    const manifest = {
      schema_version: "1.0",
      tenant_id: "tenant-1",
      bundles: { other: { version: "v2.0.0" } },
    };

    // First cycle: sync is offline, so removals only, and the handler rejects.
    await expect(handler(manifest)).rejects.toThrow(
      "managed tooling update incomplete (skill sync failed, reconcile ok)",
    );
    // The poller calls again with the same manifest. The earlier manifest is
    // still the one that had the configured bundle, so sync is tried again.
    await expect(handler(manifest)).resolves.toBeUndefined();

    expect(syncSkillsFn).toHaveBeenCalledTimes(2);
    expect(syncSkillsFn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ targetVersion: "v1.0.0" }),
    );
    expect(reconcileFn).toHaveBeenNthCalledWith(1, manifest, { removalsOnly: true });
    expect(reconcileFn).toHaveBeenNthCalledWith(2, manifest, undefined);
  });

  it("keeps the earlier manifest when sync worked but reconcile did not finish", async () => {
    const reconcileFn = vi
      .fn()
      .mockResolvedValueOnce(createReconcileResult("rolled_back", "/tmp/registry.json", "disk full"))
      .mockResolvedValueOnce(createReconcileResult());
    const syncSkillsFn = vi.fn().mockResolvedValue({
      status: "success",
      filesUpdated: 0,
      metadataPath: "/tmp/meta.json",
      version: "v1.0.0",
      noop: true,
    });
    const handler = createConfigChangeHandler({
      syncConfig: {
        repoUrl: "file:///repo.git",
        bundleName: "core",
        destDir: "/tmp/skills",
        cacheDir: "/tmp/cache",
      },
      initialManifest: {
        schema_version: "1.0",
        tenant_id: "tenant-1",
        bundles: { core: { version: "v1.0.0" } },
      },
      tenantConfigPath: "/tmp/tenant-config.json",
      syncSkillsFn,
      reconcileFn,
      writeTenantConfigFn: vi.fn().mockResolvedValue(undefined),
    });
    const manifest = {
      schema_version: "1.0",
      tenant_id: "tenant-1",
      bundles: { other: { version: "v2.0.0" } },
    };

    await expect(handler(manifest)).rejects.toThrow(
      "managed tooling update incomplete (skill sync ok, reconcile failed)",
    );
    await expect(handler(manifest)).resolves.toBeUndefined();

    // Both cycles could still resolve the version from the earlier manifest.
    expect(syncSkillsFn).toHaveBeenCalledTimes(2);
    expect(syncSkillsFn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ targetVersion: "v1.0.0" }),
    );
    expect(reconcileFn).toHaveBeenNthCalledWith(2, manifest, undefined);
  });
```

**Verify**: `pnpm vitest run apps/desktop-companion/test/sidecar/configCheckWiring.test.ts` → **exactly these two tests fail** (2 failed, 57 passed), each because the second `handler(manifest)` call rejects. If any other test fails, or if either new test passes, STOP.

### Step 2: Replace the earlier manifest only when the cycle completes

In `apps/desktop-companion/src/sidecar/configCheckWiring.ts`, replace the end of the handler. The replacement starts at the line `    lastManifest = manifest;` and ends at the line `  };` that closes the returned function (the line directly above the final `}` of `createConfigChangeHandler`). Both lines are part of what is replaced. Put this in their place:

<!-- block: src-tail -->

```ts
    if (!syncOk || !reconcileOk) {
      // Rejecting tells the poller this manifest is not finished. The poller
      // keeps the old content hash and calls this handler again next tick.
      throw new Error(
        `configCheckWiring: managed tooling update incomplete (skill sync ${syncOk ? "ok" : "failed"}, reconcile ${reconcileOk ? "ok" : "failed"}); will retry.`,
      );
    }

    // Only a finished cycle replaces the earlier manifest. A retry must see
    // the same earlier manifest as the first attempt: it is the only source
    // of a sync version when the new manifest dropped the configured bundle.
    lastManifest = manifest;
  };
```

The only change is where `lastManifest = manifest;` stands: below the check that rejects, with a comment. The `if` block is unchanged. The blank line that stood between the old assignment and the `if` goes away with the old assignment, so the `if` follows the tenant-config `try` block after one blank line.

**Verify**: `pnpm typecheck` → exit 0. `pnpm vitest run apps/desktop-companion/test/sidecar/configCheckWiring.test.ts` → 59 pass. `git diff --stat` lists exactly the two in-scope files.

### Step 3: Run the full gates and commit

Run `pnpm typecheck`, then `pnpm coverage`.

**Verify**: both exit 0; the coverage summary's "All files" line shows 100 in all four columns. Then commit both files in one commit with the message from "Git workflow".

## Test plan

- Two new tests in `describe("createConfigChangeHandler failure isolation")`: a failed sync in the cycle that drops the configured bundle is retried with the earlier version and then completes; a cycle whose sync worked and whose reconcile did not finish keeps the earlier manifest too.
- No existing test changes.
- Verification: the wiring test file reports 59 tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm vitest run apps/desktop-companion/test/sidecar/configCheckWiring.test.ts` exits 0 with 59 tests
- [ ] `pnpm coverage` exits 0
- [ ] `grep -c 'lastManifest = manifest;' apps/desktop-companion/src/sidecar/configCheckWiring.ts` prints 1
- [ ] `grep -A1 'of a sync version when the new manifest dropped the configured bundle' apps/desktop-companion/src/sidecar/configCheckWiring.ts | grep -c 'lastManifest = manifest;'` prints 1
- [ ] `git diff --stat 3842835 HEAD` lists exactly `configCheckWiring.ts` and `configCheckWiring.test.ts`
- [ ] `git status --short` prints nothing after the commit
- [ ] `plans/README.md` status row for 019 updated

## STOP conditions

Stop and report back (do not improvise) if:

- A drift check fails.
- After Step 1, the set of failing tests is anything other than the two new tests.
- After Step 2, any test in the wiring test file fails. The reference run needed no change to an existing test.
- `pnpm coverage` reports an uncovered line or branch in `configCheckWiring.ts`. Do not add a `v8 ignore` comment.
- A test outside `configCheckWiring.test.ts` fails, other than the known flaky ones after one rerun.
- You find yourself changing `resolveTargetVersion`, `resolveSyncTargetVersion` or any file outside the scope.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- **The earlier manifest now means "the last manifest whose cycle completed".** If a manifest never completes and the manifest then changes again, the fallback still comes from the last completed one.
- **The stuck state remains after a completed cycle.** Measured on `3842835` with a sync that always works: earlier manifest with `core`; a first new manifest with only `other` completes and installs its server; a second new manifest with only `other`, listing a different server, finds no version, runs removals only, removes the first server and never installs the second. Every later cycle rejects. The same happens right after a restart, when no earlier manifest is in memory. `plans/README.md` records the product question: whether a missing configured bundle should count as "nothing to sync". If the answer is yes, the fallback to the earlier manifest, and with it this plan's change, can be removed.
- **Tenant config write failures do not make a cycle incomplete.** Unchanged by this plan.
- Reviewer focus: `lastManifest` must not be assigned on any path that throws.
