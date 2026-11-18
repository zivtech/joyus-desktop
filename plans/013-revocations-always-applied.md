# Plan 013: A revocation is applied even when skill sync fails, and an unfinished update is retried

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
> **Read Step 1 before running any test.** Two existing tests build the real
> handler with reconcile paths that point at your real `~/.claude` folder.
> They are harmless today only because a failed sync skips reconcile. Step 1
> fixes them first.
>
> **Drift check (run first)**:
> 1. `git merge-base --is-ancestor ec00055 HEAD && echo present` must print `present`. This plan was written against `origin/main` commit `ec00055`, which added token handling to the files below. If it prints nothing, STOP: update the branch first.
> 2. `git diff --stat ec00055 -- apps/desktop-companion/src/sidecar/configCheckWiring.ts apps/desktop-companion/src/sidecar/configCheckPoller.ts apps/desktop-companion/src/sidecar/main.ts apps/desktop-companion/test/sidecar/configCheckWiring.test.ts apps/desktop-companion/test/sidecar/mainConfigCheckWiring.test.ts` must print nothing. If it lists a file, compare the "Current state" excerpts against the live code; on a mismatch, treat it as a STOP condition.
> 3. Plan 012 must have landed exactly as its second revision is written: `grep -c 'locateWrittenEntry' packages/settings-reconciler/src/reconciler.ts` prints `3`, and `pnpm vitest run packages/settings-reconciler` reports 157 tests. If either differs, STOP. Pull request 13 as first opened holds the first revision of plan 012 and does not pass this check.

## Status

- **Priority**: P2 (the code is wired into the sidecar but only runs when `JOYUS_MANAGED_TOOLING_MANIFEST_URL` and `SKILL_SYNC_REPO_URL` are set)
- **Effort**: M
- **Risk**: MED (rewrites the control flow of one function and eleven of its tests)
- **Depends on**: plans/007, plans/008, plans/009, plans/012-managed-hooks-with-real-matchers.md (its second revision of 2026-11-18)
- **Category**: bug, security
- **Planned at**: commit `ec00055` (`origin/main`), 2026-11-17
- **Revised**: 2026-11-18, against plan 012's reference result on top of commit `363bb14`, after the outside review recorded in `plans/README.md`. What changed:
  1. Removals-only mode is rebuilt. It removes only what the registry records as installed under an id the manifest no longer lists. An id that is still listed keeps everything installed under it, whatever the manifest now says about its target, matcher, event or command (review finding 2). The first version computed removals from the manifest's per-target ids and matchers, which removed still-authorized entries.
  2. A new first step makes two existing tests safe before the handler changes. One of them, in `mainConfigCheckWiring.test.ts`, was not in the first version at all: it runs the real handler with a registry path in the real home directory.
  3. `resolveTargetVersion` loses a branch that the new handler can no longer reach, and two tests cover the fallback to the earlier manifest. Without these the coverage gate fails at 98.3% for `configCheckWiring.ts`.
  4. The edits to the existing wiring tests are now a table of exact edits, not rules to interpret.
  The code in the Steps was run against the existing tests of both packages before this revision was published. See "What was run".
- **Revised again**: 2026-11-18, on top of plan 012's second revision, after an independent replay found four open items (items 6–9 under "Independent replay of the revised plans" in `plans/README.md`). What changed:
  1. **Each settings file is handled on its own in removals-only mode** (item 6, decided by the maintainer). A file that cannot be read or written no longer holds back a revocation in the other file. The result is then `error`, the handler rejects, and the cycle is retried. A file with nothing to remove is not opened.
  2. Every "replace this function" step names where the replacement starts and where it ends (item 7).
  3. The home-directory safety check has a form that does not change `HOME` (item 8).
  4. The plan states the risk of an empty manifest (item 9, decided by the maintainer: keep the behavior).
  5. Removals use plan 012's new way of finding the tool's own entry, so a copy of a revoked command that the user added is left alone.

## Why this matters

The sidecar polls a remote manifest that lists the hooks and MCP servers an organization manages on this machine. When the manifest changes, a handler (1) syncs skill files from a git repository, then (2) "reconciles": it edits the user's Claude Code `settings.json` to add, update and remove managed entries. Removing an entry that the manifest dropped is a **revocation**. It is how an organization withdraws a hook or MCP server, for example one found to be harmful.

Today the handler skips step 2 whenever step 1 does not succeed:

- If skill sync returns anything other than `success` or `offline` (for example `locked`), or throws, reconcile is skipped, even when the manifest revokes entries.
- If skill sync is `offline`, reconcile runs only when a revocation is detected by comparing with the previous manifest. That previous manifest is held in memory. After a restart there is none, so the comparison finds nothing unless the new manifest is completely empty.
- The handler never throws. The poller therefore records the manifest as handled, and does not call the handler again until the manifest content changes. A skipped revocation is never retried. A skipped installation is never retried either.

So a revocation that arrives while the git host is unreachable, or while a stale lock file exists, is silently lost.

Removing an entry never needs the skill files. Only adding or updating does, because a new hook's command may point at a script that sync has not delivered yet.

After this plan: every cycle applies removals, to each settings file on its own. Additions, updates and moves are applied only after a successful sync. If either part did not complete, the handler rejects, and the poller, which already supports this, retries on its next tick.

**What "removal" means here, and what it does not.** In a cycle where sync did not succeed, the reconciler removes an installed entry only if the registry recorded it and its id is gone from the manifest. It does not move, update or replace anything. In particular, if the manifest keeps an id and changes its command, the old command stays installed until a sync succeeds. An organization that needs a command gone at once must drop the id.

## Current state

### The handler

`apps/desktop-companion/src/sidecar/configCheckWiring.ts` (448 lines), read from commit `363bb14` on 2026-11-18; the file is unchanged since `ec00055`. Helper functions near the top (lines 59–141):

```ts
function getBundleNames(manifest: DistributionManifest): string[] {
  return Object.keys(manifest.bundles).sort();
}

function getManagedEntryIds(manifest: DistributionManifest): Set<string> {
  const ids = new Set<string>();

  for (const bundle of Object.values(manifest.bundles)) {
    for (const hook of bundle.hooks ?? []) {
      ids.add(`hook:${hook.event}:${hook.matcher}`);
    }

    for (const server of bundle.mcpServers ?? []) {
      ids.add(`mcp:${server.id}`);
    }
  }

  return ids;
}

function hasRevocation(
  previousManifest: DistributionManifest | undefined,
  nextManifest: DistributionManifest,
): boolean {
  if (getBundleNames(nextManifest).length === 0) {
    return true;
  }

  if (previousManifest === undefined) {
    return false;
  }

  const nextBundles = new Set(getBundleNames(nextManifest));
  for (const bundleName of getBundleNames(previousManifest)) {
    if (!nextBundles.has(bundleName)) {
      return true;
    }
  }

  const nextEntries = getManagedEntryIds(nextManifest);
  for (const entryId of getManagedEntryIds(previousManifest)) {
    if (!nextEntries.has(entryId)) {
      return true;
    }
  }

  return false;
}

function resolveTargetVersion(
  manifest: DistributionManifest,
  bundleName?: string,
): string | undefined {
  if (bundleName !== undefined) {
    return manifest.bundles[bundleName]?.version;
  }

  const versions = [...new Set(Object.values(manifest.bundles).map((bundle) => bundle.version))];
  if (versions.length === 0) {
    return undefined;
  }

  if (versions.length === 1) {
    return versions[0];
  }

  throw new Error(
    "Unable to resolve skill-sync target version from manifest with multiple bundle versions; configure bundleName explicitly.",
  );
}

function resolveSyncTargetVersion(
  manifest: DistributionManifest,
  previousManifest: DistributionManifest | undefined,
  bundleName?: string,
): string | undefined {
  return (
    resolveTargetVersion(manifest, bundleName) ??
    (previousManifest !== undefined
      ? resolveTargetVersion(previousManifest, bundleName)
      : undefined)
  );
}
```

The handler body, inside `createConfigChangeHandler` (lines 170–262):

```ts
  let lastManifest = config.initialManifest;

  return async (manifest: DistributionManifest): Promise<void> => {
    const previousManifest = lastManifest;
    const shouldReconcileForRevocation = hasRevocation(
      previousManifest,
      manifest,
    );

    let shouldAttemptReconcile = true;
    let targetVersion: string | undefined;

    try {
      targetVersion = resolveSyncTargetVersion(
        manifest,
        previousManifest,
        config.syncConfig.bundleName,
      );
    } catch (error: unknown) {
      logger.error(
        `configCheckWiring: ${formatError(error)}`,
      );
      shouldAttemptReconcile = shouldReconcileForRevocation;
    }

    if (targetVersion === undefined) {
      logger.warn(
        "configCheckWiring: skipping skill sync because no target version could be resolved.",
      );
      shouldAttemptReconcile = shouldReconcileForRevocation;
    } else {
      try {
        const syncResult = await syncSkillsFn({
          ...config.syncConfig,
          targetVersion,
        });

        if (syncResult.status === "offline") {
          logger.warn(
            `configCheckWiring: skill sync is offline for ${targetVersion}.`,
          );
          shouldAttemptReconcile = shouldReconcileForRevocation;
        } else if (syncResult.status !== "success") {
          logger.error(
            `configCheckWiring: skill sync returned ${syncResult.status}.`,
          );
          shouldAttemptReconcile = false;
        }
      } catch (error: unknown) {
        logger.error(
          `configCheckWiring: skill sync failed: ${formatError(error)}`,
        );
        shouldAttemptReconcile = false;
      }
    }

    if (shouldAttemptReconcile) {
      try {
        const reconcileResult = await reconcileFn(
          manifest,
          config.reconcileConfig,
        );

        if (reconcileResult.status === "rolled_back") {
          logger.error(
            `configCheckWiring: reconcile rolled back: ${reconcileResult.error ?? "unknown error"}`,
          );
        } else if (reconcileResult.status === "error") {
          logger.error(
            `configCheckWiring: reconcile failed: ${reconcileResult.error ?? "unknown error"}`,
          );
        }
      } catch (error: unknown) {
        logger.error(
          `configCheckWiring: reconcile threw: ${formatError(error)}`,
        );
      }
    }

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
  };
```

`reconcileFn` defaults to the real `reconcile` from `@joyus/settings-reconciler`, and `config.reconcileConfig` is optional. With no config, the real `reconcile` edits `~/.claude/settings.json`, `.claude/settings.json` in the current directory, and `~/.claude/.joyus-managed.json`.

### How the sidecar builds the handler

`apps/desktop-companion/src/sidecar/main.ts` (lines 101–122) passes only `syncConfig`, `reconcileConfig`, `tenantConfigPath` and a logger. A test that goes through `startSidecar` therefore cannot inject a mock `reconcileFn`; it can only choose the paths:

```ts
          onSync: createConfigChangeHandler({
            syncConfig: managedToolingConfig.syncConfig,
            ...(
              managedToolingConfig.reconcileConfig !== undefined
                ? { reconcileConfig: managedToolingConfig.reconcileConfig }
                : {}
            ),
            ...(
              managedToolingConfig.tenantConfigPath !== undefined
                ? { tenantConfigPath: managedToolingConfig.tenantConfigPath }
                : {}
            ),
            logger: {
              error: (message: string) => {
                deps.stderr.write(message + "\n");
              },
              warn: (message: string) => {
                deps.stderr.write(message + "\n");
              },
            },
          }),
          onPollError: (error: Error) => {
```

### The poller already retries when the handler rejects

`apps/desktop-companion/src/sidecar/configCheckPoller.ts`, inside `tick()`. The content hash is stored only after the handler resolves:

