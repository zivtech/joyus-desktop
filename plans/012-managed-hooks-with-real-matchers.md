# Plan 012: Managed hooks can use real matchers without touching the user's hooks, and revoked ones are removed

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
> **Drift check (run first)**:
> 1. `git cat-file -e 363bb14 && echo known` must print `known`. That is the commit of plan 009 on branch `fix/009-unreadable-settings`. If it prints nothing, STOP: fetch that branch first.
> 2. `git diff --stat 363bb14 -- packages/settings-reconciler/` must print nothing. This plan was written against the package exactly as plan 009 left it. If the command lists any file, compare the "Current state" excerpts with the live code; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2 (the code is wired into the sidecar but only runs when `JOYUS_MANAGED_TOOLING_MANIFEST_URL` and `SKILL_SYNC_REPO_URL` are set)
- **Effort**: M
- **Risk**: MED (changes how a user's `~/.claude/settings.json` is edited)
- **Depends on**: plans/007-correct-agent-and-contributor-docs.md, plans/008-make-recon-tests-hermetic.md, plans/009-never-rewrite-unreadable-settings.md
- **Category**: bug, security
- **Planned at**: commit `cea62f6`, 2026-11-17
- **Revised**: 2026-11-18, against commit `363bb14` (branch `fix/009-unreadable-settings`), after the outside review recorded in `plans/README.md`. What changed:
  1. `mergeHooks` now receives what the registry owns. A command the user already had in the same group is left exactly as it is and is never recorded as owned, so a revocation cannot remove it (review finding 1).
  2. The test "repairs a missing registry from existing settings before reconciling" is now on the list of existing tests to update (review finding 6).
  3. Finding F18 is folded in: `repairRegistry` checks the shape of what it parsed, and `reconcile()` rebuilds a lost registry inside its `try`.
  4. A revocation removes at most one entry per owned command, and a group whose hook list cannot be read is never joined or rewritten.
  The code in the Steps was run against the package's existing tests before this revision was published. See "What was run".
- **Reviewed**: 2026-11-18 by an independent replay. It executed cleanly and the full gates pass. Five items are open, one of them a narrower case of the defect that blocked the first version. Read items 1–5 under "Independent replay of the revised plans" in `plans/README.md` before executing or merging.

## Why this matters

`@joyus/settings-reconciler` installs "managed" hooks from a remote manifest into the user's Claude Code `settings.json`, and removes them when the manifest drops them (a revocation).

In Claude Code, hooks for an event are stored as groups: `{ "matcher": "...", "hooks": [ { "type": "command", "command": "..." } ] }`. The `matcher` is functional. For `PreToolUse`, `PostToolUse`, `PostToolUseFailure` and `PermissionRequest` it is compared with the tool name (`"Bash"`, `"Edit|Write"`). For `SessionStart` it is compared with how the session started. Only a few events, such as `UserPromptSubmit` and `Stop`, ignore it. (Checked against the Claude Code hooks reference, "Matcher patterns", on 2026-11-17.)

The reconciler uses the `matcher` as its ownership tag. Spec 008 chose this on purpose (`kitty-specs/008-managed-tooling-distribution/research.md`, R1): a managed hook is expected to have a matcher like `joyus:chat-length-guard`. That has two consequences:

1. **A managed hook with a `joyus:` matcher never runs on tool events.** No tool is called `joyus:chat-length-guard`. The spec's own example is a `PreToolUse` hook that would never fire.
2. **A managed hook with a real matcher is unsafe.** The manifest validator accepts any matcher string. If a manifest sends `"matcher": "Bash"`:
   - `mergeHooks` finds the user's existing `Bash` group and replaces the whole group, deleting the user's own hooks.
   - `removeStaleHooks` only removes groups whose matcher starts with `joyus:`, so the hook is never removed when it is revoked.

So today a managed hook either does nothing or cannot be revoked and destroys user configuration.

After this plan, ownership is recorded in the registry file (`~/.claude/.joyus-managed.json`) as the exact event, matcher and command that this tool wrote. A managed hook is added inside the matching group next to the user's hooks, and on revocation only that one command is removed. If the user already has the identical command in that group, the tool writes nothing, owns nothing, and removes nothing. Nothing extra is written into `settings.json`. Groups with a `joyus:` matcher keep working exactly as before.

The plan also closes a small hole in the same code (finding F18): when the registry file is missing, `reconcile()` rebuilds it from `settings.json` before its error handling starts, and the rebuild throws on valid JSON of the wrong shape. After this plan that case returns `rolled_back` like every other failure.

## Current state

All excerpts were read from commit `363bb14` on 2026-11-18. Files, all under `packages/settings-reconciler/`:

- `src/registry.ts` — registry types, read, write, and repair-by-prefix-scan (148 lines).
- `src/reconciler.ts` — merge, removal, and the `reconcile()` entry point (596 lines).
- `src/index.ts` — package exports.
- `src/manifest.ts` — manifest types and validation. Read-only for this plan.
- `test/reconciler.test.ts` — 947 lines, 19 tests. `describe("pure reconciler helpers")` and `describe("reconcile")`.
- `test/registry.test.ts` — 244 lines, 14 tests. `describe("repairRegistry")` is the last block.

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

The repair function (`src/registry.ts:82-118`). `settings` is trusted to be an object, and each `group` to be an object. With a file that contains `null`, `settings.hooks` throws; with a hook list that contains `null`, `group.matcher` throws:

```ts
export async function repairRegistry(
  settingsPath: string,
  now: () => Date = () => new Date()
): Promise<ManagedRegistry> {
  const installedAt = now().toISOString();
  const reconciledAt = installedAt;

  let settings: SettingsJson;
  try {
    const raw = await readFile(settingsPath, "utf8");
    settings = JSON.parse(raw) as SettingsJson;
  } catch {
    return emptyRegistry(reconciledAt);
  }

  const entries: Record<string, RegistryEntry> = {};

  // Scan hooks for joyus:-prefixed matchers
  if (settings.hooks != null) {
    for (const eventType of HOOK_EVENT_TYPES) {
      const matchers: SettingsHookMatcher[] | undefined = settings.hooks[eventType];
      if (!Array.isArray(matchers)) continue;
      for (const group of matchers as SettingsHookMatcher[]) {
        if (typeof group.matcher === "string" && group.matcher.startsWith("joyus:")) {
          const key = `hook:${eventType}:${group.matcher}`;
          entries[key] = {
            type: "hook",
            bundle: "unknown",
            manifest_version: "unknown",
            event: eventType,
            target: "global",
            installed_at: installedAt,
          };
        }
      }
    }
  }
```

The update result type (`src/reconciler.ts:48-52`):

```ts
interface SettingsUpdateResult {
  readonly backupPath: string | undefined;
  readonly changed: boolean;
  readonly existedBefore: boolean;
}
```

The merge and removal functions (`src/reconciler.ts:115-166`):

```ts
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

The "active ids" are matchers (`src/reconciler.ts:235-237`):

```ts
function buildActiveHookIds(hooks: readonly ManifestHook[]): ReadonlySet<string> {
  return new Set(hooks.map((hook) => hook.matcher));
}
```

The registry is built with a matcher-based key (`src/reconciler.ts:310-329`, the start of `buildNewRegistry`):

```ts
function buildNewRegistry(
  manifest: DistributionManifest,
  currentRegistry: ManagedRegistry,
  now: () => Date
): ManagedRegistry {
  const reconciledAt = now().toISOString();
  const entries: Record<string, RegistryEntry> = {};

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

Entry comparison (`src/reconciler.ts:350-359`):

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

Where the functions are called (`src/reconciler.ts:408-425`, the start of `reconcileSettingsTarget`):

```ts
async function reconcileSettingsTarget(options: {
  settingsPath: string;
  backupDir: string;
  maxBackups: number;
  now: () => Date;
  hooks: readonly ManifestHook[];
  mcps: readonly ManifestMcpServer[];
}): Promise<SettingsUpdateResult> {
  const currentSettings = await readSettingsFileStrict(options.settingsPath);
  const currentHooksValue = currentSettings["hooks"];
  const currentMcpValue = currentSettings["mcpServers"];
  const currentHooks = normalizeHooksRecord(currentHooksValue);
  const currentMcpServers = normalizeMcpRecord(currentMcpValue);

  const nextHooks = removeStaleHooks(
    mergeHooks(currentHooks, options.hooks),
    buildActiveHookIds(options.hooks)
  );
```

In `reconcile()` (`src/reconciler.ts:523-543`), the registry is loaded, and repaired if missing, **before** the `try` that turns failures into `rolled_back`:

```ts
  const currentRegistry =
    (await readRegistry(registryPath)) ??
    (await repairRegistryFromSettings(globalSettingsPath, projectSettingsPath, now));

  const partition = partitionByTarget(
    collectAllHooks(manifest),
    collectAllMcpServers(manifest)
  );

  let globalUpdate: SettingsUpdateResult = {
    backupPath: undefined,
    changed: false,
    existedBefore: false,
  };
  let projectUpdate: SettingsUpdateResult = {
    backupPath: undefined,
    changed: false,
    existedBefore: false,
  };

  try {
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

`createWorkspace()` returns temp paths (`globalSettingsPath`, `projectSettingsPath`, `registryPath`, `backupDir`, `now`), `createConfig(workspace)` turns them into a `ReconcileConfig`, `createManifest({ hooks, mcps, version })` builds a one-bundle manifest named `core`, and `writeJson` / `readJson` write and read JSON files. `FIXED_NOW` is the fixed clock. `test/registry.test.ts` has `tmpDir()`, which returns a fresh temp directory.

Three existing tests pin shapes that this plan changes. Each was found by running the reference implementation against the unmodified test file; no other existing test failed.

1. "removes stale managed hooks and cleans up empty hook arrays" (`test/reconciler.test.ts:154`) passes a `Set` of matchers as the second argument:

```ts
    const result = removeStaleHooks(
      {
        PreToolUse: [userGroup, activeGroup, staleGroup],
        SessionEnd: [staleGroup],
      },
      new Set(["joyus:keep"])
    );
```

2. "treats unchanged registry entries as no-op updates" (`test/reconciler.test.ts:319`) seeds a registry entry without the two new fields, so the run would count it as updated:

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

3. "repairs a missing registry from existing settings before reconciling" (`test/reconciler.test.ts:684`) compares the written registry entries with `toEqual`:

```ts
    const registry = (await readJson(workspace.registryPath)) as {
      entries: Record<string, { bundle: string; target: string }>;
    };
    expect(registry.entries).toEqual({
      "hook:PreToolUse:joyus:hook": {
        type: "hook",
        bundle: "core",
        manifest_version: "1.0.0",
        event: "PreToolUse",
        target: "global",
        installed_at: FIXED_NOW.toISOString(),
      },
    });
```

Repo conventions: TypeScript strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` (never assign `undefined` to an optional property; leave the property out). Functions return new objects and do not mutate their inputs. Vitest. Coverage must stay at 100% lines, functions, branches and statements. `pnpm typecheck` does not check test files (`tsconfig.json` excludes `**/test/**`), so a type error in a test shows up only as a runtime failure, if at all.

### What was run

On 2026-11-18, outside the repository, in a copy of commit `363bb14` with a `node_modules` borrowed from an existing worktree (Vitest 3.2.4):

- The unmodified package: `vitest run packages/settings-reconciler` → 122 tests pass.
- The source changes of Steps 1 and 2 with the test files untouched → exactly three tests fail, the three named above.
- After Step 3 → 122 pass. After Step 4 → 144 pass. `vitest run --coverage packages/settings-reconciler` → 100% statements, branches, functions and lines for all six source files of the package.
- `tsc --noEmit` over the whole workspace → exit 0. A separate `tsc` run that includes this package's test files → exit 0.
- `apps/desktop-companion/test/sidecar/configCheckWiring.test.ts` (50 tests, three of which run the real `reconcile` on temp paths), `configCheckPoller.test.ts` (21) and `mainConfigCheckWiring.test.ts` (5), against the changed package → all pass.
- Five deliberate defects were put into the reference one at a time (treat no command as the user's; ignore the registry's ownership; remove every matching entry; drop the shape checks; rebuild the registry outside the `try`). Each made between one and six of the new tests fail.
- This plan was then replayed: a script took the code blocks from this file, applied them to a fresh copy of `363bb14` as the Steps describe, and ran the same commands. Result: three failures after Step 2, the three named; 122 pass after Step 3; 144 pass after Step 4; 100% coverage for the package; and the five resulting files were byte-identical to the reference.

Not run: `pnpm coverage` over the whole repository (the 100% figure above is for this package's files only), and the code has not been run inside the real application.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Package tests | `pnpm vitest run packages/settings-reconciler` | all pass (122 before this plan, 144 after) |
| Wiring tests (a consumer of this package) | `pnpm vitest run apps/desktop-companion/test/sidecar/configCheckWiring.test.ts` | all pass (50) |
| Full coverage gate | `pnpm coverage` | exit 0, thresholds met |

Never run `pnpm ci` (that is clean-install in pnpm). The full pipeline is `pnpm run ci`.

Run tests only on a branch that contains plan 008 (`git merge-base --is-ancestor 1edaa59 HEAD && echo safe` prints `safe`). Without it, the unit tests delete `~/Documents/joyus-recon-engagements`.

Known flaky tests, unrelated to this plan: `apps/desktop-companion/test/ui/SessionsPage.test.ts` ("clears mode note timers…"), `apps/desktop-companion/test/ui/components/LocalSiteCard.test.ts`, and a timing-dependent coverage gap in `ReconSetup.tsx`. If `pnpm coverage` fails only in one of those, rerun it once. If it fails again, treat it as a STOP condition.

## Scope

**In scope** (the only files you should modify):
- `packages/settings-reconciler/src/registry.ts`
- `packages/settings-reconciler/src/reconciler.ts`
- `packages/settings-reconciler/src/index.ts` (one type export)
- `packages/settings-reconciler/test/reconciler.test.ts`
- `packages/settings-reconciler/test/registry.test.ts`
- `kitty-specs/008-managed-tooling-distribution/research.md` (one added note)
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch, even though they look related):
- `src/manifest.ts`. The validator keeps accepting any matcher string. Do not add a rule that the matcher must start with `joyus:`; that would lock in hooks that never run.
- `scanManagedEntries` and `repairRegistryFromSettings` in `src/reconciler.ts`. They rebuild a lost registry by scanning for the `joyus:` prefix and stay as they are. See "Maintenance notes" for the limit this leaves.
- MCP server handling (`mergeMcpServers`, `removeStaleMcpServers`). MCP servers are keyed by id in `settings.json`, so their ownership already works.
- `apps/desktop-companion/src/sidecar/configCheckWiring.ts`. It builds its own `hook:<event>:<matcher>` ids to detect revocations. Plan 013 changes that file.
- Do not write any extra key (an id, a marker, a comment) into `settings.json`. Ownership lives only in the registry file.
- `readRegistry`. A registry file that is valid JSON of the wrong shape is a separate, older problem. See "Maintenance notes".

## Git workflow

- Branch: `fix/012-managed-hook-ownership`, cut from `fix/009-unreadable-settings` (or from `main` once plan 009 has merged there).
- Two commits: (1) `fix: record managed hook ownership in the registry and stop replacing user hook groups`, (2) `docs: note that hook matchers are no longer the ownership marker`. Conventional commits, matching `git log`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Record where a managed hook lives, and make registry repair safe on odd shapes

Both edits are in `src/registry.ts`.

**1a.** Replace the `RegistryEntry` interface with:

<!-- block: registry-entry -->

```ts
export interface RegistryEntry {
  readonly type: "hook" | "mcp";
  readonly bundle: string;
  readonly manifest_version: string;
  readonly event?: HookEventType;
  /** Hooks only: the matcher of the settings group the manifest places this hook in. */
  readonly matcher?: string;
  /**
   * Hooks only: the exact command string this tool wrote. Absent when the
   * entry predates this field, or when the user already had the identical
   * command in that group: then the entry in settings is the user's, and this
   * tool must never refresh or remove it.
   */
  readonly command?: string;
  readonly target: SettingsTarget;
  readonly installed_at: string;
}
```

**1b.** Replace everything from the comment line `// T010: Repair registry from prefix scanning` to the end of the file with the block below. It removes the two interfaces `SettingsHookMatcher` and `SettingsJson`, adds `isPlainObject`, and rewrites `repairRegistry` so that it skips anything that is not the shape it expects. The entries it produces are unchanged.

<!-- block: registry-repair -->

```ts
// T010: Repair registry from prefix scanning

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const HOOK_EVENT_TYPES: readonly HookEventType[] = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "UserPromptSubmit",
  "SessionStart",
  "SessionEnd",
  "PreCompact",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "PermissionRequest",
];

export async function repairRegistry(
  settingsPath: string,
  now: () => Date = () => new Date()
): Promise<ManagedRegistry> {
  const installedAt = now().toISOString();
  const reconciledAt = installedAt;

  let settings: unknown;
  try {
    const raw = await readFile(settingsPath, "utf8");
    settings = JSON.parse(raw);
  } catch {
    return emptyRegistry(reconciledAt);
  }

  // Valid JSON of the wrong shape (null, a list, a string) has nothing to scan.
  if (!isPlainObject(settings)) {
    return emptyRegistry(reconciledAt);
  }

  const entries: Record<string, RegistryEntry> = {};

  // Scan hooks for joyus:-prefixed matchers
  const hooks = settings["hooks"];
  if (isPlainObject(hooks)) {
    for (const eventType of HOOK_EVENT_TYPES) {
      const groups = hooks[eventType];
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        if (!isPlainObject(group)) continue;
        const matcher = group["matcher"];
        if (typeof matcher === "string" && matcher.startsWith("joyus:")) {
          const key = `hook:${eventType}:${matcher}`;
          entries[key] = {
            type: "hook",
            bundle: "unknown",
            manifest_version: "unknown",
            event: eventType,
            target: "global",
            installed_at: installedAt,
          };
        }
      }
    }
  }

  // Scan mcpServers for joyus:-prefixed keys
  const mcpServers = settings["mcpServers"];
  if (isPlainObject(mcpServers)) {
    for (const key of Object.keys(mcpServers)) {
      if (key.startsWith("joyus:")) {
        entries[`mcp:${key}`] = {
          type: "mcp",
          bundle: "unknown",
          manifest_version: "unknown",
          target: "global",
          installed_at: installedAt,
        };
      }
    }
  }

  return {
    schema_version: "1.0",
    entries,
    last_reconciled: reconciledAt,
  };
}

function emptyRegistry(reconciledAt: string): ManagedRegistry {
  return {
    schema_version: "1.0",
    entries: {},
    last_reconciled: reconciledAt,
  };
}
```

**Verify**: `pnpm typecheck` → exit 0. `pnpm vitest run packages/settings-reconciler/test/registry.test.ts` → 14 pass. `grep -c 'SettingsJson\|SettingsHookMatcher' packages/settings-reconciler/src/registry.ts` → `0`.

### Step 2: Replace the hook merge and removal logic

All edits in this step are in `src/reconciler.ts`, except 2h. Do them all before running anything: the file does not compile in between.

**2a.** Replace the `SettingsUpdateResult` interface with the interface and constant below:

<!-- block: update-result -->

```ts
interface SettingsUpdateResult {
  readonly backupPath: string | undefined;
  readonly changed: boolean;
  readonly existedBefore: boolean;
  /** Registry keys of manifest hooks whose command the user already had. */
  readonly userOwnedHookKeys: readonly string[];
}

const NO_SETTINGS_UPDATE: SettingsUpdateResult = {
  backupPath: undefined,
  changed: false,
  existedBefore: false,
  userOwnedHookKeys: [],
};
```

**2b.** Replace both functions `mergeHooks` and `removeStaleHooks` (everything from the line `export function mergeHooks(` up to, but not including, the line `export function mergeMcpServers(`) with:

<!-- block: merge-remove -->

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

function hookKey(event: string, matcher: string, command: string): string {
  return JSON.stringify([event, matcher, command]);
}

function hookRegistryKey(hook: ManifestHook): string {
  return `hook:${hook.event}:${hook.id}`;
}

function ownedHookKeys(ownedHooks: readonly OwnedHook[]): Set<string> {
  return new Set(ownedHooks.map((owned) => hookKey(owned.event, owned.matcher, owned.command)));
}

/** A group this tool can read: an object with the given matcher and a hook list. */
function isGroupFor(
  group: unknown,
  matcher: string
): group is Record<string, unknown> & { hooks: unknown[] } {
  return isRecord(group) && group["matcher"] === matcher && Array.isArray(group["hooks"]);
}

function hasCommand(entry: unknown, command: string): boolean {
  return isRecord(entry) && entry["command"] === command;
}

function replaceAt(list: readonly unknown[], index: number, value: unknown): unknown[] {
  const next = list.slice();
  next[index] = value;
  return next;
}

interface HookMergePlan {
  readonly hooks: Record<string, unknown[]>;
  /** Manifest hooks left alone because the user already had the identical command. */
  readonly userOwned: readonly ManifestHook[];
}

function planHookMerge(
  currentHooks: Record<string, unknown[]>,
  manifestHooks: readonly ManifestHook[],
  ownedHooks: readonly OwnedHook[]
): HookMergePlan {
  const original = normalizeHooksRecord(currentHooks);
  const merged = normalizeHooksRecord(currentHooks);
  const ownedKeys = ownedHookKeys(ownedHooks);
  const userOwned: ManifestHook[] = [];

  for (const hook of manifestHooks) {
    const eventGroups = merged[hook.event] ?? [];
    const commandHook = buildCommandHook(hook);

    if (isLegacyManagedMatcher(hook.matcher)) {
      // A legacy managed group is replaced as a whole, exactly as before.
      const legacyIndex = eventGroups.findIndex(
        (group) => isRecord(group) && group["matcher"] === hook.matcher
      );
      const legacyGroup = { matcher: hook.matcher, hooks: [commandHook] };
      merged[hook.event] =
        legacyIndex === -1
          ? [...eventGroups, legacyGroup]
          : replaceAt(eventGroups, legacyIndex, legacyGroup);
      continue;
    }

    // The identical command was in this group before this run and the registry
    // does not say this tool wrote it: it is the user's. Leave it exactly as it
    // is and do not claim it.
    const userHadIt =
      !ownedKeys.has(hookKey(hook.event, hook.matcher, hook.command)) &&
      (original[hook.event] ?? []).some(
        (group) =>
          isGroupFor(group, hook.matcher) &&
          group.hooks.some((entry) => hasCommand(entry, hook.command))
      );
    if (userHadIt) {
      userOwned.push(hook);
      continue;
    }

    // Ours already (from the registry, or added earlier in this run): refresh
    // that one entry in place.
    const ownedGroupIndex = eventGroups.findIndex(
      (group) =>
        isGroupFor(group, hook.matcher) &&
        group.hooks.some((entry) => hasCommand(entry, hook.command))
    );
    const ownedGroup = eventGroups[ownedGroupIndex];
    if (isGroupFor(ownedGroup, hook.matcher)) {
      const entryIndex = ownedGroup.hooks.findIndex((entry) => hasCommand(entry, hook.command));
      merged[hook.event] = replaceAt(eventGroups, ownedGroupIndex, {
        ...ownedGroup,
        hooks: replaceAt(ownedGroup.hooks, entryIndex, commandHook),
      });
      continue;
    }

    // Not installed yet: join the user's group for this matcher, or start one.
    const groupIndex = eventGroups.findIndex((group) => isGroupFor(group, hook.matcher));
    const group = eventGroups[groupIndex];
    merged[hook.event] = isGroupFor(group, hook.matcher)
      ? replaceAt(eventGroups, groupIndex, { ...group, hooks: [...group.hooks, commandHook] })
      : [...eventGroups, { matcher: hook.matcher, hooks: [commandHook] }];
  }

  return { hooks: merged, userOwned };
}

export function mergeHooks(
  currentHooks: Record<string, unknown[]>,
  manifestHooks: readonly ManifestHook[],
  ownedHooks: readonly OwnedHook[] = []
): Record<string, unknown[]> {
  return planHookMerge(currentHooks, manifestHooks, ownedHooks).hooks;
}

export function removeStaleHooks(
  currentHooks: Record<string, unknown[]>,
  activeHooks: readonly ManifestHook[],
  ownedHooks: readonly OwnedHook[] = []
): Record<string, unknown[]> {
  const activeMatchers = new Set(activeHooks.map((hook) => hook.matcher));
  const activeKeys = new Set(
    activeHooks.map((hook) => hookKey(hook.event, hook.matcher, hook.command))
  );
  // Each stale key is used up by the first entry it removes: this tool wrote
  // one entry per key, so it removes at most one.
  const staleKeys = ownedHookKeys(ownedHooks);
  for (const key of activeKeys) {
    staleKeys.delete(key);
  }

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

      if (!isGroupFor(group, matcher)) {
        nextGroups.push(group);
        continue;
      }

      const keptHooks = group.hooks.filter((entry) => {
        if (!isRecord(entry) || typeof entry["command"] !== "string") {
          return true;
        }
        // Set.delete returns true only for the first entry with a stale key.
        return !staleKeys.delete(hookKey(event, matcher, entry["command"]));
      });

      if (keptHooks.length === group.hooks.length) {
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

How to read it:

- A `joyus:` matcher takes the old path: the whole group is replaced, as before.
- For any other matcher, `userHadIt` asks: was the identical command in a group with this matcher before this run, and does the registry *not* say this tool wrote it? If so the hook is skipped and reported in `userOwned`. Nothing is written.
- Otherwise the hook is refreshed in place if the command is already there, or appended to the first group with that matcher, or put in a new group. When no group matches, the index is `-1`, `eventGroups[-1]` is `undefined`, and `isGroupFor` is false.
- `removeStaleHooks` removes a non-legacy entry only when its exact event, matcher and command are owned and no longer in the manifest. `staleKeys.delete(...)` returns `true` once per key, so one owned command removes one entry.

**2c.** Delete the `buildActiveHookIds` function. Directly below `buildActiveMcpIds`, add:

<!-- block: collect-owned -->

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

**2d.** Replace the whole `buildNewRegistry` function with:

<!-- block: build-registry -->

```ts
function buildNewRegistry(
  manifest: DistributionManifest,
  currentRegistry: ManagedRegistry,
  now: () => Date,
  userOwnedHookKeys: ReadonlySet<string>
): ManagedRegistry {
  const reconciledAt = now().toISOString();
  const entries: Record<string, RegistryEntry> = {};

  for (const [bundleName, bundle] of Object.entries(manifest.bundles)) {
    for (const hook of bundle.hooks ?? []) {
      const key = hookRegistryKey(hook);
      const target = resolveTarget(hook.target);
      const installedAt = currentRegistry.entries[key]?.installed_at ?? reconciledAt;
      // No command is recorded for a hook the user already had: the registry
      // lists the hook, but does not own the entry in settings.
      entries[key] = userOwnedHookKeys.has(key)
        ? {
            type: "hook",
            bundle: bundleName,
            manifest_version: bundle.version,
            event: hook.event,
            matcher: hook.matcher,
            target,
            installed_at: installedAt,
          }
        : {
            type: "hook",
            bundle: bundleName,
            manifest_version: bundle.version,
            event: hook.event,
            matcher: hook.matcher,
            command: hook.command,
            target,
            installed_at: installedAt,
          };
    }

    for (const server of bundle.mcpServers ?? []) {
      const key = `mcp:${server.id}`;
      entries[key] = {
        type: "mcp",
        bundle: bundleName,
        manifest_version: bundle.version,
        target: resolveTarget(server.target),
        installed_at: currentRegistry.entries[key]?.installed_at ?? reconciledAt,
      };
    }
  }

  return {
    schema_version: "1.0",
    entries,
    last_reconciled: reconciledAt,
  };
}
```

The registry key now uses the hook `id`, not its matcher. A hook the user already had gets an entry with a `matcher` and no `command`.

**2e.** Replace the whole `registryEntryEquals` function with:

<!-- block: entry-equals -->

```ts
function registryEntryEquals(left: RegistryEntry, right: RegistryEntry): boolean {
  return (
    left.type === right.type &&
    left.bundle === right.bundle &&
    left.manifest_version === right.manifest_version &&
    left.event === right.event &&
    left.matcher === right.matcher &&
    left.command === right.command &&
    left.target === right.target &&
    left.installed_at === right.installed_at
  );
}
```

**2f.** Replace the whole `reconcileSettingsTarget` function with:

<!-- block: reconcile-target -->

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

  const nextSettings: Record<string, unknown> = { ...currentSettings };

  if (isRecord(currentHooksValue)) {
    if (Object.keys(nextHooks).length > 0) {
      nextSettings["hooks"] = nextHooks;
    } else {
      delete nextSettings["hooks"];
    }
  } else if (Object.keys(nextHooks).length > 0) {
    nextSettings["hooks"] = nextHooks;
  }

  if (isRecord(currentMcpValue)) {
    if (Object.keys(nextMcpServers).length > 0) {
      nextSettings["mcpServers"] = nextMcpServers;
    } else {
      delete nextSettings["mcpServers"];
    }
  } else if (Object.keys(nextMcpServers).length > 0) {
    nextSettings["mcpServers"] = nextMcpServers;
  }

  if (settingsEqual(currentSettings, nextSettings)) {
    return { ...NO_SETTINGS_UPDATE, userOwnedHookKeys };
  }

  const backupPath = await createSettingsBackup(
    options.settingsPath,
    options.backupDir,
    options.maxBackups,
    options.now
  );

  await writeSettingsFile(options.settingsPath, nextSettings);

  return {
    backupPath,
    changed: true,
    existedBefore: backupPath !== undefined,
    userOwnedHookKeys,
  };
}
```

**2g.** Replace the whole `reconcile` function (from `export async function reconcile(` to the end of the file) with:

<!-- block: reconcile -->

```ts
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

    return withOptionalBackupPath({
      status: "success",
      entriesAdded: counts.added,
      entriesUpdated: counts.updated,
      entriesRemoved: counts.removed,
      registryPath,
    }, globalUpdate.backupPath ?? projectUpdate.backupPath);
  } catch (error) {
    try {
      await rollbackReconciledSettings(globalSettingsPath, globalUpdate);
    } catch {
      // Best-effort rollback for global settings.
    }

    try {
      await rollbackReconciledSettings(projectSettingsPath, projectUpdate);
    } catch {
      // Best-effort rollback for project settings.
    }

    return withOptionalBackupPath({
      status: "rolled_back",
      entriesAdded: 0,
      entriesUpdated: 0,
      entriesRemoved: 0,
      registryPath,
      error: error instanceof Error ? error.message : String(error),
    }, globalUpdate.backupPath ?? projectUpdate.backupPath);
  }
}
```

The only changes from the old body: the two update results start from `NO_SETTINGS_UPDATE`, the registry is loaded as the first statement inside the `try`, both calls pass `ownedHooks`, and `buildNewRegistry` receives the user-owned keys.

**2h.** In `src/index.ts`, change the type export line to:

<!-- block: index-export -->

```ts
export type { OwnedHook, ReconcileConfig, ReconcileResult, ReconcileStatus } from "./reconciler.js";
```

**Verify**: `pnpm typecheck` → exit 0. `grep -c 'buildActiveHookIds' packages/settings-reconciler/src/reconciler.ts` → `0`. Then run `pnpm vitest run packages/settings-reconciler`: **exactly three tests must fail**, the three named in "Current state". If any other test fails, or fewer than three fail, STOP (see STOP conditions).

### Step 3: Update the three existing tests that pinned the old shapes

In `test/reconciler.test.ts`:

1. In "removes stale managed hooks and cleans up empty hook arrays", replace the second argument `new Set(["joyus:keep"])` with the line below. The same text appears again further down, in "removes stale managed MCP servers without disturbing user servers"; do not change that one.

<!-- block: test-fix-remove -->

```ts
      [createHook({ id: "joyus:keep", matcher: "joyus:keep", command: "echo keep" })]
```

2. In "treats unchanged registry entries as no-op updates", add two properties to the seeded `"hook:PreToolUse:joyus:hook"` entry, directly after `event: "PreToolUse",`:

<!-- block: test-fix-noop -->

```ts
          matcher: "joyus:hook",
          command: "echo global hook",
```

3. In "repairs a missing registry from existing settings before reconciling", add two properties to the expected `"hook:PreToolUse:joyus:hook"` entry at the end of the test, directly after `event: "PreToolUse",`:

<!-- block: test-fix-repair -->

```ts
        matcher: "joyus:hook",
        command: "echo repaired new",
```

Leave every other existing test as it is.

**Verify**: `pnpm vitest run packages/settings-reconciler` → 122 pass, 0 fail.

### Step 4: Add tests for the new behavior

No new imports are needed in either test file.

**4a.** In `test/reconciler.test.ts`, at the end of `describe("pure reconciler helpers")`, add:

<!-- block: tests-helpers -->

```ts
  it("adds a managed hook to the user's group without removing the user's hooks", () => {
    const userHook = { type: "command", command: "echo user-bash" };
    const currentHooks = { PreToolUse: [{ matcher: "Bash", hooks: [userHook] }] };
    const managed = createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit" });
    const owned = [{ event: "PreToolUse", matcher: "Bash", command: "echo audit" }];

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
    // Merging again changes nothing, with or without the registry's record.
    expect(mergeHooks(once, [managed], owned)).toEqual(once);
    expect(mergeHooks(once, [managed])).toEqual(once);
  });

  it("leaves an identical command the user already had exactly as it is", () => {
    const userEntry = { type: "command", command: "echo audit", timeout: 30, note: "mine" };
    const userGroup = { matcher: "Bash", hooks: [userEntry] };
    const managed = createHook({
      id: "joyus:audit",
      matcher: "Bash",
      command: "echo audit",
      timeout: 9,
    });

    const result = mergeHooks({ PreToolUse: [userGroup] }, [managed]);

    // Same group object, same entry object: nothing was rewritten.
    expect(result["PreToolUse"]).toHaveLength(1);
    expect(result["PreToolUse"]![0]).toBe(userGroup);
    expect(userGroup.hooks).toEqual([
      { type: "command", command: "echo audit", timeout: 30, note: "mine" },
    ]);
  });

  it("refreshes an owned entry in place when the manifest changes its timeout", () => {
    const before = { type: "command", command: "echo user-before" };
    const after = { type: "command", command: "echo user-after" };
    const currentHooks = {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [before, { type: "command", command: "echo audit", timeout: 5 }, after],
        },
      ],
    };
    const managed = createHook({
      id: "joyus:audit",
      matcher: "Bash",
      command: "echo audit",
      timeout: 20,
    });
    const owned = [{ event: "PreToolUse", matcher: "Bash", command: "echo audit" }];

    expect(mergeHooks(currentHooks, [managed], owned)).toEqual({
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [before, { type: "command", command: "echo audit", timeout: 20 }, after],
        },
      ],
    });
    // Without the registry's record the same entry counts as the user's.
    expect(mergeHooks(currentHooks, [managed])).toEqual(currentHooks);
  });

  it("writes one entry when two manifest hooks share event, matcher and command", () => {
    const first = createHook({ id: "joyus:a", matcher: "Bash", command: "echo same" });
    const second = createHook({ id: "joyus:b", matcher: "Bash", command: "echo same", timeout: 7 });

    expect(mergeHooks({}, [first, second])).toEqual({
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "echo same", timeout: 7 }] },
      ],
    });
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

    const result = removeStaleHooks(mergeHooks(installed, [after], owned), [after], owned);

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

  it("removes one entry per owned command, even when the user added a duplicate", () => {
    const ours = { type: "command", command: "echo audit", timeout: 5 };
    const userCopy = { type: "command", command: "echo audit", timeout: 30 };
    const owned = [{ event: "PreToolUse", matcher: "Bash", command: "echo audit" }];

    expect(
      removeStaleHooks({ PreToolUse: [{ matcher: "Bash", hooks: [ours, userCopy] }] }, [], owned)
    ).toEqual({ PreToolUse: [{ matcher: "Bash", hooks: [userCopy] }] });
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

    // A group whose hook list cannot be read is not joined: a new group is added.
    const merged = mergeHooks(odd, [
      createHook({ id: "joyus:a", matcher: "Bash", command: "echo a" }),
      createHook({ id: "joyus:b", matcher: "Edit", command: "echo b" }),
    ]);
    expect(merged["PreToolUse"]).toEqual([
      "text",
      { matcher: 5 },
      { matcher: "Bash", hooks: "not-an-array" },
      {
        matcher: "Edit",
        hooks: ["text-entry", { command: 7 }, { type: "command", command: "echo b", timeout: 5 }],
      },
      { matcher: "Bash", hooks: [{ type: "command", command: "echo a", timeout: 5 }] },
    ]);
  });
