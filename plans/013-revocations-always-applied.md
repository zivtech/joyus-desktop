# Plan 013: A revocation is applied even when skill sync fails, and an unfinished update is retried

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> 1. `git merge-base --is-ancestor ec00055 HEAD && echo present` must print `present`. This plan was written against `origin/main` commit `ec00055`, which added token handling to the files below. If it prints nothing, STOP: update the branch first.
> 2. `git diff --stat ec00055..HEAD -- apps/desktop-companion/src/sidecar/configCheckWiring.ts apps/desktop-companion/src/sidecar/configCheckPoller.ts apps/desktop-companion/test/sidecar/configCheckWiring.test.ts`
>    If any of these changed, compare the "Current state" excerpts against the live code; on a mismatch, treat it as a STOP condition.
> 3. `packages/settings-reconciler/` WILL have changed, because plans 009 and 012 land first. That is expected.

## Status

- **Priority**: P2 (the code is wired into the sidecar but only runs when `JOYUS_MANAGED_TOOLING_MANIFEST_URL` and `SKILL_SYNC_REPO_URL` are set)
- **Effort**: M
- **Risk**: MED (rewrites the control flow of one function and about ten of its tests)
- **Depends on**: plans/007, plans/008, plans/009, plans/012-managed-hooks-with-real-matchers.md
- **Category**: bug, security
- **Planned at**: commit `ec00055` (`origin/main`), 2026-11-17

## Why this matters

The sidecar polls a remote manifest that lists the hooks and MCP servers an organization manages on this machine. When the manifest changes, a handler (1) syncs skill files from a git repository, then (2) "reconciles": it edits the user's Claude Code `settings.json` to add, update and remove managed entries. Removing an entry that the manifest dropped is a **revocation**. It is how an organization withdraws a hook or MCP server, for example one found to be harmful.

Today the handler skips step 2 whenever step 1 does not succeed:

- If skill sync returns anything other than `success` or `offline` (for example `locked`), or throws, reconcile is skipped, even when the manifest revokes entries.
- If skill sync is `offline`, reconcile runs only when a revocation is detected by comparing with the previous manifest. That previous manifest is held in memory. After a restart there is none, so the comparison finds nothing unless the new manifest is completely empty.
- The handler never throws. The poller therefore records the manifest as handled, and does not call the handler again until the manifest content changes. A skipped revocation is never retried. A skipped installation is never retried either.

So a revocation that arrives while the git host is unreachable, or while a stale lock file exists, is silently lost.

Removing an entry never needs the skill files. Only adding or updating does, because a new hook's command may point at a script that sync has not delivered yet.

After this plan: every cycle applies removals. Additions and updates are applied only after a successful sync. If either part did not complete, the handler rejects, and the poller, which already supports this, retries on its next tick.

## Current state

### The handler

`apps/desktop-companion/src/sidecar/configCheckWiring.ts`. Helper functions near the top (lines 59–141):

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
  // ... compares bundle names and entry ids of the two manifests
}
```

`resolveTargetVersion` and `resolveSyncTargetVersion` follow and are not changed by this plan.

The handler body, inside `createConfigChangeHandler` (lines 172–261):

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

`reconcileFn` defaults to the real `reconcile` from `@joyus/settings-reconciler`, and `config.reconcileConfig` is optional. With no config, the real `reconcile` edits `~/.claude/settings.json`. **This matters for the tests: see Step 4.**

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

`packages/settings-reconciler/src/reconciler.ts`. After plans 009 and 012, these pieces exist:

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

```ts
function collectOwnedHooks(registry: ManagedRegistry, target: SettingsTarget): OwnedHook[] {
  const owned: OwnedHook[] = [];

  for (const entry of Object.values(registry.entries)) {
    if (
      entry.type === "hook" &&
      entry.target === target &&
      entry.event !== undefined &&
      entry.matcher !== undefined &&
      entry.command !== undefined
    ) {
      owned.push({ event: entry.event, matcher: entry.matcher, command: entry.command });
    }
  }

  return owned;
}
```

Inside `reconcileSettingsTarget` (its options include `hooks`, `mcps` and `ownedHooks`):

```ts
  const nextHooks = removeStaleHooks(
    mergeHooks(currentHooks, options.hooks),
    options.hooks,
    options.ownedHooks
  );
  const nextMcpServers = removeStaleMcpServers(
    mergeMcpServers(currentMcpServers, options.mcps),
    buildActiveMcpIds(options.mcps)
  );