```ts
      try {
        await config.onChangeDetected(manifest);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        state.consecutiveFailures++;
        config.onPollError?.(error);
        return;
      }

      state.lastVersionHash = newHash;
      state.lastChangeAt = nowFn().toISOString();
      state.consecutiveFailures = 0;
```

The default interval is 300,000 ms (5 minutes). Do not change the poller.

### The reconciler (after plan 012)

`packages/settings-reconciler/src/reconciler.ts`, as plan 012 leaves it. The config type:

```ts
export interface ReconcileConfig {
  readonly globalSettingsPath?: string;
  readonly projectSettingsPath?: string;
  readonly registryPath?: string;
  readonly backupDir?: string;
  readonly maxBackups?: number;
  readonly now?: () => Date;
}
```

`removeStaleHooks`. The helper it calls, `filterHookGroups`, is what Step 2 reuses for removals-only mode:

```ts
export function removeStaleHooks(
  currentHooks: Record<string, unknown[]>,
  activeHooks: readonly ManifestHook[],
  ownedHooks: readonly OwnedHook[] = []
): Record<string, unknown[]> {
  // A legacy group stays only while the manifest lists it under the same event.
  const activeGroups = new Set(activeHooks.map((hook) => groupKey(hook.event, hook.matcher)));
  const activeKeys = new Set(
    activeHooks.map((hook) => hookKey(hook.event, hook.matcher, hook.command))
  );
  const staleOwned = ownedHooks.filter(
    (owned) => !activeKeys.has(hookKey(owned.event, owned.matcher, owned.command))
  );

  return filterHookGroups(
    currentHooks,
    (event, matcher) => !activeGroups.has(groupKey(event, matcher)),
    staleOwned
  );
}
```

`reconcileSettingsTarget` takes the manifest's hooks and servers for one settings file and decides what the file should hold:

```ts
async function reconcileSettingsTarget(options: {
  settingsPath: string;
  backupDir: string;
  maxBackups: number;
  now: () => Date;
  hooks: readonly ManifestHook[];
  mcps: readonly ManifestMcpServer[];
  ownedHooks: readonly OwnedHook[];
}): Promise<SettingsUpdateResult> {
  const currentSettings = await readSettingsFileStrict(options.settingsPath);
  const currentHooksValue = currentSettings["hooks"];
  const currentMcpValue = currentSettings["mcpServers"];
  const currentHooks = normalizeHooksRecord(currentHooksValue);
  const currentMcpServers = normalizeMcpRecord(currentMcpValue);

  const hookPlan = planHookMerge(currentHooks, options.hooks, options.ownedHooks);
  const userOwnedHookKeys = hookPlan.userOwned.map(hookRegistryKey);
  const nextHooks = removeStaleHooks(hookPlan.hooks, options.hooks, options.ownedHooks);
  const nextMcpServers = removeStaleMcpServers(
    mergeMcpServers(currentMcpServers, options.mcps),
    buildActiveMcpIds(options.mcps)
  );
  // ... builds the next settings object, backs the file up and writes it
```

And the middle of `reconcile()`:

```ts
  try {
    // Inside the try: a failure while rebuilding a lost registry must end in
    // "rolled_back", not in a rejected promise.
    const currentRegistry =
      (await readRegistry(registryPath)) ??
      (await repairRegistryFromSettings(globalSettingsPath, projectSettingsPath, now));

    globalUpdate = await reconcileSettingsTarget({
      settingsPath: globalSettingsPath,
      backupDir: join(backupDir, "global"),
      maxBackups,
      now,
      hooks: partition.global.hooks,
      mcps: partition.global.mcps,
      ownedHooks: collectOwnedHooks(currentRegistry, "global"),
    });

    projectUpdate = await reconcileSettingsTarget({
      settingsPath: projectSettingsPath,
      backupDir: join(backupDir, "project"),
      maxBackups,
      now,
      hooks: partition.project.hooks,
      mcps: partition.project.mcps,
      ownedHooks: collectOwnedHooks(currentRegistry, "project"),
    });

    const nextRegistry = buildNewRegistry(
      manifest,
      currentRegistry,
      now,
      new Set([...globalUpdate.userOwnedHookKeys, ...projectUpdate.userOwnedHookKeys])
    );
    const counts = computeCounts(currentRegistry, nextRegistry);

    await writeRegistry(registryPath, nextRegistry);
```

Registry keys are `hook:<event>:<id>` and `mcp:<id>`. A hook entry records `matcher` and, when this tool wrote the command, `command` and `timeout`. Entries written before plan 012, and entries rebuilt by registry repair, have neither field and are keyed `hook:<event>:<matcher>`.

### The tests

`apps/desktop-companion/test/sidecar/configCheckWiring.test.ts` (1,556 lines, 50 tests). `describe("createConfigChangeHandler integration")` has three tests that run the real `reconcile` on temp paths. `describe("createConfigChangeHandler failure isolation")` has 12 tests that pin the current gating. The last of them passes **no `reconcileFn`** and no reconcile paths:

```ts
  it("uses the default logger and non-Error string formatting paths without throwing", async () => {
    const handler = createConfigChangeHandler({
      syncConfig: {
        repoUrl: "file:///repo.git",
        bundleName: "core",
        destDir: "/tmp/skills",
        cacheDir: "/tmp/cache",
      },
      syncSkillsFn: vi.fn().mockRejectedValue("string failure"),
      writeTenantConfigFn: vi.fn().mockResolvedValue(undefined),
    });

    await expect(
      handler({
        schema_version: "1.0",
        tenant_id: "tenant-1",
        bundles: {
          core: {
            version: "v1.0.0",
          },
        },
      }),
    ).resolves.toBeUndefined();
  });
```

`apps/desktop-companion/test/sidecar/mainConfigCheckWiring.test.ts` (5 tests). One test calls the real handler through `startSidecar`. It sets only the global settings path. The project settings path, the registry path and the backup folder keep their defaults:

```ts
    const deps = makeDeps({
      managedToolingConfig: {
        manifestUrl: "https://example.com/manifest.json",
        intervalMs: 15_000,
        tenantConfigPath: "/tmp/tenant-config.json",
        reconcileConfig: {
          globalSettingsPath: "/tmp/global-settings.json",
        },
        syncConfig: {
          repoUrl: "file:///repo.git",
          destDir: "/tmp/skills",
          cacheDir: "/tmp/cache",
        },
      },
      createConfigCheckWiringFn: vi.fn((config) => {
        capturedOnSync = config.onSync;

        return {
          stop: vi.fn(),
          getState: () => ({ consecutiveFailures: 0 }),
        };
      }),
    });

    startSidecar(deps);

    await capturedOnSync?.({
      schema_version: "1.0",
      tenant_id: "tenant-1",
      bundles: {
        "bundle-a": { version: "v1.0.0" },
        "bundle-b": { version: "v2.0.0" },
      },
    });
```

Both are safe today only because the sync fails in each, and a failed sync skips reconcile. After Step 4 reconcile runs on every cycle. Verified by running the new handler against these tests unchanged, under a throwaway home directory: a `.claude` folder holding `.joyus-managed.json` appeared there, and each of the two tests alone was enough to create it.

The helper that builds a reconcile result for mocks (`configCheckWiring.test.ts`):

```ts
function createReconcileResult(
  status: ReconcileResult["status"] = "success",
  registryPath = "/tmp/registry.json",
  error?: string,
): ReconcileResult {
```

Repo conventions: TypeScript strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Vitest. Coverage must stay at 100% lines, functions, branches and statements, so code that becomes unreachable must be deleted, not left behind. `pnpm typecheck` does not check test files.

### What was run

On 2026-11-18, outside the repository, in a copy of commit `363bb14` with the reference result of plan 012's second revision applied and a `node_modules` borrowed from an existing worktree (Vitest 3.2.4). Every test run used a throwaway `HOME`.

- Before any change of this plan: `packages/settings-reconciler` 157 tests, `configCheckWiring.test.ts` 50, `configCheckPoller.test.ts` 21, `mainConfigCheckWiring.test.ts` 5. All pass.
- Step 2 with all test files untouched: the 157 package tests pass unchanged.
- Steps 2 and 4 without Step 1 (the hazard): 10 of the 12 "failure isolation" tests fail, one test in `mainConfigCheckWiring.test.ts` fails, and a `.claude` folder appears in the throwaway home. With Step 1 applied first, the same 11 tests fail after Step 4 and nothing is written there.
- After all steps: package 174, wiring 57, poller 21, main wiring 5. All pass. Nothing named `.claude` in the throwaway home.
- Coverage of that run: 100% statements, branches, functions and lines for `reconciler.ts`, `configCheckWiring.ts` and `configCheckPoller.ts`.
- On a complete copy of the branch with plan 012 (second revision) and this plan applied: both typechecks exit 0, and `vitest run --coverage`, the command behind `pnpm coverage`, exits 0 with 146 test files, 2,388 tests and 100%.
- Ten deliberate defects were put into the removals-only code one at a time: judge staleness by event and id; drop each of the two "still in use" protections; ignore the flag; treat every server as revoked; drop the reserved-prefix guard; forget the ownership record of a kept group; let one unreadable file stop the other; drop the records of a file that failed; open a file that has nothing to remove. Each made at least one test fail.
- This plan was then replayed: a script took the code blocks and the edit table from this file, applied them to a fresh copy as the Steps describe, and ran the same commands. Result: 55 wiring tests pass after Step 1; 157 package tests pass after Step 2 and 174 after Step 3; 11 wiring tests fail after Step 4, as Step 4 says; after Step 5 all 257 tests of the four test files pass; and the six resulting files were byte-identical to the reference.

Not run: the real `syncSkills` against a git host that is down or locked (every sync result in these tests is a mock); the poller and the handler together across a real five-minute interval; two processes reconciling at once; the code inside the real application.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Reconciler tests | `pnpm vitest run packages/settings-reconciler` | all pass (157 before this plan, 174 after) |
| Wiring tests, under a throwaway home directory | `HOME="$SAFE_HOME" pnpm vitest run apps/desktop-companion/test/sidecar/configCheckWiring.test.ts apps/desktop-companion/test/sidecar/mainConfigCheckWiring.test.ts apps/desktop-companion/test/sidecar/configCheckPoller.test.ts` | all pass (50 + 5 + 21 before this plan, 57 + 5 + 21 after) |
| Full coverage gate | `pnpm coverage` | exit 0, thresholds met |

Create the throwaway home once per shell: `export SAFE_HOME="$(mktemp -d)"`. If `mktemp` is refused, use `mkdir -p "$TMPDIR/safe-home-013" && export SAFE_HOME="$TMPDIR/safe-home-013"`.

**If your environment refuses commands that set `HOME`** (agent harnesses do), run the same commands without `HOME="$SAFE_HOME"` and use the fingerprint check instead. Run this before the test command and again after it; the two outputs must be identical:

```bash
ls -l ~/.claude/.joyus-managed.json 2>&1; shasum ~/.claude/.joyus-managed.json 2>&1
```

A difference means a test wrote to the real registry: STOP and report which handler has neither a mocked `reconcileFn` nor a full set of temp paths. Wherever a Verify below says "`ls -A "$SAFE_HOME"` must not list `.claude`", the fingerprint check is its replacement.

Never run `pnpm ci` (that is clean-install in pnpm). The full pipeline is `pnpm run ci`.

Run tests only on a branch that contains plan 008 (`git merge-base --is-ancestor 1edaa59 HEAD && echo safe` prints `safe`).

Known flaky tests, unrelated to this plan: `apps/desktop-companion/test/ui/SessionsPage.test.ts` ("clears mode note timers…"), `apps/desktop-companion/test/ui/components/LocalSiteCard.test.ts`, and a timing-dependent coverage gap in `ReconSetup.tsx`. If `pnpm coverage` fails only in one of those, rerun it once. If it fails again, treat it as a STOP condition.

## Scope