```

**4b.** In `test/reconciler.test.ts`, at the end of `describe("reconcile")`, add:

<!-- block: tests-reconcile -->

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
    const originalText = await readFile(workspace.globalSettingsPath, "utf8");

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
      entries: Record<string, unknown>;
    };
    expect(registry.entries["hook:PreToolUse:joyus:audit"]).toEqual({
      type: "hook",
      bundle: "core",
      manifest_version: "1.0.0",
      event: "PreToolUse",
      matcher: "Bash",
      command: "echo audit",
      target: "global",
      installed_at: FIXED_NOW.toISOString(),
    });

    // A second run with the same manifest changes nothing and makes no backup.
    const again = await reconcile(createManifest({ hooks: [managed] }), createConfig(workspace));
    expect(again).toMatchObject({ status: "success", entriesAdded: 0, entriesUpdated: 0 });
    expect(again.backupPath).toBeUndefined();

    // The manifest drops the hook: only the managed command goes away.
    const revoked = await reconcile(createManifest({ hooks: [] }), createConfig(workspace));
    expect(revoked).toMatchObject({ status: "success", entriesRemoved: 1 });
    expect(await readFile(workspace.globalSettingsPath, "utf8")).toBe(originalText);
  });

  it("never rewrites or removes an identical command the user already had", async () => {
    const workspace = await createWorkspace();
    // Unusual formatting on purpose: any rewrite of the file would change it.
    const originalText = JSON.stringify(
      {
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: "echo audit", timeout: 30, note: "mine" }],
            },
          ],
        },
      },
      null,
      4
    );
    await mkdir(dirname(workspace.globalSettingsPath), { recursive: true });
    await writeFile(workspace.globalSettingsPath, originalText, "utf8");

    const managed = createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit" });

    const installed = await reconcile(createManifest({ hooks: [managed] }), createConfig(workspace));
    expect(installed).toMatchObject({ status: "success", entriesAdded: 1 });
    expect(installed.backupPath).toBeUndefined();
    expect(await readFile(workspace.globalSettingsPath, "utf8")).toBe(originalText);

    // The registry lists the hook but records no command: it owns nothing here.
    const registry = (await readJson(workspace.registryPath)) as {
      entries: Record<string, unknown>;
    };
    expect(registry.entries["hook:PreToolUse:joyus:audit"]).toEqual({
      type: "hook",
      bundle: "core",
      manifest_version: "1.0.0",
      event: "PreToolUse",
      matcher: "Bash",
      target: "global",
      installed_at: FIXED_NOW.toISOString(),
    });

    // Still the user's on a later run, and still there after revocation.
    const again = await reconcile(
      createManifest({ hooks: [{ ...managed, timeout: 9 }] }),
      createConfig(workspace)
    );
    expect(again).toMatchObject({ status: "success", entriesAdded: 0, entriesUpdated: 0 });
    expect(await readFile(workspace.globalSettingsPath, "utf8")).toBe(originalText);

    const revoked = await reconcile(createManifest({ hooks: [] }), createConfig(workspace));
    expect(revoked).toMatchObject({ status: "success", entriesRemoved: 1 });
    expect(await readFile(workspace.globalSettingsPath, "utf8")).toBe(originalText);
  });

  it("keeps the user's identical command intact while other managed hooks come and go", async () => {
    const workspace = await createWorkspace();
    const userSettings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "echo audit", timeout: 30, note: "mine" }],
          },
        ],
      },
    };
    await writeJson(workspace.globalSettingsPath, userSettings);

    const same = createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit" });
    const other = createHook({ id: "joyus:lint", matcher: "Bash", command: "echo lint" });

    await reconcile(createManifest({ hooks: [same, other] }), createConfig(workspace));
    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              { type: "command", command: "echo audit", timeout: 30, note: "mine" },
              { type: "command", command: "echo lint", timeout: 5 },
            ],
          },
        ],
      },
    });

    const revoked = await reconcile(createManifest({ hooks: [] }), createConfig(workspace));
    expect(revoked).toMatchObject({ status: "success", entriesRemoved: 2 });
    expect(await readJson(workspace.globalSettingsPath)).toEqual(userSettings);
  });

  it("takes ownership once the user removes their own identical command", async () => {
    const workspace = await createWorkspace();
    await writeJson(workspace.globalSettingsPath, {
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo audit" }] }],
      },
    });
    const manifest = createManifest({
      hooks: [createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit" })],
    });

    await reconcile(manifest, createConfig(workspace));
    // The user deletes their entry.
    await writeJson(workspace.globalSettingsPath, {});

    const result = await reconcile(manifest, createConfig(workspace));
    expect(result).toMatchObject({ status: "success", entriesAdded: 0, entriesUpdated: 1 });
    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "echo audit", timeout: 5 }] },
        ],
      },
    });

    const revoked = await reconcile(createManifest({ hooks: [] }), createConfig(workspace));
    expect(revoked).toMatchObject({ status: "success", entriesRemoved: 1 });
    expect(await readJson(workspace.globalSettingsPath)).toEqual({});
  });

  it("refreshes an owned hook in place and moves it when its target changes", async () => {
    const workspace = await createWorkspace();
    const userHook = { type: "command", command: "echo user-bash" };
    await writeJson(workspace.globalSettingsPath, {
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [userHook] }] },
    });
    const managed = createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit" });

    await reconcile(createManifest({ hooks: [managed] }), createConfig(workspace));

    // Same command, new timeout: the one entry is updated where it is.
    await reconcile(
      createManifest({ hooks: [{ ...managed, timeout: 20 }] }),
      createConfig(workspace)
    );
    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [userHook, { type: "command", command: "echo audit", timeout: 20 }],
          },
        ],
      },
    });

    // Target changes to project: removed from global, written to project.
    await reconcile(
      createManifest({ hooks: [{ ...managed, target: "project" }] }),
      createConfig(workspace)
    );
    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [userHook] }] },
    });
    expect(await readJson(workspace.projectSettingsPath)).toEqual({
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "echo audit", timeout: 5 }] },
        ],
      },
    });
  });

  it("treats a tool-scoped hook as the user's after the registry is lost", async () => {
    const workspace = await createWorkspace();
    const manifest = createManifest({
      hooks: [createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit" })],
    });

    await reconcile(manifest, createConfig(workspace));
    const installedText = await readFile(workspace.globalSettingsPath, "utf8");
    await rm(workspace.registryPath);

    // Nothing in settings.json marks the command as managed, so it is not re-adopted.
    await reconcile(manifest, createConfig(workspace));
    const registry = (await readJson(workspace.registryPath)) as {
      entries: Record<string, { command?: string }>;
    };
    expect(registry.entries["hook:PreToolUse:joyus:audit"]).not.toHaveProperty("command");

    // Known limit: a later revocation leaves it in place.
    await reconcile(createManifest({ hooks: [] }), createConfig(workspace));
    expect(await readFile(workspace.globalSettingsPath, "utf8")).toBe(installedText);
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

  it("returns rolled_back when a settings file holds JSON that is not an object and there is no registry", async () => {
    const workspace = await createWorkspace();
    await mkdir(dirname(workspace.globalSettingsPath), { recursive: true });
    await writeFile(workspace.globalSettingsPath, "null", "utf8");

    const result = await reconcile(
      createManifest({ hooks: [createHook()] }),
      createConfig(workspace)
    );

    expect(result.status).toBe("rolled_back");
    expect(result.error).toContain("not a JSON object");
    expect(await readFile(workspace.globalSettingsPath, "utf8")).toBe("null");
    await expect(readFile(workspace.registryPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("repairs the registry from a hook list that contains null", async () => {
    const workspace = await createWorkspace();
    await writeJson(workspace.globalSettingsPath, {
      hooks: {
        PreToolUse: [
          null,
          {
            matcher: "joyus:hook",
            hooks: [{ type: "command", command: "echo old", timeout: 5 }],
          },
        ],
      },
    });

    const result = await reconcile(
      createManifest({ hooks: [createHook({ command: "echo new" })] }),
      createConfig(workspace)
    );

    expect(result).toMatchObject({ status: "success", entriesAdded: 0, entriesUpdated: 1 });
    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: {
        PreToolUse: [
          null,
          {
            matcher: "joyus:hook",
            hooks: [{ type: "command", command: "echo new", timeout: 5 }],
          },
        ],
      },
    });
  });

  it("returns rolled_back instead of rejecting when registry repair throws", async () => {
    const workspace = await createWorkspace();
    await writeJson(workspace.globalSettingsPath, { existing: true });
    vi.spyOn(registryModule, "repairRegistry").mockRejectedValueOnce(new Error("repair failed"));

    const result = await reconcile(
      createManifest({ hooks: [createHook()] }),
      createConfig(workspace)
    );

    expect(result).toMatchObject({ status: "rolled_back", error: "repair failed" });
    expect(await readJson(workspace.globalSettingsPath)).toEqual({ existing: true });
  });
```

