# Plan 012: Managed hooks can use real matchers without overwriting the user's hooks, and revoked ones are removed

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat cea62f6..HEAD -- packages/settings-reconciler/`
> Plan 009 must land before this one, so `settingsFile.ts`, `reconciler.ts`
> (one line, the settings read inside `reconcileSettingsTarget`) and the two
> test files WILL show changes. That is expected. What must still match is
> the code quoted in "Current state" below. On a mismatch there, treat it as
> a STOP condition.

## Status

- **Priority**: P2 (the code is wired into the sidecar but only runs when `JOYUS_MANAGED_TOOLING_MANIFEST_URL` and `SKILL_SYNC_REPO_URL` are set)
- **Effort**: M
- **Risk**: MED (changes how a user's `~/.claude/settings.json` is edited)
- **Depends on**: plans/007-correct-agent-and-contributor-docs.md, plans/008-make-recon-tests-hermetic.md, plans/009-never-rewrite-unreadable-settings.md
- **Category**: bug, security
- **Planned at**: commit `cea62f6`, 2026-11-17

## Why this matters

`@joyus/settings-reconciler` installs "managed" hooks from a remote manifest into the user's Claude Code `settings.json`, and removes them when the manifest drops them (a revocation).

In Claude Code, hooks for an event are stored as groups: `{ "matcher": "...", "hooks": [ { "type": "command", "command": "..." } ] }`. The `matcher` is functional. For `PreToolUse`, `PostToolUse`, `PostToolUseFailure` and `PermissionRequest` it is compared with the tool name (`"Bash"`, `"Edit|Write"`). For `SessionStart` it is compared with how the session started. Only a few events, such as `UserPromptSubmit` and `Stop`, ignore it. (Checked against the Claude Code hooks reference, "Matcher patterns", on 2026-11-17.)

The reconciler uses the `matcher` as its ownership tag. Spec 008 chose this on purpose (`kitty-specs/008-managed-tooling-distribution/research.md`, R1): a managed hook is expected to have a matcher like `joyus:chat-length-guard`. That has two consequences:

1. **A managed hook with a `joyus:` matcher never runs on tool events.** No tool is called `joyus:chat-length-guard`. The spec's own example is a `PreToolUse` hook that would never fire.
2. **A managed hook with a real matcher is unsafe.** The manifest validator accepts any matcher string. If a manifest sends `"matcher": "Bash"`:
   - `mergeHooks` finds the user's existing `Bash` group and replaces the whole group, deleting the user's own hooks.
   - `removeStaleHooks` only removes groups whose matcher starts with `joyus:`, so the hook is never removed when it is revoked.

So today a managed hook either does nothing or cannot be revoked and destroys user configuration.

After this plan, ownership is recorded in the registry file (`~/.claude/.joyus-managed.json`) as the exact event, matcher and command that were written. A managed hook is added inside the matching group next to the user's hooks, and on revocation only that one command is removed. Nothing extra is written into `settings.json`. Groups with a `joyus:` matcher keep working exactly as before.

## Current state

Files (all under `packages/settings-reconciler/`):

- `src/registry.ts` — registry types, read, write, and repair-by-prefix-scan.
- `src/reconciler.ts` — merge, removal, and the `reconcile()` entry point (595 lines).
- `src/index.ts` — package exports.
- `src/manifest.ts` — manifest types and validation. Read-only for this plan.
- `test/reconciler.test.ts` — 895 lines. `describe("pure reconciler helpers")` and `describe("reconcile")`.

A manifest hook (`src/manifest.ts:16-23`). `id` must start with `joyus:`; `matcher` may be any string:

```ts
export interface ManifestHook {
  readonly id: string;
  readonly event: HookEventType;
  readonly matcher: string;
  readonly command: string;
  readonly timeout?: number;
  readonly target?: SettingsTarget;
}
```

A registry entry (`src/registry.ts:21-28`). It records nothing that identifies the hook inside `settings.json`:

```ts
export interface RegistryEntry {
  readonly type: "hook" | "mcp";
  readonly bundle: string;
  readonly manifest_version: string;
  readonly event?: HookEventType;
  readonly target: SettingsTarget;
  readonly installed_at: string;
}
```

The merge and removal functions (`src/reconciler.ts:106-165`):

```ts
function buildCommandHook(hook: ManifestHook): Record<string, unknown> {
  return {
    type: "command",
    command: hook.command,
    timeout: hook.timeout ?? 5,
  };
}