**In scope** (the only files you should modify):
- `packages/settings-reconciler/src/reconciler.ts`
- `packages/settings-reconciler/src/index.ts` (exports only)
- `packages/settings-reconciler/test/reconciler.test.ts`
- `apps/desktop-companion/src/sidecar/configCheckWiring.ts` (the helpers and handler quoted above only)
- `apps/desktop-companion/test/sidecar/configCheckWiring.test.ts`
- `apps/desktop-companion/test/sidecar/mainConfigCheckWiring.test.ts` (one test)
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch, even though they look related):
- `configCheckPoller.ts`. Its retry behavior is already what this plan needs.
- `apps/desktop-companion/src/sidecar/main.ts`.
- Everything in `configCheckWiring.ts` below the handler: `createAuthenticatedFetch`, `getTokenWithholdReason`, `resolveManifestFetch`, `resolveSidecarManagedToolingConfigFromEnv`. Do not add an https requirement for the manifest URL here; that is a recorded open question for the maintainer.
- `packages/skill-sync/`. Stale lock files and repository URL changes are a separate plan. This plan makes revocations independent of them.
- Removing synced skill files when a bundle is revoked. Not handled anywhere today; not added here.
- The full reconcile path: `planHookMerge`, `mergeHooks`, `buildNewRegistry`, the MCP merge. Step 2 adds to them and changes how `reconcile` calls them; what a full reconcile does stays the same.

## Git workflow

- Branch: `fix/013-revocations-always-applied`, cut from the plan 012 branch (or from `main` once 012 has merged there).
- Three commits: (1) `test: keep managed-tooling handler tests away from real settings paths`, (2) `feat: add a removals-only mode to the settings reconciler`, (3) `fix: apply revocations when skill sync fails and retry unfinished updates`. Conventional commits, matching `git log`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Make two existing tests safe before anything else changes

Create the throwaway home: `export SAFE_HOME="$(mktemp -d)"`.

**1a.** In `apps/desktop-companion/test/sidecar/configCheckWiring.test.ts`, find the test "uses the default logger and non-Error string formatting paths without throwing". In the object passed to `createConfigChangeHandler`, directly after the line `syncSkillsFn: vi.fn().mockRejectedValue("string failure"),`, add:

<!-- block: wiring-guard -->

```ts
      reconcileFn: vi.fn().mockResolvedValue(createReconcileResult()),
```

**1b.** In `apps/desktop-companion/test/sidecar/mainConfigCheckWiring.test.ts`:

Directly below the line `import { Readable } from "node:stream";`, add:

<!-- block: main-imports -->

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
```

In the test "passes optional managed-tooling config through and logs handler warnings and errors", add these two lines as the first lines of the test body, above `let capturedOnSync:`:

<!-- block: main-root -->

```ts
    // Every path the real handler can touch lives under this throwaway folder.
    const root = await mkdtemp(join(tmpdir(), "main-config-check-wiring-"));
```

In the same test, replace the `tenantConfigPath` line and the three-line `reconcileConfig` object (four lines in all, starting at `tenantConfigPath: "/tmp/tenant-config.json",`) with:

<!-- block: main-paths -->

```ts
        tenantConfigPath: join(root, "tenant-config.json"),
        reconcileConfig: {
          globalSettingsPath: join(root, "home", "settings.json"),
          projectSettingsPath: join(root, "project", "settings.json"),
          registryPath: join(root, "home", ".joyus-managed.json"),
          backupDir: join(root, "backups"),
        },
```

And add this as the last line of the same test, after the final `expect(...)`:

<!-- block: main-cleanup -->

```ts
    await rm(root, { recursive: true, force: true });
```

**Verify**:
1. `HOME="$SAFE_HOME" pnpm vitest run apps/desktop-companion/test/sidecar/configCheckWiring.test.ts apps/desktop-companion/test/sidecar/mainConfigCheckWiring.test.ts` → 55 pass.
2. `ls -A "$SAFE_HOME"` → may list `.joyus` (an older, unrelated leak: `startSidecar` creates a session database there). It must not list `.claude`.

Commit (commit 1).

### Step 2: Add a removals-only mode to `reconcile`

All edits in `packages/settings-reconciler/src/reconciler.ts`, except 2g. Do them all before running anything: the file does not compile in between.

**2a.** In `ReconcileConfig`, add one property directly after `readonly maxBackups?: number;`:

<!-- block: config-flag -->

```ts
  /**
   * When true, only remove what the registry records as installed and the
   * manifest no longer lists. Nothing is added, updated or moved, and the
   * registry entries that survive are kept exactly as they were. Each
   * settings file is handled on its own.
   */
  readonly removalsOnly?: boolean;