**4c.** In `test/registry.test.ts`, at the end of `describe("repairRegistry")`, add:

<!-- block: tests-registry -->

```ts
  it("returns empty registry when the settings file holds JSON that is not an object", async () => {
    const dir = await tmpDir();
    const settingsPath = join(dir, "settings.json");
    const fixedDate = new Date("2026-03-01T00:00:00.000Z");

    for (const content of ["null", "[]", '"text"', "5"]) {
      await writeFile(settingsPath, content, "utf8");

      const registry = await repairRegistry(settingsPath, () => fixedDate);

      expect(registry).toEqual({
        schema_version: "1.0",
        entries: {},
        last_reconciled: fixedDate.toISOString(),
      });
    }
  });

  it("skips hook groups and sections that are not objects", async () => {
    const dir = await tmpDir();
    const settingsPath = join(dir, "settings.json");
    const fixedDate = new Date("2026-03-01T00:00:00.000Z");

    await writeFile(
      settingsPath,
      JSON.stringify({
        hooks: {
          PreToolUse: [null, "text", ["joyus:in-a-list"], { matcher: "joyus:real", hooks: [] }],
          SessionStart: "not-a-list",
        },
        mcpServers: ["joyus:in-a-list"],
      }),
      "utf8"
    );
    expect(Object.keys((await repairRegistry(settingsPath, () => fixedDate)).entries)).toEqual([
      "hook:PreToolUse:joyus:real",
    ]);

    await writeFile(
      settingsPath,
      JSON.stringify({ hooks: null, mcpServers: { "joyus:mcp": { command: "node" } } }),
      "utf8"
    );
    expect(Object.keys((await repairRegistry(settingsPath, () => fixedDate)).entries)).toEqual([
      "mcp:joyus:mcp",
    ]);
  });
```