export function mergeHooks(
  currentHooks: Record<string, unknown[]>,
  manifestHooks: readonly ManifestHook[]
): Record<string, unknown[]> {
  const merged = normalizeHooksRecord(currentHooks);

  for (const hook of manifestHooks) {
    const eventGroups = merged[hook.event] ?? [];
    const existingIndex = eventGroups.findIndex(
      (group) => isRecord(group) && group["matcher"] === hook.matcher
    );

    const nextGroup = {
      matcher: hook.matcher,
      hooks: [buildCommandHook(hook)],
    };

    if (existingIndex === -1) {
      merged[hook.event] = [...eventGroups, nextGroup];
      continue;
    }

    const nextGroups = eventGroups.slice();
    nextGroups[existingIndex] = nextGroup;
    merged[hook.event] = nextGroups;
  }

  return merged;
}

export function removeStaleHooks(
  currentHooks: Record<string, unknown[]>,
  activeIds: ReadonlySet<string>
): Record<string, unknown[]> {
  const nextHooks: Record<string, unknown[]> = {};

  for (const [event, groups] of Object.entries(normalizeHooksRecord(currentHooks))) {
    const filteredGroups = groups.filter((group) => {
      if (!isRecord(group) || typeof group["matcher"] !== "string") {
        return true;
      }

      return !group["matcher"].startsWith("joyus:") || activeIds.has(group["matcher"]);
    });

    if (filteredGroups.length > 0) {
      nextHooks[event] = filteredGroups;
    }
  }

  return nextHooks;
}
```

The "active ids" are matchers (`src/reconciler.ts:234-236`):

```ts
function buildActiveHookIds(hooks: readonly ManifestHook[]): ReadonlySet<string> {
  return new Set(hooks.map((hook) => hook.matcher));
}
```

The registry is built with a matcher-based key (`src/reconciler.ts:317-328`, inside `buildNewRegistry`):

```ts
  for (const [bundleName, bundle] of Object.entries(manifest.bundles)) {
    for (const hook of bundle.hooks ?? []) {
      const key = `hook:${hook.event}:${hook.matcher}`;
      entries[key] = {
        type: "hook",
        bundle: bundleName,
        manifest_version: bundle.version,
        event: hook.event,
        target: resolveTarget(hook.target),
        installed_at: currentRegistry.entries[key]?.installed_at ?? reconciledAt,
      };
    }
```

Entry comparison (`src/reconciler.ts:349-358`):

```ts
function registryEntryEquals(left: RegistryEntry, right: RegistryEntry): boolean {
  return (
    left.type === right.type &&
    left.bundle === right.bundle &&
    left.manifest_version === right.manifest_version &&
    left.event === right.event &&
    left.target === right.target &&
    left.installed_at === right.installed_at
  );
}
```

Where the functions are called (`src/reconciler.ts:407-428`). After plan 009 the first line of the body reads `readSettingsFileStrict` instead of `readSettingsFile`; everything else is unchanged:

```ts
async function reconcileSettingsTarget(options: {
  settingsPath: string;
  backupDir: string;
  maxBackups: number;
  now: () => Date;
  hooks: readonly ManifestHook[];
  mcps: readonly ManifestMcpServer[];
}): Promise<SettingsUpdateResult> {
  const currentSettings = await readSettingsFile(options.settingsPath);
  const currentHooksValue = currentSettings["hooks"];
  const currentMcpValue = currentSettings["mcpServers"];
  const currentHooks = normalizeHooksRecord(currentHooksValue);
  const currentMcpServers = normalizeMcpRecord(currentMcpValue);

  const nextHooks = removeStaleHooks(
    mergeHooks(currentHooks, options.hooks),
    buildActiveHookIds(options.hooks)
  );
```

And in `reconcile()` (`src/reconciler.ts:522-559`), `currentRegistry` is loaded before the two calls:

```ts
  const currentRegistry =
    (await readRegistry(registryPath)) ??
    (await repairRegistryFromSettings(globalSettingsPath, projectSettingsPath, now));
  // ...
    globalUpdate = await reconcileSettingsTarget({
      settingsPath: globalSettingsPath,
      backupDir: join(backupDir, "global"),
      maxBackups,
      now,
      hooks: partition.global.hooks,
      mcps: partition.global.mcps,
    });

    projectUpdate = await reconcileSettingsTarget({
      settingsPath: projectSettingsPath,
      backupDir: join(backupDir, "project"),
      maxBackups,
      now,
      hooks: partition.project.hooks,
      mcps: partition.project.mcps,
    });
```

The exports (`src/index.ts`, the reconciler block):

```ts
export {
  reconcile,
  mergeHooks,
  removeStaleHooks,
  mergeMcpServers,
  removeStaleMcpServers,
  partitionByTarget,
} from "./reconciler.js";

export type { ReconcileConfig, ReconcileResult, ReconcileStatus } from "./reconciler.js";
```

Test fixtures you will reuse (`test/reconciler.test.ts`). In every existing fixture the hook `id` equals its `matcher`, which is why the registry keys in existing tests do not change under this plan:

```ts
function createHook(overrides: Partial<ManifestHook> = {}): ManifestHook {
  return {
    id: "joyus:hook",
    event: "PreToolUse",
    matcher: "joyus:hook",
    command: "echo global hook",
    ...overrides,
  };
}
```

`createWorkspace()` returns temp paths (`globalSettingsPath`, `projectSettingsPath`, `registryPath`, `backupDir`, `now`), `createConfig(workspace)` turns them into a `ReconcileConfig`, `createManifest({ hooks, mcps, version })` builds a one-bundle manifest named `core`, and `writeJson` / `readJson` write and read JSON files.

The existing removal test that must change its call (`test/reconciler.test.ts:154-181`):

```ts
    const result = removeStaleHooks(
      {
        PreToolUse: [userGroup, activeGroup, staleGroup],
        SessionEnd: [staleGroup],
      },
      new Set(["joyus:keep"])
    );
```

The existing no-op test whose seeded registry must gain two fields (`test/reconciler.test.ts:336-347`):

```ts
    await writeJson(workspace.registryPath, {
      schema_version: "1.0",
      entries: {
        "hook:PreToolUse:joyus:hook": {
          type: "hook",
          bundle: "core",
          manifest_version: "1.0.0",
          event: "PreToolUse",
          target: "global",
          installed_at: installedAt,
        },
```

Repo conventions: TypeScript strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` (never assign `undefined` to an optional property; leave the property out). Functions return new objects and do not mutate their inputs. Vitest. Coverage must stay at 100% lines, functions, branches and statements.

The new `mergeHooks` and `removeStaleHooks` bodies in Step 2 were run outside the repo on 2026-11-17 against the cases in Step 4 and passed. Copy them exactly.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Package tests | `pnpm vitest run packages/settings-reconciler` | all pass |
| Wiring tests (a consumer of this package) | `pnpm vitest run apps/desktop-companion/test/sidecar/configCheckWiring.test.ts` | all pass |
| Full coverage gate | `pnpm coverage` | exit 0, thresholds met |

Never run `pnpm ci` (that is clean-install in pnpm). The full pipeline is `pnpm run ci`.

Known flaky tests, unrelated to this plan: `apps/desktop-companion/test/ui/SessionsPage.test.ts` ("clears mode note timers…"), `apps/desktop-companion/test/ui/components/LocalSiteCard.test.ts`, and a timing-dependent coverage gap in `ReconSetup.tsx`. If `pnpm coverage` fails only in one of those, rerun it once. If it fails again, treat it as a STOP condition.

## Scope

**In scope** (the only files you should modify):
- `packages/settings-reconciler/src/registry.ts` (the `RegistryEntry` interface only)
- `packages/settings-reconciler/src/reconciler.ts`
- `packages/settings-reconciler/src/index.ts` (one type export)
- `packages/settings-reconciler/test/reconciler.test.ts`
- `kitty-specs/008-managed-tooling-distribution/research.md` (one added note)
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch, even though they look related):
- `src/manifest.ts`. The validator keeps accepting any matcher string. Do not add a rule that the matcher must start with `joyus:`; that would lock in hooks that never run.
- `repairRegistry` in `src/registry.ts` and `scanManagedEntries` in `src/reconciler.ts`. They rebuild a lost registry by scanning for the `joyus:` prefix and stay as they are. See "Maintenance notes" for the limit this leaves.
- MCP server handling (`mergeMcpServers`, `removeStaleMcpServers`). MCP servers are keyed by id in `settings.json`, so their ownership already works.
- `apps/desktop-companion/src/sidecar/configCheckWiring.ts`. It builds its own `hook:<event>:<matcher>` ids to detect revocations. Plan 013 changes that file.
- Do not write any extra key (an id, a marker, a comment) into `settings.json`. Ownership lives only in the registry file.

## Git workflow

- Branch: `fix/012-managed-hook-ownership`
- Two commits: (1) `fix: record managed hook ownership in the registry and stop replacing user hook groups`, (2) `docs: note that hook matchers are no longer the ownership marker`. Conventional commits, matching `git log`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Record where a managed hook lives

In `src/registry.ts`, replace the `RegistryEntry` interface with:

```ts
export interface RegistryEntry {
  readonly type: "hook" | "mcp";
  readonly bundle: string;
  readonly manifest_version: string;
  readonly event?: HookEventType;
  /** Hooks only: the matcher of the settings group this hook was written into. */
  readonly matcher?: string;
  /** Hooks only: the exact command string that was written. Used to find and remove it later. */
  readonly command?: string;
  readonly target: SettingsTarget;
  readonly installed_at: string;
}
```

Change nothing else in this file.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Replace the hook merge and removal logic

All edits in this step are in `src/reconciler.ts`.

**2a.** Directly below the `buildCommandHook` function, add:

```ts
/**
 * A hook command this tool wrote to a settings file on an earlier run, as
 * recorded in the registry.
 */
export interface OwnedHook {
  readonly event: string;
  readonly matcher: string;
  readonly command: string;
}

const MANAGED_PREFIX = "joyus:";

/**
 * Groups whose matcher starts with the reserved prefix are wholly managed
 * (the original layout): every hook in them is ours.
 */
function isLegacyManagedMatcher(matcher: string): boolean {
  return matcher.startsWith(MANAGED_PREFIX);
}

function hookList(group: Record<string, unknown>): unknown[] {
  const hooks = group["hooks"];
  return Array.isArray(hooks) ? hooks : [];
}

function hookKey(event: string, matcher: string, command: string): string {
  return JSON.stringify([event, matcher, command]);
}
```

**2b.** Replace the whole `mergeHooks` function with:

```ts
export function mergeHooks(
  currentHooks: Record<string, unknown[]>,
  manifestHooks: readonly ManifestHook[]
): Record<string, unknown[]> {
  const merged = normalizeHooksRecord(currentHooks);

  for (const hook of manifestHooks) {
    const eventGroups = merged[hook.event] ?? [];
    const commandHook = buildCommandHook(hook);
    const existingIndex = eventGroups.findIndex(
      (group) => isRecord(group) && group["matcher"] === hook.matcher
    );
    const existingGroup = eventGroups[existingIndex];

    if (!isRecord(existingGroup)) {
      merged[hook.event] = [...eventGroups, { matcher: hook.matcher, hooks: [commandHook] }];
      continue;
    }

    // A legacy managed group is replaced as a whole. Any other group may hold
    // the user's own hooks: keep them, and add or refresh only our command.
    const existingHooks = isLegacyManagedMatcher(hook.matcher) ? [] : hookList(existingGroup);
    const keptHooks = existingHooks.filter(
      (entry) => !(isRecord(entry) && entry["command"] === hook.command)
    );

    const nextGroups = eventGroups.slice();
    nextGroups[existingIndex] = { ...existingGroup, hooks: [...keptHooks, commandHook] };
    merged[hook.event] = nextGroups;
  }

  return merged;
}
```

When no group matches, `existingIndex` is `-1`, `eventGroups[-1]` is `undefined`, and the `!isRecord(...)` branch adds a new group.

**2c.** Replace the whole `removeStaleHooks` function with:

```ts
export function removeStaleHooks(
  currentHooks: Record<string, unknown[]>,
  activeHooks: readonly ManifestHook[],
  ownedHooks: readonly OwnedHook[] = []
): Record<string, unknown[]> {
  const activeMatchers = new Set(activeHooks.map((hook) => hook.matcher));
  const activeKeys = new Set(
    activeHooks.map((hook) => hookKey(hook.event, hook.matcher, hook.command))
  );
  const staleKeys = new Set(
    ownedHooks
      .map((owned) => hookKey(owned.event, owned.matcher, owned.command))
      .filter((key) => !activeKeys.has(key))
  );

  const nextHooks: Record<string, unknown[]> = {};

  for (const [event, groups] of Object.entries(normalizeHooksRecord(currentHooks))) {
    const nextGroups: unknown[] = [];

    for (const group of groups) {
      if (!isRecord(group) || typeof group["matcher"] !== "string") {
        nextGroups.push(group);
        continue;
      }

      const matcher = group["matcher"];

      if (isLegacyManagedMatcher(matcher)) {
        if (activeMatchers.has(matcher)) {
          nextGroups.push(group);
        }
        continue;
      }

      const existingHooks = hookList(group);
      const keptHooks = existingHooks.filter(
        (entry) =>
          !(
            isRecord(entry) &&
            typeof entry["command"] === "string" &&
            staleKeys.has(hookKey(event, matcher, entry["command"]))
          )
      );

      if (keptHooks.length === existingHooks.length) {
        // Nothing of ours to remove: keep the same object.
        nextGroups.push(group);
      } else if (keptHooks.length > 0) {
        nextGroups.push({ ...group, hooks: keptHooks });
      }
      // Otherwise every hook in the group was ours and is stale: drop the group.
    }

    if (nextGroups.length > 0) {
      nextHooks[event] = nextGroups;
    }
  }

  return nextHooks;
}
```

**2d.** Delete the `buildActiveHookIds` function. Directly below `buildActiveMcpIds`, add:

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

**2e.** In `buildNewRegistry`, change the hook loop so the key uses the hook id and the entry records the matcher and command:

```ts
    for (const hook of bundle.hooks ?? []) {
      const key = `hook:${hook.event}:${hook.id}`;
      entries[key] = {
        type: "hook",
        bundle: bundleName,
        manifest_version: bundle.version,
        event: hook.event,
        matcher: hook.matcher,
        command: hook.command,
        target: resolveTarget(hook.target),
        installed_at: currentRegistry.entries[key]?.installed_at ?? reconciledAt,
      };
    }
```

**2f.** In `registryEntryEquals`, add two comparisons after `left.event === right.event &&`:

```ts
    left.matcher === right.matcher &&
    left.command === right.command &&
```

**2g.** In `reconcileSettingsTarget`, add `ownedHooks: readonly OwnedHook[];` to the options type (after `mcps`), and change the hook computation to:

```ts
  const nextHooks = removeStaleHooks(
    mergeHooks(currentHooks, options.hooks),
    options.hooks,
    options.ownedHooks
  );
```

**2h.** In `reconcile()`, pass the owned hooks to both calls. Add `ownedHooks: collectOwnedHooks(currentRegistry, "global"),` to the first call's options and `ownedHooks: collectOwnedHooks(currentRegistry, "project"),` to the second.

**2i.** In `src/index.ts`, change the type export line to:

```ts
export type { OwnedHook, ReconcileConfig, ReconcileResult, ReconcileStatus } from "./reconciler.js";
```

**Verify**: `pnpm typecheck` → exit 0. `grep -c 'buildActiveHookIds' packages/settings-reconciler/src/reconciler.ts` → `0`.

### Step 3: Update the two existing tests that pinned the old shapes

In `test/reconciler.test.ts`:

1. In "removes stale managed hooks and cleans up empty hook arrays", replace the second argument `new Set(["joyus:keep"])` with:

```ts
      [createHook({ id: "joyus:keep", matcher: "joyus:keep", command: "echo keep" })]
```

2. In "treats unchanged registry entries as no-op updates", add two properties to the seeded `"hook:PreToolUse:joyus:hook"` entry, after `event: "PreToolUse",`:

```ts
          matcher: "joyus:hook",
          command: "echo global hook",
```

Leave every other existing test as it is.

**Verify**: `pnpm vitest run packages/settings-reconciler` → all pass. If a different existing test fails, STOP (see STOP conditions).

### Step 4: Add tests for the new behavior

Add to the import from `../src/manifest.js` nothing new; the needed types are already imported. Add these tests.

At the end of `describe("pure reconciler helpers")`:

```ts
  it("adds a managed hook to the user's group without removing the user's hooks", () => {
    const userHook = { type: "command", command: "echo user-bash" };
    const currentHooks = { PreToolUse: [{ matcher: "Bash", hooks: [userHook] }] };
    const managed = createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit" });

    const once = mergeHooks(currentHooks, [managed]);

    expect(once).toEqual({
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [userHook, { type: "command", command: "echo audit", timeout: 5 }],
        },
      ],
    });
    // The input is not mutated.
    expect(currentHooks.PreToolUse[0]!.hooks).toEqual([userHook]);
    // Merging again changes nothing.
    expect(mergeHooks(once, [managed])).toEqual(once);
  });

  it("removes only the owned command from a shared group", () => {
    const userHook = { type: "command", command: "echo user-bash" };
    const managed = createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit" });
    const installed = mergeHooks({ PreToolUse: [{ matcher: "Bash", hooks: [userHook] }] }, [managed]);
    const owned = [{ event: "PreToolUse", matcher: "Bash", command: "echo audit" }];

    expect(removeStaleHooks(installed, [], owned)).toEqual({
      PreToolUse: [{ matcher: "Bash", hooks: [userHook] }],
    });

    // Still in the manifest: the group object is kept as it is.
    const kept = removeStaleHooks(installed, [managed], owned);
    expect(kept["PreToolUse"]![0]).toBe(installed["PreToolUse"]![0]);
  });

  it("replaces the owned command when the manifest changes it", () => {
    const userHook = { type: "command", command: "echo user-bash" };
    const before = createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit" });
    const after = createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit v2" });
    const installed = mergeHooks({ PreToolUse: [{ matcher: "Bash", hooks: [userHook] }] }, [before]);
    const owned = [{ event: "PreToolUse", matcher: "Bash", command: "echo audit" }];

    const result = removeStaleHooks(mergeHooks(installed, [after]), [after], owned);

    expect(result).toEqual({
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [userHook, { type: "command", command: "echo audit v2", timeout: 5 }],
        },
      ],
    });
  });

  it("drops a group and its event when every hook in it was owned and is revoked", () => {
    const managed = createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit" });
    const installed = mergeHooks({}, [managed]);
    const owned = [{ event: "PreToolUse", matcher: "Bash", command: "echo audit" }];

    expect(removeStaleHooks(installed, [], owned)).toEqual({});
  });

  it("never removes a command that is not recorded as owned", () => {
    const managed = createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit" });
    const installed = mergeHooks({}, [managed]);

    expect(removeStaleHooks(installed, [])).toEqual(installed);
  });

  it("leaves malformed groups and entries untouched", () => {
    const odd = {
      PreToolUse: [
        "text",
        { matcher: 5 },
        { matcher: "Bash", hooks: "not-an-array" },
        { matcher: "Edit", hooks: ["text-entry", { command: 7 }] },
      ],
    } as unknown as Record<string, unknown[]>;
    const owned = [
      { event: "PreToolUse", matcher: "Bash", command: "x" },
      { event: "PreToolUse", matcher: "Edit", command: "y" },
    ];

    expect(removeStaleHooks(odd, [], owned)).toEqual(odd);

    const merged = mergeHooks(odd, [
      createHook({ id: "joyus:a", matcher: "Bash", command: "echo a" }),
    ]);
    expect(merged["PreToolUse"]![2]).toEqual({
      matcher: "Bash",
      hooks: [{ type: "command", command: "echo a", timeout: 5 }],
    });
  });
```

At the end of `describe("reconcile")`:

```ts
  it("installs a tool-scoped hook beside the user's hook and removes only it on revocation", async () => {
    const workspace = await createWorkspace();
    const userSettings = {
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "echo user-bash" }] },
        ],
      },
    };
    await writeJson(workspace.globalSettingsPath, userSettings);

    const managed = createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit" });

    const installed = await reconcile(createManifest({ hooks: [managed] }), createConfig(workspace));
    expect(installed).toMatchObject({ status: "success", entriesAdded: 1 });
    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              { type: "command", command: "echo user-bash" },
              { type: "command", command: "echo audit", timeout: 5 },
            ],
          },
        ],
      },
    });

    const registry = (await readJson(workspace.registryPath)) as {
      entries: Record<string, { matcher?: string; command?: string }>;
    };
    expect(registry.entries["hook:PreToolUse:joyus:audit"]).toMatchObject({
      matcher: "Bash",
      command: "echo audit",
    });

    // The manifest drops the hook: only the managed command goes away.
    const revoked = await reconcile(createManifest({ hooks: [] }), createConfig(workspace));
    expect(revoked).toMatchObject({ status: "success", entriesRemoved: 1 });
    expect(await readJson(workspace.globalSettingsPath)).toEqual(userSettings);
  });

  it("upgrades a registry entry written before ownership fields existed", async () => {
    const workspace = await createWorkspace();
    const installedAt = "2026-03-01T00:00:00.000Z";

    await writeJson(workspace.globalSettingsPath, {
      hooks: {
        PreToolUse: [
          {
            matcher: "joyus:hook",
            hooks: [{ type: "command", command: "echo global hook", timeout: 5 }],
          },
        ],
      },
    });
    await writeJson(workspace.registryPath, {
      schema_version: "1.0",
      entries: {
        "hook:PreToolUse:joyus:hook": {
          type: "hook",
          bundle: "core",
          manifest_version: "1.0.0",
          event: "PreToolUse",
          target: "global",
          installed_at: installedAt,
        },
      },
      last_reconciled: installedAt,
    });

    const result = await reconcile(createManifest({ hooks: [createHook()] }), createConfig(workspace));

    expect(result).toMatchObject({ status: "success", entriesAdded: 0, entriesUpdated: 1 });
    const registry = (await readJson(workspace.registryPath)) as {
      entries: Record<string, { matcher?: string; command?: string; installed_at: string }>;
    };
    expect(registry.entries["hook:PreToolUse:joyus:hook"]).toMatchObject({
      matcher: "joyus:hook",
      command: "echo global hook",
      installed_at: installedAt,
    });
  });
```

**Verify**: `pnpm vitest run packages/settings-reconciler` → all pass. `pnpm vitest run apps/desktop-companion/test/sidecar/configCheckWiring.test.ts` → all pass. Commit (commit 1, together with Steps 1–3).

### Step 5: Record the decision in the spec

In `kitty-specs/008-managed-tooling-distribution/research.md`, find the paragraph in section R1 that begins `Matchers are glob patterns` and ends `used by user/plugin hooks.` Directly below it, add a blank line and this paragraph:

```markdown
> **Superseded (plan 012, 2026-11).** The matcher is functional in Claude Code: on tool events it is compared with the tool name, so a hook whose matcher is `joyus:<name>` never runs there. Ownership is now recorded in the registry file as the event, matcher and command that were written. Managed hooks may use real matchers and are merged into the matching group beside the user's hooks. Groups with a `joyus:` matcher are still recognized as wholly managed.
```

**Verify**: `grep -c 'Superseded (plan 012' kitty-specs/008-managed-tooling-distribution/research.md` → `1`. Commit (commit 2).

### Step 6: Run the full gates

Run `pnpm typecheck`, then `pnpm coverage`.

**Verify**: both exit 0, and the coverage summary shows 100% for `reconciler.ts` and `registry.ts`. If coverage reports an uncovered line or branch in code you added, add a focused test for it in `describe("pure reconciler helpers")`. Do not add a `v8 ignore` comment.

## Test plan

- Six new helper tests: shared group keeps user hooks, removal takes only the owned command, a changed command is replaced, an all-owned group and its event are dropped, an unowned command is never removed, malformed shapes pass through.
- Two new `reconcile` tests through real files: install then revoke beside a user hook (settings return to exactly the user's original), and upgrade of an old-format registry entry.
- Two existing tests updated for the new call shape and the new entry fields.
- Structural pattern: the existing tests in the same two `describe` blocks.
- Verification: `pnpm vitest run packages/settings-reconciler` → all pass (8 more tests than before this plan).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm vitest run packages/settings-reconciler` exits 0
- [ ] `pnpm vitest run apps/desktop-companion/test/sidecar/configCheckWiring.test.ts` exits 0
- [ ] `pnpm coverage` exits 0
- [ ] `grep -c 'buildActiveHookIds' packages/settings-reconciler/src/reconciler.ts` prints 0
- [ ] `grep -c 'collectOwnedHooks' packages/settings-reconciler/src/reconciler.ts` prints 3
- [ ] `grep -c 'OwnedHook' packages/settings-reconciler/src/index.ts` prints 1
- [ ] `git diff --stat main..HEAD -- packages/settings-reconciler/src/manifest.ts` prints nothing
- [ ] `git status --short` lists only the in-scope files
- [ ] `plans/README.md` status row for 012 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 009 has not landed (`grep -c 'readSettingsFileStrict' packages/settings-reconciler/src/reconciler.ts` prints 0).
- The code at the locations in "Current state" does not match the excerpts.
- After Step 3, an existing test other than the two named there fails. That test encodes behavior this plan did not account for. Report its name and the assertion; do not change its expectations.
- A test in `configCheckWiring.test.ts` fails. Report it; do not edit files under `apps/`.
- The install-then-revoke test in Step 4 does not return the settings file to exactly `userSettings`. That is the core guarantee of this plan; do not loosen the assertion.
- You find yourself adding a key to `settings.json` to mark ownership, or changing `manifest.ts`.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- **Lost registry.** If `~/.claude/.joyus-managed.json` is deleted, repair can only rediscover groups with a `joyus:` matcher and MCP servers. A managed hook with a real matcher is re-adopted on the next reconcile if it is still in the manifest (the identical command is found and recorded again). One that was revoked while the registry was missing stays in `settings.json` as if the user had written it. This is the cost of keeping markers out of `settings.json`.
- **Edited commands.** If the user edits a managed command in `settings.json`, the tool no longer recognizes it. It will add the manifest's version beside it and will not remove the edited one.
- **Identical commands.** If the user already had the exact same command in the same group, the tool adopts it and will remove it on revocation.
- **Duplicate ids.** Two hooks with the same `event` and `id` in one manifest share a registry key; only the last is recorded as owned. The manifest validator does not reject this.
- `configCheckWiring.ts` still detects revocations by comparing `hook:<event>:<matcher>` ids between manifests. With real matchers, two hooks can share that id. Plan 013 replaces that logic.
- Reviewer focus: `mergeHooks` must never drop a hook entry it did not write, and `removeStaleHooks` must remove a non-legacy entry only when its exact event, matcher and command are in the registry and not in the manifest.