```

**2b.** Directly above the line `export function mergeMcpServers(`, add:

<!-- block: remove-hooks -->

```ts
/** A legacy managed group, named by where it lives. */
export interface HookGroupRef {
  readonly event: string;
  readonly matcher: string;
}

/**
 * Removals-only counterpart of removeStaleHooks: removes exactly the named
 * legacy groups and the named owned commands, and nothing else.
 */
export function removeRevokedHooks(
  currentHooks: Record<string, unknown[]>,
  revokedGroups: readonly HookGroupRef[],
  revokedCommands: readonly OwnedHook[]
): Record<string, unknown[]> {
  const groupKeys = new Set(revokedGroups.map((group) => groupKey(group.event, group.matcher)));

  return filterHookGroups(
    currentHooks,
    (event, matcher) => groupKeys.has(groupKey(event, matcher)),
    revokedCommands
  );
}
```

`removeStaleHooks` and `filterHookGroups` stay exactly as plan 012 left them.

**2c.** Directly above the line `export function partitionByTarget(`, add:

<!-- block: remove-mcp -->

```ts
/** Removals-only counterpart of removeStaleMcpServers: removes exactly the named ids. */
export function removeRevokedMcpServers(
  currentServers: Record<string, unknown>,
  revokedIds: readonly string[]
): Record<string, unknown> {
  const revoked = new Set(revokedIds);
  const nextServers: Record<string, unknown> = {};

  for (const [id, server] of Object.entries(normalizeMcpRecord(currentServers))) {
    if (!revoked.has(id)) {
      nextServers[id] = server;
    }
  }

  return nextServers;
}
```

**2d.** Directly below the `buildNewRegistry` function (above the line `function registryEntryEquals(`), add:

<!-- block: prune-registry -->

```ts
/** The current registry without the given keys. Surviving entries are untouched. */
function pruneRegistry(
  currentRegistry: ManagedRegistry,
  removedKeys: ReadonlySet<string>,
  now: () => Date
): ManagedRegistry {
  const entries: Record<string, RegistryEntry> = {};

  for (const [key, entry] of Object.entries(currentRegistry.entries)) {
    if (!removedKeys.has(key)) {
      entries[key] = entry;
    }
  }

  return {
    schema_version: "1.0",
    entries,
    last_reconciled: now().toISOString(),
  };
}
```

**2e.** Replace the first part of `reconcileSettingsTarget`. The replacement starts at the line `async function reconcileSettingsTarget(options: {` and ends directly before the line `  const nextSettings: Record<string, unknown> = { ...currentSettings };`. That line and everything after it stay, including the function `rollbackReconciledSettings` that follows. Put this in place of the removed part:

<!-- block: modes -->

```ts
/** What one run wants a settings file to hold. */
interface SettingsChange {
  readonly hooks: Record<string, unknown[]>;
  readonly mcpServers: Record<string, unknown>;
  readonly userOwnedHookKeys: readonly string[];
}

type SettingsChangeFn = (
  currentHooks: Record<string, unknown[]>,
  currentMcpServers: Record<string, unknown>
) => SettingsChange;

/** Install, update, move and remove: the file ends up as the manifest says. */
function fullChange(
  hooks: readonly ManifestHook[],
  mcps: readonly ManifestMcpServer[],
  ownedHooks: readonly OwnedHook[]
): SettingsChangeFn {
  return (currentHooks, currentMcpServers) => {
    const hookPlan = planHookMerge(currentHooks, hooks, ownedHooks);

    return {
      hooks: removeStaleHooks(hookPlan.hooks, hooks, ownedHooks),
      mcpServers: removeStaleMcpServers(
        mergeMcpServers(currentMcpServers, mcps),
        buildActiveMcpIds(mcps)
      ),
      userOwnedHookKeys: hookPlan.userOwned.map(hookRegistryKey),
    };
  };
}

/** What removals-only mode removes from one settings file. */
interface RevocationPlan {
  readonly groups: HookGroupRef[];
  readonly commands: OwnedHook[];
  readonly mcpIds: string[];
  /** Registry keys to drop once this file has been dealt with. */
  readonly keys: string[];
}

function hasRemovals(plan: RevocationPlan): boolean {
  return plan.groups.length > 0 || plan.commands.length > 0 || plan.mcpIds.length > 0;
}

/** Remove only: nothing is added, updated or moved. */
function removalChange(plan: RevocationPlan): SettingsChangeFn {
  return (currentHooks, currentMcpServers) => ({
    hooks: removeRevokedHooks(currentHooks, plan.groups, plan.commands),
    mcpServers: removeRevokedMcpServers(currentMcpServers, plan.mcpIds),
    userOwnedHookKeys: [],
  });
}

function parseHookKey(key: string): { event: string; id: string } {
  const rest = key.slice("hook:".length);
  const separator = rest.indexOf(":");
  return { event: rest.slice(0, separator), id: rest.slice(separator + 1) };
}

/**
 * Decides what removals-only mode removes: what the registry records as
 * installed, under an id the manifest no longer lists. An id that is still
 * listed keeps everything installed under it, wherever the manifest now says
 * it belongs.
 */
function planRevocations(
  manifest: DistributionManifest,
  currentRegistry: ManagedRegistry
): Record<SettingsTarget, RevocationPlan> {
  const hooks = collectAllHooks(manifest);
  const listedHookIds = new Set(hooks.map((hook) => hook.id));
  const listedMcpIds = buildActiveMcpIds(collectAllMcpServers(manifest));

  // Places that something still listed uses. They are never removed, even if
  // a revoked entry points at the same place.
  const keptGroups = new Set(hooks.map((hook) => groupKey(hook.event, hook.matcher)));
  const keptCommands = new Set(
    hooks.map((hook) => hookKey(hook.event, hook.matcher, hook.command))
  );

  const plans: Record<SettingsTarget, RevocationPlan> = {
    global: { groups: [], commands: [], mcpIds: [], keys: [] },
    project: { groups: [], commands: [], mcpIds: [], keys: [] },
  };
  const revokedHooks: Array<{
    key: string;
    entry: RegistryEntry;
    event: string;
    matcher: string;
  }> = [];

  for (const [key, entry] of Object.entries(currentRegistry.entries)) {
    if (entry.type === "mcp") {
      const id = key.slice("mcp:".length);
      if (!listedMcpIds.has(id)) {
        const plan = plans[resolveTarget(entry.target)];
        plan.keys.push(key);
        // The same guard as a full reconcile: only reserved ids are ever removed.
        if (id.startsWith(MANAGED_PREFIX)) {
          plan.mcpIds.push(id);
        }
      }
      continue;
    }

    // Entries written before the matcher was recorded, and entries rebuilt by
    // repair, are keyed by matcher: for them the id part is the matcher.
    const { event, id } = parseHookKey(key);
    const matcher = entry.matcher ?? id;

    if (listedHookIds.has(id)) {
      keptGroups.add(groupKey(event, matcher));
      if (entry.command !== undefined) {
        keptCommands.add(hookKey(event, matcher, entry.command));
      }
      continue;
    }

    revokedHooks.push({ key, entry, event, matcher });
  }

  for (const { key, entry, event, matcher } of revokedHooks) {
    const plan = plans[resolveTarget(entry.target)];

    if (isLegacyManagedMatcher(matcher)) {
      if (!keptGroups.has(groupKey(event, matcher))) {
        plan.groups.push({ event, matcher });
        plan.keys.push(key);
      }
    } else if (entry.command === undefined) {
      // The user's own command, or an entry too old to say what was written:
      // nothing in settings belongs to it.
      plan.keys.push(key);
    } else if (!keptCommands.has(hookKey(event, matcher, entry.command))) {
      plan.commands.push(
        entry.timeout === undefined
          ? { event, matcher, command: entry.command }
          : { event, matcher, command: entry.command, timeout: entry.timeout }
      );
      plan.keys.push(key);
    }
  }

  return plans;
}

async function reconcileSettingsTarget(options: {
  settingsPath: string;
  backupDir: string;
  maxBackups: number;
  now: () => Date;
  change: SettingsChangeFn;
}): Promise<SettingsUpdateResult> {
  const currentSettings = await readSettingsFileStrict(options.settingsPath);
  const currentHooksValue = currentSettings["hooks"];
  const currentMcpValue = currentSettings["mcpServers"];

  const {
    hooks: nextHooks,
    mcpServers: nextMcpServers,
    userOwnedHookKeys,
  } = options.change(
    normalizeHooksRecord(currentHooksValue),
    normalizeMcpRecord(currentMcpValue)
  );
```

After this edit the function takes a `change` callback instead of the manifest's hooks and servers. `fullChange` builds the callback for a full reconcile; `removalChange` builds it for removals-only mode.

How to read `planRevocations`:

- An MCP entry is revoked when its id is not in the manifest. It is removed from the file the registry recorded, whatever the manifest says elsewhere.
- A hook entry is revoked when no manifest hook has its id, on any event. The id is read from the registry key.
- Before anything is removed, the places still in use are collected: every event and matcher, and every event, matcher and command, that a listed manifest hook declares or that a still-listed registry entry records. A revoked entry that points at such a place is left in settings **and in the registry**, so the ownership record survives until a full reconcile rebuilds the registry.
- A revoked hook entry with a real matcher and no `command` is the user's own command (plan 012). Its registry entry is dropped and settings are not touched.
- Each plan lists the registry keys to drop for its file. They are dropped only when that file was dealt with.

**2f.** Replace the whole `reconcile` function. The replacement starts at the line `export async function reconcile(` and runs to the end of the file. Put this in its place:

<!-- block: reconcile -->

```ts
/** Puts a settings file back as it was. A failure here must not hide the first error. */
async function rollbackQuietly(
  settingsPath: string,
  updateResult: SettingsUpdateResult
): Promise<void> {
  try {
    await rollbackReconciledSettings(settingsPath, updateResult);
  } catch {
    // Best-effort rollback.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ResolvedReconcilePaths {
  readonly registryPath: string;
  readonly globalSettingsPath: string;
  readonly projectSettingsPath: string;
  readonly backupDir: string;
  readonly maxBackups: number;
  readonly now: () => Date;
}

/**
 * Removals-only mode. Each settings file is handled on its own: a file that
 * cannot be read or written does not hold back the removals in the other.
 * A file with nothing to remove is not opened at all.
 */
async function reconcileRemovalsOnly(
  manifest: DistributionManifest,
  paths: ResolvedReconcilePaths
): Promise<ReconcileResult> {
  const { registryPath, now } = paths;
  const applied: Array<{ settingsPath: string; update: SettingsUpdateResult }> = [];
  const failures: string[] = [];

  try {
    const currentRegistry =
      (await readRegistry(registryPath)) ??
      (await repairRegistryFromSettings(paths.globalSettingsPath, paths.projectSettingsPath, now));
    const plans = planRevocations(manifest, currentRegistry);
    const removedKeys = new Set<string>();

    for (const target of ["global", "project"] as const) {
      const plan = plans[target];
      const settingsPath =
        target === "global" ? paths.globalSettingsPath : paths.projectSettingsPath;

      if (hasRemovals(plan)) {
        try {
          const update = await reconcileSettingsTarget({
            settingsPath,
            backupDir: join(paths.backupDir, target),
            maxBackups: paths.maxBackups,
            now,
            change: removalChange(plan),
          });
          applied.push({ settingsPath, update });
        } catch (error) {
          // This file keeps its entries, in settings and in the registry.
          failures.push(errorMessage(error));
          continue;
        }
      }

      for (const key of plan.keys) {
        removedKeys.add(key);
      }
    }

    const nextRegistry = pruneRegistry(currentRegistry, removedKeys, now);
    const counts = computeCounts(currentRegistry, nextRegistry);

    await writeRegistry(registryPath, nextRegistry);

    const backupPath = applied.find(({ update }) => update.backupPath !== undefined)?.update
      .backupPath;

    if (failures.length > 0) {
      return withOptionalBackupPath({
        status: "error",
        entriesAdded: 0,
        entriesUpdated: 0,
        entriesRemoved: counts.removed,
        registryPath,
        error: failures.join("; "),
      }, backupPath);
    }

    return withOptionalBackupPath({
      status: "success",
      entriesAdded: 0,
      entriesUpdated: 0,
      entriesRemoved: counts.removed,
      registryPath,
    }, backupPath);
  } catch (error) {
    // The registry could not be loaded or written: undo what was removed.
    for (const { settingsPath, update } of applied) {
      await rollbackQuietly(settingsPath, update);
    }

    return {
      status: "rolled_back",
      entriesAdded: 0,
      entriesUpdated: 0,
      entriesRemoved: 0,
      registryPath,
      error: errorMessage(error),
    };
  }
}

export async function reconcile(
  manifest: DistributionManifest,
  config?: ReconcileConfig
): Promise<ReconcileResult> {
  const registryPath = resolveDefaultPath(config?.registryPath ?? "~/.claude/.joyus-managed.json");

  if (!(SUPPORTED_SCHEMA_VERSIONS as readonly string[]).includes(manifest.schema_version)) {
    return {
      status: "skipped",
      entriesAdded: 0,
      entriesUpdated: 0,
      entriesRemoved: 0,
      registryPath,
    };
  }

  const globalSettingsPath = resolveDefaultPath(
    config?.globalSettingsPath ?? "~/.claude/settings.json"
  );
  const projectSettingsPath = resolveDefaultPath(
    config?.projectSettingsPath ?? ".claude/settings.json"
  );
  const backupDir = resolveDefaultPath(
    config?.backupDir ?? "~/.claude/.joyus-reconciler-backups"
  );
  const maxBackups = config?.maxBackups ?? 5;
  const now = config?.now ?? (() => new Date());

  if (config?.removalsOnly === true) {
    return reconcileRemovalsOnly(manifest, {
      registryPath,
      globalSettingsPath,
      projectSettingsPath,
      backupDir,
      maxBackups,
      now,
    });
  }

  const partition = partitionByTarget(
    collectAllHooks(manifest),
    collectAllMcpServers(manifest)
  );

  let globalUpdate = NO_SETTINGS_UPDATE;
  let projectUpdate = NO_SETTINGS_UPDATE;

  try {
    // Inside the try: a failure while rebuilding a lost registry must end in
    // "rolled_back", not in a rejected promise.
    const currentRegistry =
      (await readRegistry(registryPath)) ??
      (await repairRegistryFromSettings(globalSettingsPath, projectSettingsPath, now));

    globalUpdate = await reconcileSettingsTarget({
      settingsPath: globalSettingsPath,
      backupDir: join(backupDir, "global"),
      maxBackups,
      now,
      change: fullChange(
        partition.global.hooks,
        partition.global.mcps,
        collectOwnedHooks(currentRegistry, "global")
      ),
    });

    projectUpdate = await reconcileSettingsTarget({
      settingsPath: projectSettingsPath,
      backupDir: join(backupDir, "project"),
      maxBackups,
      now,
      change: fullChange(
        partition.project.hooks,
        partition.project.mcps,
        collectOwnedHooks(currentRegistry, "project")
      ),
    });

    const nextRegistry = buildNewRegistry(
      manifest,
      currentRegistry,
      now,
      new Set([...globalUpdate.userOwnedHookKeys, ...projectUpdate.userOwnedHookKeys])
    );
    const counts = computeCounts(currentRegistry, nextRegistry);

    await writeRegistry(registryPath, nextRegistry);

    return withOptionalBackupPath({
      status: "success",
      entriesAdded: counts.added,
      entriesUpdated: counts.updated,
      entriesRemoved: counts.removed,
      registryPath,
    }, globalUpdate.backupPath ?? projectUpdate.backupPath);
  } catch (error) {
    await rollbackQuietly(globalSettingsPath, globalUpdate);
    await rollbackQuietly(projectSettingsPath, projectUpdate);

    return withOptionalBackupPath({
      status: "rolled_back",
      entriesAdded: 0,
      entriesUpdated: 0,
      entriesRemoved: 0,
      registryPath,
      error: errorMessage(error),
    }, globalUpdate.backupPath ?? projectUpdate.backupPath);
  }
}
```

What changed against the body plan 012 left:

- With `removalsOnly`, `reconcile` hands over to `reconcileRemovalsOnly`. That function handles the global file and the project file one after the other. If one cannot be read or written, its entries and its registry records stay, the other file is still handled, and the result is `status: "error"` with the reason. This is the first use of the `error` status by `reconcile`. A file whose plan has nothing to remove is not opened.
- If the registry cannot be loaded or written in removals-only mode, the files already changed are put back and the result is `rolled_back`, as in a full reconcile.
- The full reconcile is unchanged in behavior. It is still one transaction over both files. Its two calls pass `change: fullChange(...)`, and its two rollback blocks are now calls to `rollbackQuietly`.

**2g.** In `packages/settings-reconciler/src/index.ts`, replace the reconciler export block and the type export line below it (from the line `export {` that is followed by `reconcile,` up to, but not including, the line `export * from "./tenantConfig";`) with:

<!-- block: index-exports -->

```ts
export {
  reconcile,
  mergeHooks,
  removeStaleHooks,
  removeRevokedHooks,
  mergeMcpServers,
  removeStaleMcpServers,
  removeRevokedMcpServers,
  partitionByTarget,
} from "./reconciler.js";

export type { HookGroupRef, OwnedHook, ReconcileConfig, ReconcileResult, ReconcileStatus } from "./reconciler.js";
```

**Verify**: `pnpm typecheck` → exit 0. `pnpm vitest run packages/settings-reconciler` → 157 pass, with the test files untouched. If any existing test fails, STOP.

### Step 3: Test the removals-only mode

In `packages/settings-reconciler/test/reconciler.test.ts`:

**3a.** In the import from `"../src/reconciler.js"`, add `removeRevokedHooks,` and `removeRevokedMcpServers,` so that the list reads:

<!-- block: test-import -->

```ts
import {
  mergeHooks,
  mergeMcpServers,
  partitionByTarget,
  reconcile,
  removeRevokedHooks,
  removeRevokedMcpServers,
  removeStaleHooks,
  removeStaleMcpServers,
} from "../src/reconciler.js";
```

**3b.** At the end of `describe("pure reconciler helpers")`, add:

<!-- block: tests-helpers -->

```ts
  it("removes exactly the named legacy groups and owned commands", () => {
    const userHook = { type: "command", command: "echo user-bash" };
    const keptLegacy = {
      matcher: "joyus:keep",
      hooks: [{ type: "command", command: "echo keep", timeout: 5 }],
    };
    const currentHooks = {
      PreToolUse: [
        { matcher: "Bash", hooks: [userHook, { type: "command", command: "echo audit", timeout: 5 }] },
        keptLegacy,
        { matcher: "joyus:gone", hooks: [{ type: "command", command: "echo gone", timeout: 5 }] },
      ],
      // Same matcher, other event: not named, so it stays.
      SessionStart: [
        { matcher: "joyus:gone", hooks: [{ type: "command", command: "echo other", timeout: 5 }] },
      ],
    };

    const result = removeRevokedHooks(
      currentHooks,
      [{ event: "PreToolUse", matcher: "joyus:gone" }],
      [{ event: "PreToolUse", matcher: "Bash", command: "echo audit" }]
    );

    expect(result).toEqual({
      PreToolUse: [{ matcher: "Bash", hooks: [userHook] }, keptLegacy],
      SessionStart: currentHooks.SessionStart,
    });
    expect(result["PreToolUse"]![1]).toBe(keptLegacy);
    // The input is not mutated, and nothing named means nothing removed.
    expect(currentHooks.PreToolUse).toHaveLength(3);
    expect(removeRevokedHooks(currentHooks, [], [])).toEqual(currentHooks);
  });

  it("removes exactly the named MCP servers", () => {
    const userServer = { command: "python" };
    const currentServers = {
      "user-mcp": userServer,
      "joyus:keep": { command: "node" },
      "joyus:gone": { command: "bun" },
    };

    const result = removeRevokedMcpServers(currentServers, ["joyus:gone", "joyus:absent"]);

    expect(result).toEqual({ "user-mcp": userServer, "joyus:keep": { command: "node" } });
    expect(result["user-mcp"]).toBe(userServer);
    expect(Object.keys(currentServers)).toHaveLength(3);
  });
```

**3c.** At the very end of the file, after the closing `});` of `describe("reconcile")`, add this new block:

<!-- block: tests-removals -->

```ts
describe("reconcile in removals-only mode", () => {
  const INSTALLED_AT = "2026-03-01T00:00:00.000Z";

  function hookEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      type: "hook",
      bundle: "core",
      manifest_version: "1.0.0",
      event: "PreToolUse",
      target: "global",
      installed_at: INSTALLED_AT,
      ...overrides,
    };
  }

  function mcpEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      type: "mcp",
      bundle: "core",
      manifest_version: "1.0.0",
      target: "global",
      installed_at: INSTALLED_AT,
      ...overrides,
    };
  }

  async function seedRegistry(
    workspace: Awaited<ReturnType<typeof createWorkspace>>,
    entries: Record<string, unknown>
  ): Promise<void> {
    await writeJson(workspace.registryPath, {
      schema_version: "1.0",
      entries,
      last_reconciled: INSTALLED_AT,
    });
  }

  async function readEntries(
    workspace: Awaited<ReturnType<typeof createWorkspace>>
  ): Promise<Record<string, unknown>> {
    return ((await readJson(workspace.registryPath)) as { entries: Record<string, unknown> })
      .entries;
  }

  function removalsOnly(workspace: Awaited<ReturnType<typeof createWorkspace>>) {
    return { ...createConfig(workspace), removalsOnly: true };
  }

  it("removes revoked entries from both files and adds nothing", async () => {
    const workspace = await createWorkspace();
    const userHook = { type: "command", command: "echo user-bash" };

    await writeJson(workspace.globalSettingsPath, {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [userHook, { type: "command", command: "echo revoked", timeout: 5 }],
          },
          {
            matcher: "joyus:old-hook",
            hooks: [{ type: "command", command: "echo old", timeout: 5 }],
          },
        ],
      },
      mcpServers: {
        "joyus:old-mcp": { command: "node" },
        "user-mcp": { command: "python" },
      },
    });
    await writeJson(workspace.projectSettingsPath, {
      mcpServers: { "joyus:project-mcp": { command: "bun" } },
    });
    await seedRegistry(workspace, {
      "hook:PreToolUse:joyus:revoked": hookEntry({ matcher: "Bash", command: "echo revoked" }),
      "hook:PreToolUse:joyus:old-hook": hookEntry({
        matcher: "joyus:old-hook",
        command: "echo old",
      }),
      "mcp:joyus:old-mcp": mcpEntry(),
      "mcp:joyus:project-mcp": mcpEntry({ target: "project" }),
    });

    // The new manifest lists only brand-new entries.
    const result = await reconcile(
      createManifest({
        hooks: [createHook({ id: "joyus:new", matcher: "Edit", command: "echo new" })],
        mcps: [createMcp({ id: "joyus:new-mcp" })],
      }),
      removalsOnly(workspace)
    );

    expect(result).toMatchObject({
      status: "success",
      entriesAdded: 0,
      entriesUpdated: 0,
      entriesRemoved: 4,
    });
    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [userHook] }] },
      mcpServers: { "user-mcp": { command: "python" } },
    });
    expect(await readJson(workspace.projectSettingsPath)).toEqual({});
    expect(await readEntries(workspace)).toEqual({});
  });

  it("leaves a still-listed entry exactly as installed when its command changes", async () => {
    const workspace = await createWorkspace();
    const settings = {
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "echo audit", timeout: 5 }] },
        ],
      },
    };
    const entry = hookEntry({ matcher: "Bash", command: "echo audit" });

    await writeJson(workspace.globalSettingsPath, settings);
    const before = await readFile(workspace.globalSettingsPath, "utf8");
    await seedRegistry(workspace, { "hook:PreToolUse:joyus:audit": entry });

    // Same id, new command and version: a full reconcile would update it.
    const result = await reconcile(
      createManifest({
        version: "2.0.0",
        hooks: [createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit v2" })],
      }),
      removalsOnly(workspace)
    );

    expect(result).toMatchObject({
      status: "success",
      entriesAdded: 0,
      entriesUpdated: 0,
      entriesRemoved: 0,
    });
    expect(result.backupPath).toBeUndefined();
    expect(await readFile(workspace.globalSettingsPath, "utf8")).toBe(before);
    expect(await readEntries(workspace)).toEqual({ "hook:PreToolUse:joyus:audit": entry });
  });

  it("keeps an MCP server where it is when its target changes, until a full reconcile moves it", async () => {
    const workspace = await createWorkspace();
    await writeJson(workspace.globalSettingsPath, {
      mcpServers: { "joyus:mcp": { command: "node" }, "joyus:dropped": { command: "bun" } },
    });
    await seedRegistry(workspace, {
      "mcp:joyus:mcp": mcpEntry(),
      "mcp:joyus:dropped": mcpEntry(),
    });
    // joyus:mcp moves to the project file; joyus:dropped is revoked.
    const manifest = createManifest({ mcps: [createMcp({ target: "project" })] });

    const removed = await reconcile(manifest, removalsOnly(workspace));

    expect(removed).toMatchObject({ status: "success", entriesRemoved: 1 });
    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      mcpServers: { "joyus:mcp": { command: "node" } },
    });
    await expect(readFile(workspace.projectSettingsPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readEntries(workspace)).toEqual({ "mcp:joyus:mcp": mcpEntry() });

    // Sync works again: the full reconcile moves it.
    const moved = await reconcile(manifest, createConfig(workspace));

    expect(moved).toMatchObject({ status: "success", entriesUpdated: 1 });
    expect(await readJson(workspace.globalSettingsPath)).toEqual({});
    expect(await readJson(workspace.projectSettingsPath)).toEqual({
      mcpServers: { "joyus:mcp": { command: "node" } },
    });
  });

  it("keeps a joyus: group where it is when its matcher changes, until a full reconcile moves it", async () => {
    const workspace = await createWorkspace();
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "joyus:old-name",
            hooks: [{ type: "command", command: "echo guard", timeout: 5 }],
          },
        ],
      },
    };
    await writeJson(workspace.globalSettingsPath, settings);
    const entry = hookEntry({ matcher: "joyus:old-name", command: "echo guard" });
    await seedRegistry(workspace, { "hook:PreToolUse:joyus:guard": entry });
    const manifest = createManifest({
      hooks: [createHook({ id: "joyus:guard", matcher: "joyus:new-name", command: "echo guard" })],
    });

    const removed = await reconcile(manifest, removalsOnly(workspace));

    expect(removed).toMatchObject({ status: "success", entriesRemoved: 0 });
    expect(await readJson(workspace.globalSettingsPath)).toEqual(settings);
    expect(await readEntries(workspace)).toEqual({ "hook:PreToolUse:joyus:guard": entry });

    await reconcile(manifest, createConfig(workspace));

    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: "joyus:new-name",
            hooks: [{ type: "command", command: "echo guard", timeout: 5 }],
          },
        ],
      },
    });
  });

  it("keeps a hook where it is when its event or its real matcher changes, until a full reconcile moves it", async () => {
    const workspace = await createWorkspace();
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              { type: "command", command: "echo audit", timeout: 5 },
              { type: "command", command: "echo lint", timeout: 5 },
            ],
          },
        ],
      },
    };
    await writeJson(workspace.globalSettingsPath, settings);
    const entries = {
      "hook:PreToolUse:joyus:audit": hookEntry({ matcher: "Bash", command: "echo audit" }),
      "hook:PreToolUse:joyus:lint": hookEntry({ matcher: "Bash", command: "echo lint" }),
    };
    await seedRegistry(workspace, entries);
    // joyus:audit moves to another event, joyus:lint to another matcher.
    const manifest = createManifest({
      hooks: [
        createHook({
          id: "joyus:audit",
          event: "PostToolUse",
          matcher: "Bash",
          command: "echo audit",
        }),
        createHook({ id: "joyus:lint", matcher: "Edit", command: "echo lint" }),
      ],
    });

    const removed = await reconcile(manifest, removalsOnly(workspace));

    expect(removed).toMatchObject({ status: "success", entriesRemoved: 0 });
    expect(await readJson(workspace.globalSettingsPath)).toEqual(settings);
    expect(await readEntries(workspace)).toEqual(entries);

    await reconcile(manifest, createConfig(workspace));

    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: {
        PreToolUse: [
          { matcher: "Edit", hooks: [{ type: "command", command: "echo lint", timeout: 5 }] },
        ],
        PostToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "echo audit", timeout: 5 }] },
        ],
      },
    });
  });

  it("keeps a place that a still-listed hook uses, and keeps the registry entry that owns it", async () => {
    const workspace = await createWorkspace();
    const settings = {
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "echo shared", timeout: 5 }] },
          {
            matcher: "joyus:shared-group",
            hooks: [{ type: "command", command: "echo group", timeout: 5 }],
          },
        ],
      },
    };
    await writeJson(workspace.globalSettingsPath, settings);
    const entries = {
      // Revoked ids. A listed hook declares the same command, and a listed
      // registry entry records the same group.
      "hook:PreToolUse:joyus:first": hookEntry({ matcher: "Bash", command: "echo shared" }),
      "hook:PreToolUse:joyus:old-owner": hookEntry({
        matcher: "joyus:shared-group",
        command: "echo group",
      }),
      "hook:PreToolUse:joyus:co-owner": hookEntry({
        matcher: "joyus:shared-group",
        command: "echo group",
      }),
    };
    await seedRegistry(workspace, entries);

    const result = await reconcile(
      createManifest({
        hooks: [
          createHook({ id: "joyus:second", matcher: "Bash", command: "echo shared" }),
          // Listed, and its manifest matcher has changed since it was installed.
          createHook({ id: "joyus:co-owner", matcher: "joyus:renamed", command: "echo group" }),
        ],
      }),
      removalsOnly(workspace)
    );

    expect(result).toMatchObject({ status: "success", entriesRemoved: 0 });
    expect(await readJson(workspace.globalSettingsPath)).toEqual(settings);
    // Nothing was removed, so no ownership record is dropped either.
    expect(await readEntries(workspace)).toEqual(entries);
  });

  it("removes a revoked group recorded before the matcher field existed, and leaves the user's own command", async () => {
    const workspace = await createWorkspace();
    const userEntry = { type: "command", command: "echo audit", timeout: 30 };
    await writeJson(workspace.globalSettingsPath, {
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [userEntry] },
          {
            matcher: "joyus:legacy",
            hooks: [{ type: "command", command: "echo legacy", timeout: 5 }],
          },
        ],
      },
      mcpServers: { "user-mcp": { command: "python" } },
    });
    await seedRegistry(workspace, {
      // Written before plan 012: keyed by matcher, no matcher or command field.
      "hook:PreToolUse:joyus:legacy": hookEntry(),
      // The user already had this command: a matcher, but no command.
      "hook:PreToolUse:joyus:audit": hookEntry({ matcher: "Bash" }),
      // A hand-edited entry without the reserved prefix is never acted on.
      "mcp:user-mcp": mcpEntry(),
    });

    const result = await reconcile(createManifest(), removalsOnly(workspace));

    expect(result).toMatchObject({ status: "success", entriesRemoved: 3 });
    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [userEntry] }] },
      mcpServers: { "user-mcp": { command: "python" } },
    });
    expect(await readEntries(workspace)).toEqual({});
  });

  it("works from a repaired registry when the registry file is missing", async () => {
    const workspace = await createWorkspace();
    await writeJson(workspace.globalSettingsPath, {
      hooks: {
        PreToolUse: [
          { matcher: "joyus:gone", hooks: [{ type: "command", command: "echo gone", timeout: 5 }] },
          {
            matcher: "joyus:guard-group",
            hooks: [{ type: "command", command: "echo guard", timeout: 5 }],
          },
        ],
      },
      mcpServers: { "joyus:gone-mcp": { command: "node" }, "joyus:mcp": { command: "node" } },
    });

    const result = await reconcile(
      createManifest({
        // Listed under an id that differs from its matcher: repair cannot know
        // the id, so the group is kept because a listed hook declares it.
        hooks: [createHook({ id: "joyus:guard", matcher: "joyus:guard-group", command: "echo guard" })],
        mcps: [createMcp()],
      }),
      removalsOnly(workspace)
    );

    expect(result).toMatchObject({ status: "success", entriesAdded: 0, entriesRemoved: 2 });
    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: "joyus:guard-group",
            hooks: [{ type: "command", command: "echo guard", timeout: 5 }],
          },
        ],
      },
      mcpServers: { "joyus:mcp": { command: "node" } },
    });
    expect(Object.keys(await readEntries(workspace)).sort()).toEqual([
      "hook:PreToolUse:joyus:guard-group",
      "mcp:joyus:mcp",
    ]);
  });

  it("rolls back and reports the failure like a full reconcile", async () => {
    const workspace = await createWorkspace();
    const original = { mcpServers: { "joyus:old-mcp": { command: "node" } } };
    await writeJson(workspace.globalSettingsPath, original);
    await seedRegistry(workspace, { "mcp:joyus:old-mcp": mcpEntry() });
    vi.spyOn(registryModule, "writeRegistry").mockRejectedValueOnce(
      new Error("registry write failed")
    );

    const result = await reconcile(createManifest(), removalsOnly(workspace));

    expect(result).toMatchObject({ status: "rolled_back", error: "registry write failed" });
    expect(await readJson(workspace.globalSettingsPath)).toEqual(original);
  });

  it("applies the removals in one file when the other cannot be read", async () => {
    for (const broken of ["project", "global"] as const) {
      const workspace = await createWorkspace();
      const brokenPath =
        broken === "project" ? workspace.projectSettingsPath : workspace.globalSettingsPath;
      const healthyPath =
        broken === "project" ? workspace.globalSettingsPath : workspace.projectSettingsPath;
      const healthy = broken === "project" ? "global" : "project";

      await writeJson(healthyPath, {
        mcpServers: { "joyus:revoked-here": { command: "node" }, "user-mcp": { command: "python" } },
      });
      await mkdir(dirname(brokenPath), { recursive: true });
      await writeFile(brokenPath, "{ broken", "utf8");
      await seedRegistry(workspace, {
        "mcp:joyus:revoked-here": mcpEntry({ target: healthy }),
        "mcp:joyus:revoked-there": mcpEntry({ target: broken }),
      });

      const result = await reconcile(createManifest(), removalsOnly(workspace));

      // The readable file lost its revoked entry. The other file and its record are untouched.
      expect(result).toMatchObject({ status: "error", entriesRemoved: 1 });
      expect(result.error).toContain(brokenPath);
      expect(result.error).toContain("not valid JSON");
      expect(await readJson(healthyPath)).toEqual({ mcpServers: { "user-mcp": { command: "python" } } });
      expect(await readFile(brokenPath, "utf8")).toBe("{ broken");
      expect(await readEntries(workspace)).toEqual({
        "mcp:joyus:revoked-there": mcpEntry({ target: broken }),
      });
    }
  });

  it("reports both files when neither can be read, and removes nothing", async () => {
    const workspace = await createWorkspace();
    for (const path of [workspace.globalSettingsPath, workspace.projectSettingsPath]) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "null", "utf8");
    }
    const entries = {
      "mcp:joyus:global-mcp": mcpEntry(),
      "mcp:joyus:project-mcp": mcpEntry({ target: "project" }),
    };
    await seedRegistry(workspace, entries);

    const result = await reconcile(createManifest(), removalsOnly(workspace));

    expect(result).toMatchObject({ status: "error", entriesRemoved: 0 });
    expect(result.error).toContain(workspace.globalSettingsPath);
    expect(result.error).toContain(workspace.projectSettingsPath);
    expect(result.backupPath).toBeUndefined();
    expect(await readEntries(workspace)).toEqual(entries);
  });

  it("does not open a file that has nothing to remove", async () => {
    const workspace = await createWorkspace();
    await writeJson(workspace.globalSettingsPath, {
      mcpServers: { "joyus:old-mcp": { command: "node" } },
    });
    // Unreadable, but no revoked entry lives in it.
    await mkdir(dirname(workspace.projectSettingsPath), { recursive: true });
    await writeFile(workspace.projectSettingsPath, "{ broken", "utf8");
    await seedRegistry(workspace, { "mcp:joyus:old-mcp": mcpEntry() });

    const result = await reconcile(createManifest(), removalsOnly(workspace));

    expect(result).toMatchObject({ status: "success", entriesRemoved: 1 });
    expect(result.backupPath).toBeDefined();
    expect(await readJson(workspace.globalSettingsPath)).toEqual({});
  });

  it("removes the entry it wrote, not a copy the user added before it", async () => {
    const workspace = await createWorkspace();
    const userCopy = { type: "command", command: "echo audit", timeout: 30, note: "mine" };
    await writeJson(workspace.globalSettingsPath, {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [userCopy, { type: "command", command: "echo audit", timeout: 5 }],
          },
        ],
      },
    });
    await seedRegistry(workspace, {
      "hook:PreToolUse:joyus:audit": hookEntry({
        matcher: "Bash",
        command: "echo audit",
        timeout: 5,
      }),
    });

    const result = await reconcile(createManifest(), removalsOnly(workspace));

    expect(result).toMatchObject({ status: "success", entriesRemoved: 1 });
    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [userCopy] }] },
    });
  });

  it("returns rolled_back when the registry cannot be rebuilt", async () => {
    const workspace = await createWorkspace();
    await writeJson(workspace.globalSettingsPath, { existing: true });
    vi.spyOn(registryModule, "repairRegistry").mockRejectedValueOnce(new Error("repair failed"));

    const result = await reconcile(createManifest(), removalsOnly(workspace));

    expect(result).toEqual({
      status: "rolled_back",
      entriesAdded: 0,
      entriesUpdated: 0,
      entriesRemoved: 0,
      registryPath: workspace.registryPath,
      error: "repair failed",
    });
    expect(await readJson(workspace.globalSettingsPath)).toEqual({ existing: true });
  });

  it("still returns rolled_back when putting a file back fails", async () => {
    const workspace = await createWorkspace();
    await writeJson(workspace.globalSettingsPath, {
      mcpServers: { "joyus:old-mcp": { command: "node" } },
    });
    await seedRegistry(workspace, { "mcp:joyus:old-mcp": mcpEntry() });
    vi.spyOn(registryModule, "writeRegistry").mockRejectedValueOnce("registry write failed");
    vi.spyOn(settingsFileModule, "rollbackSettings").mockRejectedValue(
      new Error("rollback failed")
    );

    const result = await reconcile(createManifest(), removalsOnly(workspace));

    expect(result).toMatchObject({ status: "rolled_back", error: "registry write failed" });
  });
});
```

**Verify**: `pnpm vitest run packages/settings-reconciler` → 174 pass. Commit (commit 2).

### Step 4: Rewrite the handler

In `apps/desktop-companion/src/sidecar/configCheckWiring.ts`:

**4a.** Delete the `getManagedEntryIds` and `hasRevocation` functions. Keep `getBundleNames`.

**4b.** In `resolveTargetVersion`, replace these lines:

```ts
  const versions = [...new Set(Object.values(manifest.bundles).map((bundle) => bundle.version))];
  if (versions.length === 0) {
    return undefined;
  }

  if (versions.length === 1) {
    return versions[0];
  }