```

Inside `reconcile()`, after both settings files are updated:

```ts
    const nextRegistry = buildNewRegistry(manifest, currentRegistry, now);
    const counts = computeCounts(currentRegistry, nextRegistry);

    await writeRegistry(registryPath, nextRegistry);
```

`buildNewRegistry` is a pure function: it returns the registry that a full reconcile of `manifest` would produce, with keys `hook:<event>:<id>` and `mcp:<id>`.

### The tests

`apps/desktop-companion/test/sidecar/configCheckWiring.test.ts` (1,556 lines). `describe("createConfigChangeHandler failure isolation")` has 13 tests that pin the current gating. Two examples of the current expectations:

```ts
  it("skips reconcile on offline sync when there is no revocation, but still writes tenant config", async () => {
    const reconcileFn = vi.fn().mockResolvedValue(createReconcileResult());
    // ... handler built with syncSkillsFn returning { status: "offline", ... } and bundleName: "core"
    await handler({
      schema_version: "1.0",
      tenant_id: "tenant-1",
      bundles: { core: { version: "v1.0.0", config: { enabled: true } } },
    });

    expect(reconcileFn).not.toHaveBeenCalled();
```

```ts
  it("uses the default logger and non-Error string formatting paths without throwing", async () => {
    const handler = createConfigChangeHandler({
      syncConfig: { repoUrl: "file:///repo.git", bundleName: "core", destDir: "/tmp/skills", cacheDir: "/tmp/cache" },
      syncSkillsFn: vi.fn().mockRejectedValue("string failure"),
      writeTenantConfigFn: vi.fn().mockResolvedValue(undefined),
    });

    await expect(
      handler({ schema_version: "1.0", tenant_id: "tenant-1", bundles: { core: { version: "v1.0.0" } } }),
    ).resolves.toBeUndefined();
  });
```

The second example passes **no `reconcileFn`**. It is safe today only because a failed sync skips reconcile.

The helper that builds a reconcile result for mocks:

```ts
function createReconcileResult(
  status: ReconcileResult["status"] = "success",
  registryPath = "/tmp/registry.json",
  error?: string,
): ReconcileResult {
```

Repo conventions: TypeScript strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Vitest. Coverage must stay at 100% lines, functions, branches and statements, so helper functions that become unused must be deleted, not left behind.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Reconciler tests | `pnpm vitest run packages/settings-reconciler` | all pass |
| Wiring tests, under a throwaway home directory | `HOME="$SAFE_HOME" pnpm vitest run apps/desktop-companion/test/sidecar/configCheckWiring.test.ts` | all pass |
| Full coverage gate | `pnpm coverage` | exit 0, thresholds met |

Never run `pnpm ci` (that is clean-install in pnpm). The full pipeline is `pnpm run ci`.

Known flaky tests, unrelated to this plan: `apps/desktop-companion/test/ui/SessionsPage.test.ts` ("clears mode note timers…"), `apps/desktop-companion/test/ui/components/LocalSiteCard.test.ts`, and a timing-dependent coverage gap in `ReconSetup.tsx`. If `pnpm coverage` fails only in one of those, rerun it once. If it fails again, treat it as a STOP condition.

## Scope

**In scope** (the only files you should modify):
- `packages/settings-reconciler/src/reconciler.ts`
- `packages/settings-reconciler/test/reconciler.test.ts`
- `apps/desktop-companion/src/sidecar/configCheckWiring.ts` (the helpers and handler quoted above only)
- `apps/desktop-companion/test/sidecar/configCheckWiring.test.ts`
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch, even though they look related):
- `configCheckPoller.ts`. Its retry behavior is already what this plan needs.
- Everything in `configCheckWiring.ts` below the handler: `createAuthenticatedFetch`, `getTokenWithholdReason`, `resolveManifestFetch`, `resolveSidecarManagedToolingConfigFromEnv`. Do not add an https requirement for the manifest URL here; that is a recorded open question for the maintainer.
- `packages/skill-sync/`. Stale lock files and repository URL changes are a separate plan. This plan makes revocations independent of them.
- Removing synced skill files when a bundle is revoked. Not handled anywhere today; not added here.
- `apps/desktop-companion/src/sidecar/main.ts`.

## Git workflow

- Branch: `fix/013-revocations-always-applied`
- Two commits: (1) `feat: add a removals-only mode to the settings reconciler`, (2) `fix: apply revocations when skill sync fails and retry unfinished updates`. Conventional commits, matching `git log`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a removals-only mode to `reconcile`

All edits in `packages/settings-reconciler/src/reconciler.ts`.

**1a.** Add one property to `ReconcileConfig`, after `maxBackups`:

```ts
  /**
   * When true, only remove entries the manifest no longer lists. Nothing is
   * added or updated in settings, and surviving registry entries are kept
   * exactly as they were.
   */
  readonly removalsOnly?: boolean;
```

**1b.** Replace `collectOwnedHooks` with a version that can skip entries that are still active:

```ts
function collectOwnedHooks(
  registry: ManagedRegistry,
  target: SettingsTarget,
  skipKeys: ReadonlySet<string>
): OwnedHook[] {
  const owned: OwnedHook[] = [];

  for (const [key, entry] of Object.entries(registry.entries)) {
    if (
      !skipKeys.has(key) &&
      entry.type === "hook" &&
      entry.target === target &&
      entry.event !== undefined &&
      entry.matcher !== undefined &&
      entry.command !== undefined
    ) {
      owned.push({ event: entry.event, matcher: entry.matcher, command: entry.command });
    }
  }

  return owned;
}
```

`skipKeys` is a required parameter on purpose. A default value would be a branch that no caller exercises, and the coverage gate would fail.

**1c.** Directly below `buildNewRegistry`, add:

```ts
/** The current registry without the entries whose keys are no longer active. */
function pruneRegistry(
  currentRegistry: ManagedRegistry,
  activeKeys: ReadonlySet<string>,
  now: () => Date
): ManagedRegistry {
  const entries: Record<string, RegistryEntry> = {};

  for (const [key, entry] of Object.entries(currentRegistry.entries)) {
    if (activeKeys.has(key)) {
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

**1d.** In `reconcileSettingsTarget`, add `removalsOnly: boolean;` to the options type, and replace the two computations quoted in "Current state" with:

```ts
  const nextHooks = removeStaleHooks(
    options.removalsOnly ? currentHooks : mergeHooks(currentHooks, options.hooks),
    options.hooks,
    options.ownedHooks
  );
  const nextMcpServers = removeStaleMcpServers(
    options.removalsOnly
      ? currentMcpServers
      : mergeMcpServers(currentMcpServers, options.mcps),
    buildActiveMcpIds(options.mcps)
  );
```

**1e.** In `reconcile()`, directly after the `partitionByTarget(...)` statement, add:

```ts
  const removalsOnly = config?.removalsOnly === true;
  const fullRegistry = buildNewRegistry(manifest, currentRegistry, now);
  const activeKeys = new Set(Object.keys(fullRegistry.entries));
  // In removals-only mode an entry that is still listed must not be touched,
  // even if the manifest changed its command. Only entries whose key is gone
  // count as owned-and-removable.
  const skipKeys: ReadonlySet<string> = removalsOnly ? activeKeys : new Set();
```

In both `reconcileSettingsTarget({...})` calls, add `removalsOnly,` and change the `ownedHooks` line to pass the third argument:

```ts
      ownedHooks: collectOwnedHooks(currentRegistry, "global", skipKeys),
```

(and `"project"` in the second call).

Replace the line `const nextRegistry = buildNewRegistry(manifest, currentRegistry, now);` with:

```ts
    const nextRegistry = removalsOnly
      ? pruneRegistry(currentRegistry, activeKeys, now)
      : fullRegistry;
```

**Verify**: `pnpm typecheck` → exit 0. `pnpm vitest run packages/settings-reconciler` → all existing tests pass unchanged.

### Step 2: Test the removals-only mode

At the end of `describe("reconcile")` in `packages/settings-reconciler/test/reconciler.test.ts`, add:

```ts
  it("removalsOnly removes revoked entries and adds nothing", async () => {
    const workspace = await createWorkspace();
    const installedAt = "2026-03-01T00:00:00.000Z";
    const userHook = { type: "command", command: "echo user-bash" };

    await writeJson(workspace.globalSettingsPath, {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [userHook, { type: "command", command: "echo revoked", timeout: 5 }],
          },
        ],
      },
      mcpServers: {
        "joyus:old-mcp": { command: "node" },
        "user-mcp": { command: "python" },
      },
    });
    await writeJson(workspace.registryPath, {
      schema_version: "1.0",
      entries: {
        "hook:PreToolUse:joyus:revoked": {
          type: "hook",
          bundle: "core",
          manifest_version: "1.0.0",
          event: "PreToolUse",
          matcher: "Bash",
          command: "echo revoked",
          target: "global",
          installed_at: installedAt,
        },
        "mcp:joyus:old-mcp": {
          type: "mcp",
          bundle: "core",
          manifest_version: "1.0.0",
          target: "global",
          installed_at: installedAt,
        },
      },
      last_reconciled: installedAt,
    });

    // The new manifest lists only brand-new entries.
    const result = await reconcile(
      createManifest({
        hooks: [createHook({ id: "joyus:new", matcher: "Edit", command: "echo new" })],
        mcps: [createMcp({ id: "joyus:new-mcp" })],
      }),
      { ...createConfig(workspace), removalsOnly: true }
    );

    expect(result).toMatchObject({
      status: "success",
      entriesAdded: 0,
      entriesUpdated: 0,
      entriesRemoved: 2,
    });
    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [userHook] }] },
      mcpServers: { "user-mcp": { command: "python" } },
    });
    const registry = (await readJson(workspace.registryPath)) as { entries: Record<string, unknown> };
    expect(registry.entries).toEqual({});
  });

  it("removalsOnly leaves a still-listed entry exactly as installed", async () => {
    const workspace = await createWorkspace();
    const installedAt = "2026-03-01T00:00:00.000Z";
    const settings = {
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "echo audit", timeout: 5 }] },
        ],
      },
    };
    const entry = {
      type: "hook",
      bundle: "core",
      manifest_version: "1.0.0",
      event: "PreToolUse",
      matcher: "Bash",
      command: "echo audit",
      target: "global",
      installed_at: installedAt,
    };

    await writeJson(workspace.globalSettingsPath, settings);
    await writeJson(workspace.registryPath, {
      schema_version: "1.0",
      entries: { "hook:PreToolUse:joyus:audit": entry },
      last_reconciled: installedAt,
    });

    // Same id, new command and version: a full reconcile would update it.
    const result = await reconcile(
      createManifest({
        version: "2.0.0",
        hooks: [createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit v2" })],
      }),
      { ...createConfig(workspace), removalsOnly: true }
    );

    expect(result).toMatchObject({
      status: "success",
      entriesAdded: 0,
      entriesUpdated: 0,
      entriesRemoved: 0,
    });
    expect(result.backupPath).toBeUndefined();
    expect(await readJson(workspace.globalSettingsPath)).toEqual(settings);
    const registry = (await readJson(workspace.registryPath)) as { entries: Record<string, unknown> };
    expect(registry.entries).toEqual({ "hook:PreToolUse:joyus:audit": entry });
  });
```

**Verify**: `pnpm vitest run packages/settings-reconciler` → all pass, including the two new tests. Commit (commit 1).

### Step 3: Rewrite the handler

In `apps/desktop-companion/src/sidecar/configCheckWiring.ts`:

**3a.** Delete the `getManagedEntryIds` and `hasRevocation` functions. Keep `getBundleNames`.

**3b.** Replace the returned async function (everything from `return async (manifest: DistributionManifest): Promise<void> => {` to its closing `};`) with:

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
    // every cycle. Additions and updates wait for a successful sync.
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

**Verify**: `pnpm typecheck` → exit 0. Do NOT run the wiring tests yet.

### Step 4: Update the wiring tests, under a throwaway home directory

**Read this first.** After Step 3, reconcile runs on every cycle. Any test that builds a handler without `reconcileFn` and without a `reconcileConfig` that points at temp paths will now run the real reconciler against `~/.claude/settings.json`. To make that impossible while you work, create a throwaway home and use it for every run of this test file:

```bash
export SAFE_HOME="$(mktemp -d)"
```

Then always run: `HOME="$SAFE_HOME" pnpm vitest run apps/desktop-companion/test/sidecar/configCheckWiring.test.ts`

Apply these rules to `describe("createConfigChangeHandler failure isolation")`. Do not change the three tests in `describe("createConfigChangeHandler integration")` unless one fails; they use real temp paths and successful syncs.

- **Rule A — every handler gets a mocked reconcile.** In every test in this `describe` block, if the object passed to `createConfigChangeHandler` has no `reconcileFn`, add `reconcileFn: vi.fn().mockResolvedValue(createReconcileResult()),`. This includes "uses the default logger and non-Error string formatting paths without throwing".
- **Rule B — an incomplete cycle rejects.** If the test's `syncSkillsFn` does not resolve with `status: "success"` (it returns `offline`, `locked` or another status, or rejects), or its `reconcileFn` resolves with `rolled_back` or `error`, or rejects, or no target version can be resolved for a manifest that has bundles, then the handler call must be asserted as a rejection. Replace `await handler(<manifest>);` with:

```ts
    await expect(handler(<manifest>)).rejects.toThrow("managed tooling update incomplete");
```

  Keep every `logger.error` / `logger.warn` / `writeTenantConfigFn` assertion that follows; those calls still happen before the rejection. For a test that already uses `await expect(handler(...)).resolves.toBeUndefined()` and falls under this rule, change it to the `rejects` form. In a test that calls the handler more than once, apply the rule to each call separately.
- **Rule C — reconcile is no longer skipped.** Replace each `expect(reconcileFn).not.toHaveBeenCalled();` with an assertion that it ran in removals-only mode:

```ts
    expect(reconcileFn).toHaveBeenCalledOnce();
    expect(reconcileFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ removalsOnly: true }),
    );
```

- **Rule D — an empty manifest skips sync silently.** In "reconciles an initial empty manifest when no target version can be resolved", delete the `expect(logger.warn).toHaveBeenCalledWith(...)` assertion (three lines) and add `expect(logger.warn).not.toHaveBeenCalled();`. The handler call in this test still resolves.
- **Renames.** Rename tests whose titles no longer describe them. At minimum:
  - "skips reconcile on offline sync when there is no revocation, but still writes tenant config" → "runs a removals-only reconcile when sync is offline, writes tenant config, and rejects so the poller retries"
  - "logs ambiguous version resolution and skips reconcile unless the manifest is a revocation" → "logs ambiguous version resolution, runs a removals-only reconcile, and rejects"
  - "uses the default logger and non-Error string formatting paths without throwing" → "uses the default logger and non-Error string formatting paths"

Then add three tests at the end of that `describe` block:

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
        version: "v1.0.0",
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
```

If the sync result objects in the existing tests have a different shape from the ones above, copy the shape used by the existing tests in this file.

**Verify**:
1. `HOME="$SAFE_HOME" pnpm vitest run apps/desktop-companion/test/sidecar/configCheckWiring.test.ts` → all pass.
2. `ls -A "$SAFE_HOME"` → prints nothing. If it lists `.claude` or anything else, a test reached the real default paths: find the handler that lacks `reconcileFn` (Rule A) and fix it, delete the contents of `$SAFE_HOME`, and rerun both checks.
3. `grep -c 'not.toHaveBeenCalled' apps/desktop-companion/test/sidecar/configCheckWiring.test.ts` — every remaining match must be about something other than `reconcileFn` being skipped because of a sync failure. Read each one.

### Step 5: Run the full gates

Run `pnpm typecheck`, then `pnpm coverage` (with your normal `HOME`; Step 4 proved the wiring tests stay inside temp paths).

**Verify**: both exit 0, and the coverage summary shows 100% for `configCheckWiring.ts` and `reconciler.ts`. If a branch in the handler is uncovered, add a focused test for it; do not add a `v8 ignore` comment. Commit (commit 2).

## Test plan

- Reconciler: two new tests for removals-only mode (revoked entries removed and nothing added; a still-listed entry left byte-for-byte as installed).
- Wiring: about ten existing tests updated by Rules A–D; three new tests (locked sync with no previous manifest still removes; configured reconcile paths are passed through; a retry after sync recovers performs a full reconcile and resolves).
- Structural pattern: the existing tests in `describe("createConfigChangeHandler failure isolation")`.
- Verification: the commands in Steps 2, 4 and 5.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm vitest run packages/settings-reconciler` exits 0
- [ ] `HOME="$SAFE_HOME" pnpm vitest run apps/desktop-companion/test/sidecar/configCheckWiring.test.ts` exits 0, and `ls -A "$SAFE_HOME"` prints nothing afterward
- [ ] `pnpm coverage` exits 0
- [ ] `grep -c 'hasRevocation\|getManagedEntryIds\|shouldAttemptReconcile' apps/desktop-companion/src/sidecar/configCheckWiring.ts` prints 0
- [ ] `grep -c 'removalsOnly' apps/desktop-companion/src/sidecar/configCheckWiring.ts` prints 1
- [ ] `grep -c 'removalsOnly' packages/settings-reconciler/src/reconciler.ts` prints 6 or more
- [ ] `git diff --stat main..HEAD -- apps/desktop-companion/src/sidecar/configCheckPoller.ts packages/skill-sync` prints nothing
- [ ] `git status --short` lists only the in-scope files
- [ ] `plans/README.md` status row for 013 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Commit `ec00055` is not an ancestor of `HEAD`, or plan 012 has not landed (`grep -c 'collectOwnedHooks' packages/settings-reconciler/src/reconciler.ts` prints 0).
- The handler or the reconciler code does not match the excerpts in "Current state".
- `ls -A "$SAFE_HOME"` shows files and you cannot find which test created them.
- An existing wiring test fails and none of Rules A–D explains the change it needs. Report the test name and the failing assertion; do not delete the test or loosen it.
- A test in `describe("createConfigChangeHandler integration")` fails. Those run the real sync and reconcile on temp paths with a successful sync, and should be unaffected.
- A test outside these two test files fails (for example `mainConfigCheckWiring.test.ts` or the poller tests).
- You find yourself changing `configCheckPoller.ts` or any file under `packages/skill-sync/`.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- **Retry cadence.** An incomplete cycle is retried every poll interval (5 minutes by default) for as long as it stays incomplete. A permanent problem, such as a manifest with several bundle versions and no `SKILL_SYNC_BUNDLE`, therefore logs on every tick. `main.ts` prints the rejection as `configCheckWiring: poll failed: ...`.
- **Stale lock.** `@joyus/skill-sync` takes a lock file with no owner or timestamp. After a crash, sync returns `locked` forever. With this plan, revocations still go through, but additions stay blocked until the lock is removed. Fixing the lock is a separate plan.
- **Skill files are not removed.** When a bundle is revoked, its hooks and MCP servers leave `settings.json`, but the synced skill files stay on disk.
- **`initialManifest` / `lastManifest`** are now used only as a fallback for the sync target version when the configured bundle is missing from the new manifest.
- **Manifest transport.** `ec00055` withholds the API token from a non-https manifest URL but still fetches the manifest. Whoever controls that response can install shell commands as hooks. Requiring https (or loopback) for the manifest URL is a recorded open question.
- Reviewer focus: no test in the wiring file may construct a handler that can reach the real reconciler with default paths, and the handler must reject whenever either half did not complete.