**Verify**: `pnpm vitest run packages/settings-reconciler` → 144 pass. `pnpm vitest run apps/desktop-companion/test/sidecar/configCheckWiring.test.ts` → 50 pass. Commit (commit 1, together with Steps 1–3).

### Step 5: Record the decision in the spec

In `kitty-specs/008-managed-tooling-distribution/research.md`, find the paragraph in section R1 that begins `Matchers are glob patterns` and ends `used by user/plugin hooks.` Directly below it, add a blank line and this paragraph:

```markdown
> **Superseded (plan 012, 2026-11).** The matcher is functional in Claude Code: on tool events it is compared with the tool name, so a hook whose matcher is `joyus:<name>` never runs there. Ownership is now recorded in the registry file as the event, matcher and command that were written. Managed hooks may use real matchers and are merged into the matching group beside the user's hooks. A command the user already had is never claimed. Groups with a `joyus:` matcher are still recognized as wholly managed.
```

**Verify**: `grep -c 'Superseded (plan 012' kitty-specs/008-managed-tooling-distribution/research.md` → `1`. Commit (commit 2).

### Step 6: Run the full gates

Run `pnpm typecheck`, then `pnpm coverage`.

**Verify**: both exit 0, and the coverage summary shows 100% for `reconciler.ts` and `registry.ts`. If coverage reports an uncovered line or branch in code you added, STOP and report it: the reference run showed 100% for this package, so a gap means the code or the tests differ from this plan. Do not add a `v8 ignore` comment.