```

with:

<!-- block: resolve-version -->

```ts
  const versions = [...new Set(Object.values(manifest.bundles).map((bundle) => bundle.version))];
  // No bundles: undefined. One version: that version.
  if (versions.length <= 1) {
    return versions[0];
  }
```

The result is the same for every input. The separate "no bundles" branch has to go because the new handler never asks for a version when the manifest has no bundles, and an unreachable branch fails the coverage gate.

**4c.** Replace the returned async function (everything from `return async (manifest: DistributionManifest): Promise<void> => {` to its closing `};`) with:

<!-- block: handler -->

```ts
  return async (manifest: DistributionManifest): Promise<void> => {
    const previousManifest = lastManifest;
    // A manifest with no bundles revokes everything; there is nothing to sync.
    const nothingToSync = getBundleNames(manifest).length === 0;

    let syncOk = nothingToSync;
    let reconcileOk = false;

    if (!nothingToSync) {
      let targetVersion: string | undefined;

      try {
        targetVersion = resolveSyncTargetVersion(
          manifest,
          previousManifest,
          config.syncConfig.bundleName,
        );
      } catch (error: unknown) {
        logger.error(
          `configCheckWiring: ${formatError(error)}`,
        );
      }

      if (targetVersion === undefined) {
        logger.warn(
          "configCheckWiring: skipping skill sync because no target version could be resolved.",
        );
      } else {
        try {
          const syncResult = await syncSkillsFn({
            ...config.syncConfig,
            targetVersion,
          });

          if (syncResult.status === "success") {
            syncOk = true;
          } else if (syncResult.status === "offline") {
            logger.warn(
              `configCheckWiring: skill sync is offline for ${targetVersion}.`,
            );
          } else {
            logger.error(
              `configCheckWiring: skill sync returned ${syncResult.status}.`,
            );
          }
        } catch (error: unknown) {
          logger.error(
            `configCheckWiring: skill sync failed: ${formatError(error)}`,
          );
        }
      }
    }

    // Removals never depend on synced skill files, so they are applied on
    // every cycle. Additions, updates and moves wait for a successful sync.
    try {
      const reconcileResult = await reconcileFn(
        manifest,
        syncOk
          ? config.reconcileConfig
          : { ...config.reconcileConfig, removalsOnly: true },
      );

      if (reconcileResult.status === "rolled_back") {
        logger.error(
          `configCheckWiring: reconcile rolled back: ${reconcileResult.error ?? "unknown error"}`,
        );
      } else if (reconcileResult.status === "error") {
        logger.error(
          `configCheckWiring: reconcile failed: ${reconcileResult.error ?? "unknown error"}`,
        );
      } else {
        reconcileOk = true;
      }
    } catch (error: unknown) {
      logger.error(
        `configCheckWiring: reconcile threw: ${formatError(error)}`,
      );
    }

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
```

On the success path the call is still `reconcileFn(manifest, config.reconcileConfig)`, exactly as before.

**Verify**: `pnpm typecheck` → exit 0. `grep -c 'hasRevocation\|getManagedEntryIds\|shouldAttemptReconcile' apps/desktop-companion/src/sidecar/configCheckWiring.ts` → `0`. Do not treat the wiring tests as a check yet: at this point ten tests in `configCheckWiring.test.ts` and one in `mainConfigCheckWiring.test.ts` fail, which Step 5 fixes.

### Step 5: Update the wiring tests

**5a. Edit W.** In `apps/desktop-companion/test/sidecar/configCheckWiring.test.ts`, inside `describe("createConfigChangeHandler failure isolation")`, several handler calls must now be asserted as rejections. "Edit W" for a handler variable `X` and a message `M` means: change the line

```ts
    await X({
```

to

```ts
    await expect(X({
```

and change the first following line that is exactly `    });` (four spaces, closing the call) to

```ts
    })).rejects.toThrow("M");
```

Keep every assertion that follows; those calls still happen before the rejection. Apply the table below, one row per existing test. The three messages are:

- **M1** = `managed tooling update incomplete (skill sync failed, reconcile ok)`
- **M2** = `managed tooling update incomplete (skill sync failed, reconcile failed)`
- **M3** = `managed tooling update incomplete (skill sync ok, reconcile failed)`

| Existing test | Edit W | Swap | New title |
|---|---|---|---|
| "skips reconcile on offline sync when there is no revocation, but still writes tenant config" | `handler` → M1 | A, replacing `expect(reconcileFn).not.toHaveBeenCalled();` | "runs a removals-only reconcile when sync is offline, writes tenant config, and rejects so the poller retries" |
| "treats managed entry removal within the same bundle as a revocation" | `handler` → M1 | A, replacing `expect(reconcileFn).toHaveBeenCalledOnce();` | "applies an entry removal within a bundle through a removals-only reconcile when sync is offline" |
| "reconciles an initial empty manifest when no target version can be resolved" | — | B | "reconciles an initial empty manifest without attempting a sync" |
| "logs non-success sync results, reconcile failures, and tenant config write failures" | `handler` → M2 | — | keep |
| "logs rolled-back reconcile results after a successful sync" | `handler` → M3 | — | keep |
| "falls back to unknown reconcile errors when the result omits an error message" | `rolledBackHandler` → M3, `errorHandler` → M3 | — | keep |
| "logs sync exceptions, reconcile exceptions and error statuses" | `throwingHandler` → M2, `errorStatusHandler` → M3 | — | keep |
| "logs thrown reconcile errors after a successful sync" | `handler` → M3 | — | keep |
| "logs ambiguous version resolution and skips reconcile unless the manifest is a revocation" | `handler` → M1 | A, replacing `expect(reconcileFn).not.toHaveBeenCalled();` | "logs ambiguous version resolution, runs a removals-only reconcile, and rejects" |
| "uses the default logger and non-Error string formatting paths without throwing" | — | C | "uses the default logger and non-Error string formatting paths" |

The replacement for a reconcile assertion ("Swap A" in the table) is these two lines:

<!-- block: wiring-removals-assert -->

```ts
    expect(reconcileFn).toHaveBeenCalledOnce();
    expect(reconcileFn).toHaveBeenCalledWith(expect.anything(), { removalsOnly: true });
```

"Swap B" replaces the three-line assertion `expect(logger.warn).toHaveBeenCalledWith("configCheckWiring: skipping skill sync because no target version could be resolved.");` with:

<!-- block: wiring-empty-assert -->

```ts
    expect(logger.warn).not.toHaveBeenCalled();
```

"Swap C" replaces the line `    ).resolves.toBeUndefined();` with:

<!-- block: wiring-resolves-replacement -->

```ts
    ).rejects.toThrow("managed tooling update incomplete (skill sync failed, reconcile ok)");
```

Two tests in that block are not in the table and stay as they are: "still reconciles revocation manifests when sync is offline" and "compares manifests correctly when bundles only define MCP servers". Do not change the three existing tests in `describe("createConfigChangeHandler integration")`.

**5b.** At the end of `describe("createConfigChangeHandler failure isolation")`, add:

<!-- block: wiring-new-isolation -->

```ts
  it("applies revocations when sync is locked, with no previous manifest in memory", async () => {
    const reconcileFn = vi.fn().mockResolvedValue(createReconcileResult());
    const handler = createConfigChangeHandler({
      syncConfig: {
        repoUrl: "file:///repo.git",
        bundleName: "core",
        destDir: "/tmp/skills",
        cacheDir: "/tmp/cache",
      },
      tenantConfigPath: "/tmp/tenant-config.json",
      syncSkillsFn: vi.fn().mockResolvedValue({
        status: "locked",
        filesUpdated: 0,
        metadataPath: "/tmp/meta.json",
        noop: true,
      }),
      reconcileFn,
      writeTenantConfigFn: vi.fn().mockResolvedValue(undefined),
    });
    const manifest = {
      schema_version: "1.0",
      tenant_id: "tenant-1",
      bundles: { core: { version: "v1.0.0" } },
    };

    await expect(handler(manifest)).rejects.toThrow(
      "managed tooling update incomplete (skill sync failed, reconcile ok); will retry.",
    );
    expect(reconcileFn).toHaveBeenCalledWith(manifest, { removalsOnly: true });
  });

  it("passes the configured reconcile paths through in removals-only mode", async () => {
    const reconcileFn = vi.fn().mockResolvedValue(createReconcileResult());
    const handler = createConfigChangeHandler({
      syncConfig: {
        repoUrl: "file:///repo.git",
        bundleName: "core",
        destDir: "/tmp/skills",
        cacheDir: "/tmp/cache",
      },
      reconcileConfig: { registryPath: "/tmp/registry.json" },
      tenantConfigPath: "/tmp/tenant-config.json",
      syncSkillsFn: vi.fn().mockRejectedValue(new Error("git unreachable")),
      reconcileFn,
      writeTenantConfigFn: vi.fn().mockResolvedValue(undefined),
    });

    await expect(
      handler({
        schema_version: "1.0",
        tenant_id: "tenant-1",
        bundles: { core: { version: "v1.0.0" } },
      }),
    ).rejects.toThrow("managed tooling update incomplete");
    expect(reconcileFn).toHaveBeenCalledWith(expect.anything(), {
      registryPath: "/tmp/registry.json",
      removalsOnly: true,
    });
  });

  it("resolves and reconciles fully once sync succeeds", async () => {
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
        filesUpdated: 1,
        metadataPath: "/tmp/meta.json",
        version: "v1.0.0",
        noop: false,
      });
    const handler = createConfigChangeHandler({
      syncConfig: {
        repoUrl: "file:///repo.git",
        bundleName: "core",
        destDir: "/tmp/skills",
        cacheDir: "/tmp/cache",
      },
      tenantConfigPath: "/tmp/tenant-config.json",
      syncSkillsFn,
      reconcileFn,
      writeTenantConfigFn: vi.fn().mockResolvedValue(undefined),
    });
    const manifest = {
      schema_version: "1.0",
      tenant_id: "tenant-1",
      bundles: { core: { version: "v1.0.0" } },
    };

    // First cycle: offline, so removals only, and the handler rejects.
    await expect(handler(manifest)).rejects.toThrow("managed tooling update incomplete");
    // The poller calls again with the same manifest: now a full reconcile.
    await expect(handler(manifest)).resolves.toBeUndefined();

    expect(reconcileFn).toHaveBeenNthCalledWith(1, manifest, { removalsOnly: true });
    expect(reconcileFn).toHaveBeenNthCalledWith(2, manifest, undefined);
  });

  it("syncs the earlier version of the configured bundle when the new manifest drops that bundle but keeps others", async () => {
    const reconcileFn = vi.fn().mockResolvedValue(createReconcileResult());
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

    await expect(handler(manifest)).resolves.toBeUndefined();

    expect(syncSkillsFn).toHaveBeenCalledWith(
      expect.objectContaining({ targetVersion: "v1.0.0" }),
    );
    expect(reconcileFn).toHaveBeenCalledWith(manifest, undefined);
  });

  it("keeps retrying when the configured bundle is missing and no earlier manifest is known", async () => {
    const logger = {
      error: vi.fn(),
      warn: vi.fn(),
    };
    const reconcileFn = vi.fn().mockResolvedValue(createReconcileResult());
    const syncSkillsFn = vi.fn();
    const handler = createConfigChangeHandler({
      syncConfig: {
        repoUrl: "file:///repo.git",
        bundleName: "core",
        destDir: "/tmp/skills",
        cacheDir: "/tmp/cache",
      },
      logger,
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
      "managed tooling update incomplete (skill sync failed, reconcile ok)",
    );

    expect(logger.warn).toHaveBeenCalledWith(
      "configCheckWiring: skipping skill sync because no target version could be resolved.",
    );
    expect(syncSkillsFn).not.toHaveBeenCalled();
    expect(reconcileFn).toHaveBeenCalledWith(manifest, { removalsOnly: true });
  });
```

**5c.** At the end of `describe("createConfigChangeHandler integration")`, add these two tests. They run the real reconciler on temp paths through the handler:

<!-- block: wiring-new-integration -->

```ts
  it("removes a revoked server while sync is locked, keeps one whose target changed, and finishes once sync succeeds", async () => {
    const workspace = await createWorkspace();
    const reconcileConfig = {
      globalSettingsPath: workspace.globalSettingsPath,
      projectSettingsPath: workspace.projectSettingsPath,
      registryPath: workspace.registryPath,
      backupDir: workspace.backupDir,
      now: () => FIXED_NOW,
    };
    const success = {
      status: "success",
      filesUpdated: 1,
      metadataPath: join(workspace.skillsDir, ".sync-metadata.json"),
      version: "v1.0.0",
      noop: false,
    };
    const locked = {
      status: "locked",
      filesUpdated: 0,
      metadataPath: join(workspace.skillsDir, ".sync-metadata.json"),
      noop: true,
    };
    const syncSkillsFn = vi
      .fn()
      .mockResolvedValueOnce(success)
      .mockResolvedValueOnce(locked)
      .mockResolvedValueOnce(success);
    const handler = createConfigChangeHandler({
      syncConfig: {
        repoUrl: "file:///repo.git",
        bundleName: "core",
        destDir: workspace.skillsDir,
        cacheDir: workspace.cacheDir,
      },
      reconcileConfig,
      syncSkillsFn,
    });
    const server = (id: string, target: "global" | "project") => ({
      id,
      command: "node",
      args: [`${id}.mjs`],
      target,
    });

    // Cycle 1, sync works: two servers are installed in the global file.
    await handler(
      createManifest(workspace, {
        bundles: {
          core: {
            version: "v1.0.0",
            mcpServers: [server("joyus:stays", "global"), server("joyus:revoked", "global")],
          },
        },
      }),
    );

    // Cycle 2, sync is locked: one server is dropped, the other changes target
    // and a new one appears.
    const next = createManifest(workspace, {
      bundles: {
        core: {
          version: "v1.0.0",
          mcpServers: [server("joyus:stays", "project"), server("joyus:added", "global")],
        },
      },
    });
    await expect(handler(next)).rejects.toThrow(
      "managed tooling update incomplete (skill sync failed, reconcile ok)",
    );

    // Only the revocation was applied. Nothing moved, nothing was added.
    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      mcpServers: { "joyus:stays": { command: "node", args: ["joyus:stays.mjs"] } },
    });
    await expect(readFile(workspace.projectSettingsPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });

    // Cycle 3, the poller retries the same manifest and sync works again.
    await expect(handler(next)).resolves.toBeUndefined();

    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      mcpServers: { "joyus:added": { command: "node", args: ["joyus:added.mjs"] } },
    });
    expect(await readJson(workspace.projectSettingsPath)).toEqual({
      mcpServers: { "joyus:stays": { command: "node", args: ["joyus:stays.mjs"] } },
    });
  });

  it("applies a revocation in the global file when sync is locked and the project file is broken", async () => {
    const workspace = await createWorkspace();
    const logger = {
      error: vi.fn(),
      warn: vi.fn(),
    };
    const success = {
      status: "success",
      filesUpdated: 1,
      metadataPath: join(workspace.skillsDir, ".sync-metadata.json"),
      version: "v1.0.0",
      noop: false,
    };
    const locked = {
      status: "locked",
      filesUpdated: 0,
      metadataPath: join(workspace.skillsDir, ".sync-metadata.json"),
      noop: true,
    };
    const handler = createConfigChangeHandler({
      syncConfig: {
        repoUrl: "file:///repo.git",
        bundleName: "core",
        destDir: workspace.skillsDir,
        cacheDir: workspace.cacheDir,
      },
      reconcileConfig: {
        globalSettingsPath: workspace.globalSettingsPath,
        projectSettingsPath: workspace.projectSettingsPath,
        registryPath: workspace.registryPath,
        backupDir: workspace.backupDir,
        now: () => FIXED_NOW,
      },
      logger,
      syncSkillsFn: vi.fn().mockResolvedValueOnce(success).mockResolvedValueOnce(locked),
    });
    const server = (id: string, target: "global" | "project") => ({
      id,
      command: "node",
      args: [`${id}.mjs`],
      target,
    });

    // Cycle 1, sync works: one server in each settings file.
    await handler(
      createManifest(workspace, {
        bundles: {
          core: {
            version: "v1.0.0",
            mcpServers: [server("joyus:in-global", "global"), server("joyus:in-project", "project")],
          },
        },
      }),
    );

    // The project file is damaged, and the next manifest revokes both servers.
    await writeFile(workspace.projectSettingsPath, "{ broken", "utf8");
    await expect(
      handler(createManifest(workspace, { bundles: { core: { version: "v1.0.0" } } })),
    ).rejects.toThrow("managed tooling update incomplete (skill sync failed, reconcile failed)");

    // The global revocation landed. The damaged file was left alone and is reported.
    expect(await readJson(workspace.globalSettingsPath)).toEqual({});
    expect(await readFile(workspace.projectSettingsPath, "utf8")).toBe("{ broken");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("configCheckWiring: reconcile failed: "),
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(workspace.projectSettingsPath),
    );
  });