## Test plan

- Ten new helper tests: a shared group keeps the user's hooks; an identical user command is left as the same object; an owned entry is refreshed in place; two manifest hooks with the same command write one entry; removal takes only the owned command; a changed command is replaced; an all-owned group and its event are dropped; an unowned command is never removed; one owned command removes one entry; malformed shapes pass through and are not joined.
- Ten new `reconcile` tests through real files: install then revoke beside a user hook (the file returns to its original bytes); an identical user command survives install, a later run and revocation byte for byte, with a registry entry that has no `command`; the same while another managed hook comes and goes; ownership is taken once the user deletes their copy; refresh in place and a target move; a lost registry; upgrade of an old-format registry entry; `null` as a settings file; `null` in a hook list; a repair that throws.
- Two new `repairRegistry` tests: JSON that is not an object; groups and sections that are not objects.
- Three existing tests updated for the new call shape and the new entry fields.
- Structural pattern: the existing tests in the same `describe` blocks.
- Verification: `pnpm vitest run packages/settings-reconciler` → 144 pass (22 more than before this plan).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm vitest run packages/settings-reconciler` exits 0 with 144 tests
- [ ] `pnpm vitest run apps/desktop-companion/test/sidecar/configCheckWiring.test.ts` exits 0
- [ ] `pnpm coverage` exits 0
- [ ] `grep -c 'buildActiveHookIds' packages/settings-reconciler/src/reconciler.ts` prints 0
- [ ] `grep -c 'collectOwnedHooks' packages/settings-reconciler/src/reconciler.ts` prints 3
- [ ] `grep -c 'planHookMerge' packages/settings-reconciler/src/reconciler.ts` prints 3
- [ ] `grep -c 'OwnedHook' packages/settings-reconciler/src/index.ts` prints 1
- [ ] `git diff --stat 363bb14 -- packages/settings-reconciler/src/manifest.ts packages/settings-reconciler/src/settingsFile.ts` prints nothing
- [ ] `git status --short` lists only the in-scope files
- [ ] `plans/README.md` status row for 012 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 009 has not landed (`grep -c 'readSettingsFileStrict' packages/settings-reconciler/src/reconciler.ts` prints 0), or the drift check lists a file.
- The code at the locations in "Current state" does not match the excerpts.
- After Step 2, the set of failing tests is anything other than the three named in "Current state". A fourth failing test encodes behavior this plan did not account for. Report its name and the assertion; do not change its expectations.
- After Step 3 or Step 4, any test in the package fails.
- A test in `configCheckWiring.test.ts` fails. Report it; do not edit files under `apps/`.
- A test with "byte for byte" behavior fails: "never rewrites or removes an identical command the user already had", or the last assertion of "installs a tool-scoped hook beside the user's hook and removes only it on revocation". Those are the core guarantees of this plan; do not loosen the assertions.
- You find yourself adding a key to `settings.json` to mark ownership, or changing `manifest.ts`.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

What this plan guarantees, and where the guarantee ends:

- **Identical commands.** If the user already has the exact same command string in a group with the same matcher, the tool writes nothing and records the hook without a `command`. It never refreshes or removes that entry, whatever the manifest later says about timeout or revocation. If the user later deletes their copy, the next reconcile installs the managed one and owns it. The comparison is on the command string only: an entry with the same command and a different `type` or `timeout` still counts as the user's.
- **Lost registry.** If `~/.claude/.joyus-managed.json` is deleted, repair can only rediscover groups with a `joyus:` matcher and MCP servers. A managed hook with a real matcher is **not** re-adopted: nothing in `settings.json` says this tool wrote it, so from then on it is treated as the user's and a revocation leaves it in place. This is the cost of keeping markers out of `settings.json`, and of never claiming a command the user may have written. The test "treats a tool-scoped hook as the user's after the registry is lost" pins it.
- **Edited commands.** If the user edits the command string of a managed entry, the tool no longer recognizes it. It adds the manifest's version beside it and does not remove the edited one. If the user edits only another field of a managed entry, such as `timeout`, the next reconcile sets it back to the manifest's value.
- **Duplicates added later.** If the user adds a second copy of a managed command to the same group after it was installed, a revocation removes one entry: the first with that command, in file order. The other stays.
- **Several groups with one matcher.** The managed command joins the first group with that matcher whose `hooks` is a list. A group whose `hooks` is not a list is left alone, and a new group is added instead.
- **`joyus:` groups are unchanged.** They are still replaced as a whole and removed by prefix. A user who edits such a group loses the edit on the next reconcile, as before.
- **Duplicate ids.** Two hooks with the same `event` and `id` in one manifest share a registry key; only the last is recorded. The manifest validator does not reject this.
- **Registry key change.** Keys were `hook:<event>:<matcher>` and are now `hook:<event>:<id>`. For a hook whose id differs from its matcher, the first run after this change counts one entry removed and one added. `settings.json` is not affected.
- **Not fixed here: a registry file of the wrong shape.** A registry file that parses as JSON but has no `entries` object (for example `{}`) makes every `reconcile()` return `rolled_back`, before and after this plan. Checked on 2026-11-18 by running both versions. It needs its own small plan: `readRegistry` should treat such a file as missing.
- `configCheckWiring.ts` still detects revocations by comparing `hook:<event>:<matcher>` ids between manifests. With real matchers, two hooks can share that id. Plan 013 replaces that logic.
- Reviewer focus: `planHookMerge` must never change or drop an entry it did not write, and `removeStaleHooks` must remove a non-legacy entry only when its exact event, matcher and command are in the registry and not in the manifest.