```

**5d.** In `apps/desktop-companion/test/sidecar/mainConfigCheckWiring.test.ts`, in the test "passes optional managed-tooling config through and logs handler warnings and errors", replace the statement `await capturedOnSync?.({ ... });` (eight lines, from `await capturedOnSync?.({` to its closing `});`) with:

<!-- block: main-reject -->

```ts
    await expect(
      capturedOnSync?.({
        schema_version: "1.0",
        tenant_id: "tenant-1",
        bundles: {
          "bundle-a": { version: "v1.0.0" },
          "bundle-b": { version: "v2.0.0" },
        },
      }),
    ).rejects.toThrow("managed tooling update incomplete (skill sync failed, reconcile ok)");
```

**Verify**:
1. `HOME="$SAFE_HOME" pnpm vitest run apps/desktop-companion/test/sidecar/configCheckWiring.test.ts apps/desktop-companion/test/sidecar/mainConfigCheckWiring.test.ts apps/desktop-companion/test/sidecar/configCheckPoller.test.ts` → 57 + 5 + 21 pass.
2. `ls -A "$SAFE_HOME"` → must not list `.claude`. (`.joyus` may be there; see Step 1.) If `.claude` is listed, a test reached the real default paths: STOP and report which handler has neither a mocked `reconcileFn` nor a full set of temp paths.
3. `git status --short` → no file outside the in-scope list, and in particular nothing under `.claude/`.

### Step 6: Run the full gates

Run `pnpm typecheck`, then `HOME="$SAFE_HOME" pnpm coverage`.

**Verify**: both exit 0, and the coverage summary shows 100% for `configCheckWiring.ts` and `reconciler.ts`. If a branch is uncovered in code this plan added, STOP and report it: the reference run showed 100% for both files, so a gap means the code or the tests differ from this plan. Do not add a `v8 ignore` comment. `ls -A "$SAFE_HOME"` → still no `.claude`. Commit (commit 3).

## Test plan

- Reconciler helpers: two new tests (`removeRevokedHooks`, `removeRevokedMcpServers`).
- Reconciler, removals-only, through real files, fifteen new tests. They cover: revoked entries are removed from both files and nothing is added; a still-listed entry whose command changed is left byte for byte; an MCP server whose target changed stays put, a revoked one beside it is removed, and a later full reconcile moves the first; the same for a `joyus:` group whose matcher changed; the same for a hook whose event changed and one whose real matcher changed; a place that a still-listed hook uses is kept together with its ownership record; an entry from before the matcher field, a user-owned entry and an entry without the reserved prefix; a missing registry file; a registry write that fails; one unreadable file, in each direction; both files unreadable; a file with nothing to remove; a copy of a revoked command that the user added before it; a registry that cannot be rebuilt; a rollback that fails.
- Wiring: ten existing tests edited by the table in Step 5; five new handler tests (locked sync with no earlier manifest; configured paths passed through; retry after sync recovers; the earlier-manifest fallback, with and without an earlier manifest); two new integration tests through the real reconciler (a target change under a locked sync; a broken project file under a locked sync).
- One test in `mainConfigCheckWiring.test.ts` moved to temp paths and changed to expect the rejection.
- Verification: the commands in Steps 1, 2, 3, 5 and 6.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm vitest run packages/settings-reconciler` exits 0 with 174 tests
- [ ] `HOME="$SAFE_HOME" pnpm vitest run apps/desktop-companion/test/sidecar/configCheckWiring.test.ts apps/desktop-companion/test/sidecar/mainConfigCheckWiring.test.ts` exits 0 with 62 tests, and `ls -A "$SAFE_HOME"` does not list `.claude` afterward
- [ ] `HOME="$SAFE_HOME" pnpm coverage` exits 0
- [ ] `grep -c 'hasRevocation\|getManagedEntryIds\|shouldAttemptReconcile' apps/desktop-companion/src/sidecar/configCheckWiring.ts` prints 0
- [ ] `grep -c 'removalsOnly' apps/desktop-companion/src/sidecar/configCheckWiring.ts` prints 1
- [ ] `grep -c 'removalsOnly' packages/settings-reconciler/src/reconciler.ts` prints 2
- [ ] `grep -c '"/tmp/global-settings.json"' apps/desktop-companion/test/sidecar/mainConfigCheckWiring.test.ts` prints 0
- [ ] `git diff --stat ec00055 -- apps/desktop-companion/src/sidecar/configCheckPoller.ts apps/desktop-companion/src/sidecar/main.ts packages/skill-sync` prints nothing
- [ ] `git status --short` lists only the in-scope files
- [ ] `plans/README.md` status row for 013 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Commit `ec00055` is not an ancestor of `HEAD`, or plan 012 has not landed as written (drift check 3).
- The handler, `main.ts` or the reconciler code does not match the excerpts in "Current state".
- After Step 2, an existing reconciler test fails. The full reconcile path must not change.
- `ls -A "$SAFE_HOME"` lists `.claude` at any point.
- An existing wiring test fails after Step 5 and the table does not cover it. Report the test name and the failing assertion; do not delete the test or loosen it.
- One of the three existing tests in `describe("createConfigChangeHandler integration")` fails. Those run the real sync mock and the real reconcile on temp paths with a successful sync, and must be unaffected.
- A test outside the three test files named in the commands fails.
- You find yourself changing `configCheckPoller.ts`, `main.ts` or any file under `packages/skill-sync/`.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

What removals-only mode still gets wrong, stated plainly:

- **An empty manifest revokes everything.** A manifest with `bundles: {}` is valid. It skips the sync and runs a full reconcile, which removes every managed hook and server. That is how an organization withdraws everything at once. It also means a faulty manifest server that answers with a valid, empty manifest wipes the managed tooling; the entries come back with the next good manifest once a sync succeeds. The maintainer decided on 2026-11-18 to keep this behavior and state the risk.
- **One file can still be stuck.** Each settings file is handled on its own, so a damaged project file no longer blocks a revocation in the global file. The revocations that belong to the damaged file itself wait until someone repairs it. The handler rejects on every cycle until then, and logs the path.
- **Only removals-only mode is per file.** A full reconcile is still one transaction: if either file cannot be read, nothing is installed, updated or removed in the other. The default project path is `.claude/settings.json` relative to the sidecar's working directory.

- **A changed command is not a revocation.** If the manifest keeps an id and replaces its command, the old command keeps running until a sync succeeds. Removals-only never updates. To withdraw a command at once, the manifest must drop the id.
- **One id on two events.** If a manifest lists the same hook id under two events and later drops one of them, removals-only keeps both, because the id is still listed. The next full reconcile removes the dropped one. This is the price of keeping a hook whose event merely changed.
- **Old-format entries whose id differs from their matcher.** Entries written before plan 012, and entries rebuilt after the registry file was lost, are keyed by matcher. Removals-only treats that matcher as the id. If the manifest lists the hook under a different id, the group is still kept as long as some listed hook declares the same event and matcher. If the manifest *also* changed that matcher in the same update, the group is removed early and comes back with the next full reconcile.
- **Nothing the registry does not record.** A `joyus:` group or server that is in settings but not in the registry is left alone in removals-only mode. A full reconcile still removes those by prefix. A tool-scoped hook whose registry record was lost is never removed (plan 012's limit).
- **Kept entries are not counted.** When a revoked entry is kept because its place is still in use, `entriesRemoved` does not count it, and its registry entry stays until the next full reconcile.

About the handler:

- **Retry cadence.** An incomplete cycle is retried every poll interval (5 minutes by default) for as long as it stays incomplete, and each retry runs a removals-only reconcile and rewrites the tenant config. `main.ts` prints the rejection as `configCheckWiring: poll failed: ...`.
- **Permanent problems log on every tick.** Two known ones: a manifest with several bundle versions and no `SKILL_SYNC_BUNDLE`; and a configured bundle that is missing from a manifest that still has other bundles, when no earlier manifest is in memory (after a restart). In both, revocations are applied but nothing is ever added. The second is pinned by the test "keeps retrying when the configured bundle is missing and no earlier manifest is known". Whether a missing configured bundle should count as "nothing to sync" is a product decision this plan does not take.
- **A `skipped` reconcile counts as done.** `reconcile` returns `skipped` for an unsupported manifest schema version. The handler does not retry that.
- **Stale lock.** `@joyus/skill-sync` takes a lock file with no owner or timestamp. After a crash, sync returns `locked` forever. With this plan, revocations still go through, but additions stay blocked until the lock is removed. Fixing the lock is a separate plan.
- **Skill files are not removed.** When a bundle is revoked, its hooks and MCP servers leave `settings.json`, but the synced skill files stay on disk.
- **`initialManifest` / `lastManifest`** are now used only as a fallback for the sync target version when the configured bundle is missing from the new manifest.
- **Manifest transport.** `ec00055` withholds the API token from a non-https manifest URL but still fetches the manifest. Whoever controls that response can install shell commands as hooks. Requiring https (or loopback) for the manifest URL is a recorded open question.
- **An older leak this plan does not fix.** `mainConfigCheckWiring.test.ts` creates `~/.joyus/session-manager.db` in the real home directory, because `startSidecar` wires the real session manager. Recorded in `plans/README.md`.
- Reviewer focus: no test may construct a handler that can reach the real reconciler with default paths; the handler must reject whenever either half did not complete; and `removalsOnlyMode` must never remove anything under an id the manifest still lists.
