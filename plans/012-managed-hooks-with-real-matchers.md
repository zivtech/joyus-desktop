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
- **Revised again**: 2026-11-18, after an independent replay of the first revision found five open items (items 1–5 under "Independent replay of the revised plans" in `plans/README.md`). What changed:
  1. The registry also records the timeout that was written, and the tool finds its own entry by what it wrote, not by position. A copy of a managed command that the user adds, before or after the managed entry, is no longer overwritten or removed (item 1).
  2. `readRegistry` treats any JSON that is not a registry as a lost registry, so a file holding `{}` no longer blocks every run (item 2).
  3. A `joyus:` group is kept only while the manifest lists it under the same event, so a hook that changes event is not left installed under both (item 3).
  4. The plan says what happens to a tool-scoped hook installed by the code before this plan (item 4), and its claims about unchanged bytes are narrowed to what holds (item 5).
  Pull request zivtech/joyus-desktop#13 holds the code of the first revision. It does not contain these four changes.

## Why this matters

`@joyus/settings-reconciler` installs "managed" hooks from a remote manifest into the user's Claude Code `settings.json`, and removes them when the manifest drops them (a revocation).

In Claude Code, hooks for an event are stored as groups: `{ "matcher": "...", "hooks": [ { "type": "command", "command": "..." } ] }`. The `matcher` is functional. For `PreToolUse`, `PostToolUse`, `PostToolUseFailure` and `PermissionRequest` it is compared with the tool name (`"Bash"`, `"Edit|Write"`). For `SessionStart` it is compared with how the session started. Only a few events, such as `UserPromptSubmit` and `Stop`, ignore it. (Checked against the Claude Code hooks reference, "Matcher patterns", on 2026-11-17.)

The reconciler uses the `matcher` as its ownership tag. Spec 008 chose this on purpose (`kitty-specs/008-managed-tooling-distribution/research.md`, R1): a managed hook is expected to have a matcher like `joyus:chat-length-guard`. That has two consequences:

1. **A managed hook with a `joyus:` matcher never runs on tool events.** No tool is called `joyus:chat-length-guard`. The spec's own example is a `PreToolUse` hook that would never fire.
2. **A managed hook with a real matcher is unsafe.** The manifest validator accepts any matcher string. If a manifest sends `"matcher": "Bash"`:
   - `mergeHooks` finds the user's existing `Bash` group and replaces the whole group, deleting the user's own hooks.
   - `removeStaleHooks` only removes groups whose matcher starts with `joyus:`, so the hook is never removed when it is revoked.

So today a managed hook either does nothing or cannot be revoked and destroys user configuration.

After this plan, ownership is recorded in the registry file (`~/.claude/.joyus-managed.json`) as the exact event, matcher, command and timeout that this tool wrote. A managed hook is added inside the matching group next to the user's hooks, and on revocation only that one command is removed. If the user already has the identical command in that group, the tool writes nothing, owns nothing, and removes nothing. Nothing extra is written into `settings.json`. Groups with a `joyus:` matcher keep working as before, with one correction: a group is removed when the manifest moves its hook to another event.

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

The reader (`src/registry.ts:38-45`) casts whatever JSON it parses. A file that holds `{}` has no `entries`, and every later use of the registry throws:

```ts
export async function readRegistry(registryPath: string): Promise<ManagedRegistry | undefined> {
  try {
    const raw = await readFile(registryPath, "utf8");
    return JSON.parse(raw) as ManagedRegistry;
  } catch {
    return undefined;
  }
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

2. "treats unchanged registry entries as no-op updates" (`test/reconciler.test.ts:319`) seeds a registry entry without the new fields, so the run would count it as updated:

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
- After Step 3 → 122 pass. After Step 4 → 157 pass. `vitest run --coverage packages/settings-reconciler` → 100% statements, branches, functions and lines for all six source files of the package.
- `tsc --noEmit` over the whole workspace → exit 0. A separate `tsc` run that includes this package's test files → exit 0.
- On a complete copy of the branch with these files in place: both typechecks exit 0, and `vitest run --coverage`, the command behind `pnpm coverage`, exits 0 with 146 test files, 2,364 tests and 100%. That run includes the app tests that use this package (`configCheckWiring.test.ts`, `configCheckPoller.test.ts`, `mainConfigCheckWiring.test.ts`). It used a throwaway home directory.
- Nine deliberate defects were put into the reference one at a time: treat no command as the user's; ignore the registry's ownership; find the tool's entry by position only; forget what an earlier hook in the same run wrote; count an entry with extra keys as the tool's own; match `joyus:` groups by matcher only; skip the registry shape check; skip the shape check in repair; rebuild the registry outside the `try`. Each made at least one test fail.
- This plan was then replayed: a script took the code blocks from this file, applied them to a fresh copy of `363bb14` as the Steps describe, and ran the same commands. Result: three failures after Step 2, the three named; 122 pass after Step 3; 157 pass after Step 4, with 100% coverage for the package; and the three resulting source files were byte-identical to the reference.

Not run: the code inside the real application, and `pnpm test:integration`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Package tests | `pnpm vitest run packages/settings-reconciler` | all pass (122 before this plan, 157 after) |
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
- `writeRegistry`, and the lenient `readSettingsFile` in `settingsFile.ts`.

## Git workflow

- Branch: `fix/012-managed-hook-ownership`, cut from `fix/009-unreadable-settings` (or from `main` once plan 009 has merged there).
- Two commits: (1) `fix: record managed hook ownership in the registry and stop replacing user hook groups`, (2) `docs: note that hook matchers are no longer the ownership marker`. Conventional commits, matching `git log`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Record what was written, and make the registry code safe on odd shapes

Replace the whole content of `src/registry.ts` with:

<!-- block: registry-file -->

```ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// T007: Registry types

export type HookEventType =
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "UserPromptSubmit"
  | "SessionStart"
  | "SessionEnd"
  | "PreCompact"
  | "Stop"
  | "SubagentStart"
  | "SubagentStop"
  | "PermissionRequest";

export type SettingsTarget = "global" | "project";

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
  /** Hooks only: the timeout written with the command. Tells this tool's entry from a copy the user added. */
  readonly timeout?: number;
  readonly target: SettingsTarget;
  readonly installed_at: string;
}

export interface ManagedRegistry {
  readonly schema_version: string;
  readonly entries: Readonly<Record<string, RegistryEntry>>;
  readonly last_reconciled: string;
}

// T008: Read registry

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An object with an `entries` object whose values are all objects. */
function isRegistryShape(value: unknown): value is ManagedRegistry {
  return (
    isPlainObject(value) &&
    isPlainObject(value["entries"]) &&
    Object.values(value["entries"]).every(isPlainObject)
  );
}

/**
 * Returns undefined when the file is missing, is not JSON, or is JSON of the
 * wrong shape. The caller then rebuilds the registry from the settings files.
 */
export async function readRegistry(registryPath: string): Promise<ManagedRegistry | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(registryPath, "utf8"));
    return isRegistryShape(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// T009: Write registry (atomic)

export async function writeRegistry(registryPath: string, registry: ManagedRegistry): Promise<void> {
  const tmpPath = `${registryPath}.tmp`;
  await mkdir(dirname(registryPath), { recursive: true });
  await writeFile(tmpPath, JSON.stringify(registry, null, 2) + "\n", "utf8");
  await rename(tmpPath, registryPath);
}

// T010: Repair registry from prefix scanning

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

What changed against the old file:

- `RegistryEntry` gains `matcher`, `command` and `timeout`.
- `readRegistry` returns `undefined` for JSON that is not a registry: no `entries` object, or an entry that is not an object. The caller already rebuilds the registry when it gets `undefined`.
- `repairRegistry` skips anything that is not the shape it expects. The entries it produces are unchanged.
- The two interfaces `SettingsHookMatcher` and `SettingsJson` are gone; `writeRegistry` is untouched.

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

**2b.** Replace the three functions `buildCommandHook`, `mergeHooks` and `removeStaleHooks`: everything from the line `function buildCommandHook(hook: ManifestHook): Record<string, unknown> {` up to, but not including, the line `export function mergeMcpServers(`. Put this in their place:

<!-- block: merge-remove -->

```ts
/** The timeout written when the manifest gives none. */
const DEFAULT_HOOK_TIMEOUT = 5;

function writtenTimeout(hook: ManifestHook): number {
  return hook.timeout ?? DEFAULT_HOOK_TIMEOUT;
}

function buildCommandHook(hook: ManifestHook): Record<string, unknown> {
  return {
    type: "command",
    command: hook.command,
    timeout: writtenTimeout(hook),
  };
}

/**
 * A hook command this tool wrote to a settings file on an earlier run, as
 * recorded in the registry.
 */
export interface OwnedHook {
  readonly event: string;
  readonly matcher: string;
  readonly command: string;
  /** The timeout that was written. Absent in records made before it was stored. */
  readonly timeout?: number;
}

const MANAGED_PREFIX = "joyus:";

/**
 * Groups whose matcher starts with the reserved prefix are wholly managed
 * (the original layout): every hook in them is ours.
 */
function isLegacyManagedMatcher(matcher: string): boolean {
  return matcher.startsWith(MANAGED_PREFIX);
}

function groupKey(event: string, matcher: string): string {
  return JSON.stringify([event, matcher]);
}

function hookKey(event: string, matcher: string, command: string): string {
  return JSON.stringify([event, matcher, command]);
}

function hookRegistryKey(hook: ManifestHook): string {
  return `hook:${hook.event}:${hook.id}`;
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

/** True when the entry is exactly what this tool writes: these three keys and no others. */
function isEntryAsWritten(entry: unknown, command: string, timeout: number | undefined): boolean {
  return (
    timeout !== undefined &&
    isRecord(entry) &&
    Object.keys(entry).length === 3 &&
    entry["type"] === "command" &&
    entry["command"] === command &&
    entry["timeout"] === timeout
  );
}

function replaceAt(list: readonly unknown[], index: number, value: unknown): unknown[] {
  const next = list.slice();
  next[index] = value;
  return next;
}

interface EntryLocation {
  readonly groupIndex: number;
  readonly group: Record<string, unknown> & { hooks: unknown[] };
  readonly entryIndex: number;
}

/**
 * Finds the entry this tool wrote for `command` among the groups of one event
 * that have `matcher`. The user may have added a copy of the same command
 * anywhere in those groups, so position proves nothing: an entry that is
 * exactly what was written (same timeout, no other keys) wins. Only when no
 * entry is, or the written timeout is unknown, the first entry with the
 * command is taken.
 */
function locateWrittenEntry(
  eventGroups: readonly unknown[],
  matcher: string,
  command: string,
  timeout: number | undefined
): EntryLocation | undefined {
  let firstWithCommand: EntryLocation | undefined;

  for (const [groupIndex, group] of eventGroups.entries()) {
    if (!isGroupFor(group, matcher)) {
      continue;
    }
    for (const [entryIndex, entry] of group.hooks.entries()) {
      if (!hasCommand(entry, command)) {
        continue;
      }
      const location = { groupIndex, group, entryIndex };
      if (isEntryAsWritten(entry, command, timeout)) {
        return location;
      }
      firstWithCommand ??= location;
    }
  }

  return firstWithCommand;
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
  // What this tool wrote for each owned command: from the registry at first,
  // then from this run.
  const written = new Map<string, number | undefined>(
    ownedHooks.map((owned) => [hookKey(owned.event, owned.matcher, owned.command), owned.timeout])
  );
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

    const key = hookKey(hook.event, hook.matcher, hook.command);

    // The identical command was in this group before this run and the registry
    // does not say this tool wrote it: it is the user's. Leave it exactly as it
    // is and do not claim it.
    const userHadIt =
      !written.has(key) &&
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
    const ours = locateWrittenEntry(eventGroups, hook.matcher, hook.command, written.get(key));
    written.set(key, writtenTimeout(hook));
    if (ours !== undefined) {
      merged[hook.event] = replaceAt(eventGroups, ours.groupIndex, {
        ...ours.group,
        hooks: replaceAt(ours.group.hooks, ours.entryIndex, commandHook),
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

/**
 * Drops the legacy managed groups for which `dropLegacyGroup` says so, and
 * from every other group the one entry this tool wrote for each command in
 * `staleOwned`. Two records of the same command remove one entry: this tool
 * wrote one.
 */
function filterHookGroups(
  currentHooks: Record<string, unknown[]>,
  dropLegacyGroup: (event: string, matcher: string) => boolean,
  staleOwned: readonly OwnedHook[]
): Record<string, unknown[]> {
  const hooks = normalizeHooksRecord(currentHooks);

  // Decide first which entries go, so that removing one cannot shift another.
  const dropped = new Set<string>();
  for (const owned of staleOwned) {
    const ours = locateWrittenEntry(
      hooks[owned.event] ?? [],
      owned.matcher,
      owned.command,
      owned.timeout
    );
    if (ours !== undefined) {
      dropped.add(JSON.stringify([owned.event, ours.groupIndex, ours.entryIndex]));
    }
  }

  const nextHooks: Record<string, unknown[]> = {};

  for (const [event, groups] of Object.entries(hooks)) {
    const nextGroups: unknown[] = [];

    for (const [groupIndex, group] of groups.entries()) {
      if (!isRecord(group) || typeof group["matcher"] !== "string") {
        nextGroups.push(group);
        continue;
      }

      const matcher = group["matcher"];

      if (isLegacyManagedMatcher(matcher)) {
        if (!dropLegacyGroup(event, matcher)) {
          nextGroups.push(group);
        }
        continue;
      }

      if (!isGroupFor(group, matcher)) {
        nextGroups.push(group);
        continue;
      }

      const keptHooks = group.hooks.filter(
        (_entry, entryIndex) => !dropped.has(JSON.stringify([event, groupIndex, entryIndex]))
      );

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

How to read it:

- A `joyus:` matcher takes the old path: the whole group is replaced, as before.
- For any other matcher, `userHadIt` asks: was the identical command in a group with this matcher before this run, and does the registry *not* say this tool wrote it? If so the hook is skipped and reported in `userOwned`. Nothing is written.
- Otherwise `locateWrittenEntry` looks for the entry this tool wrote. An entry that is exactly what was written (the recorded timeout, no other keys) wins over position, because the user may have added a copy of the command anywhere. If it finds one, that entry is refreshed in place. If not, the command is appended to the first group with that matcher, or put in a new group. When no group matches, the index is `-1`, `eventGroups[-1]` is `undefined`, and `isGroupFor` is false.
- `removeStaleHooks` removes a non-legacy entry only when its exact event, matcher and command are owned and no longer in the manifest. `filterHookGroups` first decides which entries go, one per stale owned command, found by `locateWrittenEntry`. It drops a `joyus:` group unless the manifest lists that matcher under the same event.
- `written` remembers what this run wrote. When two manifest hooks share one event, matcher and command, the second refreshes the entry the first one wrote.

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
      owned.push(
        entry.timeout === undefined
          ? { event: entry.event, matcher: entry.matcher, command: entry.command }
          : {
              event: entry.event,
              matcher: entry.matcher,
              command: entry.command,
              timeout: entry.timeout,
            }
      );
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
            timeout: writtenTimeout(hook),
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

The registry key now uses the hook `id`, not its matcher. An owned entry records the `matcher`, the `command` and the `timeout` that was written. A hook the user already had gets an entry with a `matcher` only.

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
    left.timeout === right.timeout &&
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

2. In "treats unchanged registry entries as no-op updates", add three properties to the seeded `"hook:PreToolUse:joyus:hook"` entry, directly after `event: "PreToolUse",`:

<!-- block: test-fix-noop -->

```ts
          matcher: "joyus:hook",
          command: "echo global hook",
          timeout: 5,
```

3. In "repairs a missing registry from existing settings before reconciling", add three properties to the expected `"hook:PreToolUse:joyus:hook"` entry at the end of the test, directly after `event: "PreToolUse",`:

<!-- block: test-fix-repair -->

```ts
        matcher: "joyus:hook",
        command: "echo repaired new",
        timeout: 5,
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

  it("finds its own entry by what it wrote when the user added a copy of the command before it", () => {
    const userCopy = { type: "command", command: "echo audit", timeout: 30, note: "mine" };
    const ours = { type: "command", command: "echo audit", timeout: 5 };
    const currentHooks = { PreToolUse: [{ matcher: "Bash", hooks: [userCopy, ours] }] };
    const owned = [{ event: "PreToolUse", matcher: "Bash", command: "echo audit", timeout: 5 }];
    const managed = createHook({
      id: "joyus:audit",
      matcher: "Bash",
      command: "echo audit",
      timeout: 20,
    });

    // Refresh: the managed entry changes, the user's copy does not.
    const refreshed = mergeHooks(currentHooks, [managed], owned);
    expect(refreshed).toEqual({
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [userCopy, { type: "command", command: "echo audit", timeout: 20 }],
        },
      ],
    });
    // Revocation: the managed entry goes, the user's copy stays.
    expect(removeStaleHooks(currentHooks, [], owned)).toEqual({
      PreToolUse: [{ matcher: "Bash", hooks: [userCopy] }],
    });
  });

  it("does not mistake a copy with the same timeout and an extra key for its own", () => {
    const userCopy = { type: "command", command: "echo audit", timeout: 5, note: "mine" };
    const ours = { type: "command", command: "echo audit", timeout: 5 };
    const owned = [{ event: "PreToolUse", matcher: "Bash", command: "echo audit", timeout: 5 }];

    expect(
      removeStaleHooks({ PreToolUse: [{ matcher: "Bash", hooks: [userCopy, ours] }] }, [], owned)
    ).toEqual({ PreToolUse: [{ matcher: "Bash", hooks: [userCopy] }] });
  });

  it("finds its own entry in a later group with the same matcher", () => {
    const userCopy = { type: "command", command: "echo audit" };
    const ours = { type: "command", command: "echo audit", timeout: 5 };
    const currentHooks = {
      PreToolUse: [
        { matcher: "Bash", hooks: [userCopy] },
        { matcher: "Bash", hooks: [ours] },
      ],
    };
    const owned = [{ event: "PreToolUse", matcher: "Bash", command: "echo audit", timeout: 5 }];
    const managed = createHook({
      id: "joyus:audit",
      matcher: "Bash",
      command: "echo audit",
      timeout: 20,
    });

    expect(mergeHooks(currentHooks, [managed], owned)).toEqual({
      PreToolUse: [
        { matcher: "Bash", hooks: [userCopy] },
        { matcher: "Bash", hooks: [{ type: "command", command: "echo audit", timeout: 20 }] },
      ],
    });
    expect(removeStaleHooks(currentHooks, [], owned)).toEqual({
      PreToolUse: [{ matcher: "Bash", hooks: [userCopy] }],
    });
  });

  it("keeps the user's earlier copy when two manifest hooks share one command", () => {
    const userCopy = { type: "command", command: "echo audit", timeout: 30 };
    const currentHooks = {
      PreToolUse: [
        { matcher: "Bash", hooks: [userCopy, { type: "command", command: "echo audit", timeout: 5 }] },
      ],
    };
    const owned = [{ event: "PreToolUse", matcher: "Bash", command: "echo audit", timeout: 5 }];
    const first = createHook({ id: "joyus:a", matcher: "Bash", command: "echo audit", timeout: 20 });
    const second = createHook({ id: "joyus:b", matcher: "Bash", command: "echo audit", timeout: 7 });

    // The second hook refreshes what the first one just wrote, not the user's copy.
    expect(mergeHooks(currentHooks, [first, second], owned)).toEqual({
      PreToolUse: [
        { matcher: "Bash", hooks: [userCopy, { type: "command", command: "echo audit", timeout: 7 }] },
      ],
    });
  });

  it("removes one entry when a copy cannot be told from its own", () => {
    const ours = { type: "command", command: "echo audit", timeout: 5 };
    const exactCopy = { type: "command", command: "echo audit", timeout: 5 };
    const editedCopy = { type: "command", command: "echo audit", timeout: 30 };

    // An exact copy: whichever goes, one identical entry is left.
    expect(
      removeStaleHooks({ PreToolUse: [{ matcher: "Bash", hooks: [exactCopy, ours] }] }, [], [
        { event: "PreToolUse", matcher: "Bash", command: "echo audit", timeout: 5 },
      ])
    ).toEqual({ PreToolUse: [{ matcher: "Bash", hooks: [ours] }] });

    // A record without a timeout (written before it was stored) falls back to
    // position: the first entry with the command is taken, even if it is the
    // user's. This is a known limit.
    expect(
      removeStaleHooks({ PreToolUse: [{ matcher: "Bash", hooks: [editedCopy, ours] }] }, [], [
        { event: "PreToolUse", matcher: "Bash", command: "echo audit" },
      ])
    ).toEqual({ PreToolUse: [{ matcher: "Bash", hooks: [ours] }] });

    // Two records of one command remove one entry.
    expect(
      removeStaleHooks({ PreToolUse: [{ matcher: "Bash", hooks: [ours, editedCopy] }] }, [], [
        { event: "PreToolUse", matcher: "Bash", command: "echo audit", timeout: 5 },
        { event: "PreToolUse", matcher: "Bash", command: "echo audit", timeout: 5 },
      ])
    ).toEqual({ PreToolUse: [{ matcher: "Bash", hooks: [editedCopy] }] });
  });

  it("ignores an owned command that is no longer in the file", () => {
    const userGroup = { matcher: "Bash", hooks: [{ type: "command", command: "echo user-bash" }] };
    const owned = [
      { event: "PreToolUse", matcher: "Bash", command: "echo audit", timeout: 5 },
      { event: "SessionStart", matcher: "startup", command: "echo hello", timeout: 5 },
    ];

    const result = removeStaleHooks({ PreToolUse: [userGroup] }, [], owned);

    expect(result).toEqual({ PreToolUse: [userGroup] });
    expect(result["PreToolUse"]![0]).toBe(userGroup);
  });

  it("removes a joyus: group when the manifest moves its hook to another event", () => {
    const currentHooks = {
      PreToolUse: [
        { matcher: "joyus:hook", hooks: [{ type: "command", command: "echo global hook", timeout: 5 }] },
      ],
    };
    const moved = createHook({ event: "PostToolUse" });

    expect(removeStaleHooks(mergeHooks(currentHooks, [moved]), [moved])).toEqual({
      PostToolUse: [
        { matcher: "joyus:hook", hooks: [{ type: "command", command: "echo global hook", timeout: 5 }] },
      ],
    });
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
      timeout: 5,
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

  it("keeps a copy of a managed command that the user adds before it", async () => {
    const workspace = await createWorkspace();
    const managed = createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit" });
    await reconcile(createManifest({ hooks: [managed] }), createConfig(workspace));

    // The user adds the same command, with their own fields, ahead of the managed entry.
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

    // The manifest changes the timeout: only the managed entry is refreshed.
    await reconcile(
      createManifest({ hooks: [{ ...managed, timeout: 20 }] }),
      createConfig(workspace)
    );
    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [userCopy, { type: "command", command: "echo audit", timeout: 20 }],
          },
        ],
      },
    });

    // Revocation removes the managed entry and leaves the user's copy.
    const revoked = await reconcile(createManifest({ hooks: [] }), createConfig(workspace));
    expect(revoked).toMatchObject({ status: "success", entriesRemoved: 1 });
    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [userCopy] }] },
    });
  });

  it("writes two-space JSON when it changes a file, with the same content", async () => {
    const workspace = await createWorkspace();
    const userSettings = {
      model: "example-model",
      hooks: {
        PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "echo user" }] }],
      },
    };
    await mkdir(dirname(workspace.globalSettingsPath), { recursive: true });
    await writeFile(workspace.globalSettingsPath, JSON.stringify(userSettings, null, 4), "utf8");
    const managed = createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit" });

    await reconcile(createManifest({ hooks: [managed] }), createConfig(workspace));
    await reconcile(createManifest({ hooks: [] }), createConfig(workspace));

    // The content is back to the user's. The layout is this tool's, not the user's.
    expect(await readJson(workspace.globalSettingsPath)).toEqual(userSettings);
    expect(await readFile(workspace.globalSettingsPath, "utf8")).toBe(
      JSON.stringify(userSettings, null, 2) + "\n"
    );
  });

  it("moves a joyus: group when its hook changes event", async () => {
    const workspace = await createWorkspace();
    await reconcile(createManifest({ hooks: [createHook()] }), createConfig(workspace));

    await reconcile(
      createManifest({ hooks: [createHook({ event: "PostToolUse" })] }),
      createConfig(workspace)
    );

    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: {
        PostToolUse: [
          {
            matcher: "joyus:hook",
            hooks: [{ type: "command", command: "echo global hook", timeout: 5 }],
          },
        ],
      },
    });
  });

  it("treats a registry file of the wrong shape as lost and rebuilds it", async () => {
    const wrongShapes = [
      "{}",
      '{"entries":null}',
      '{"schema_version":"1.0","entries":{"hook:PreToolUse:joyus:hook":null},"last_reconciled":"x"}',
      "[]",
      '"text"',
    ];

    for (const content of wrongShapes) {
      const workspace = await createWorkspace();
      await writeJson(workspace.globalSettingsPath, {
        hooks: {
          PreToolUse: [
            { matcher: "joyus:hook", hooks: [{ type: "command", command: "echo old", timeout: 5 }] },
          ],
        },
      });
      await writeFile(workspace.registryPath, content, "utf8");

      const result = await reconcile(
        createManifest({ hooks: [createHook({ command: "echo new" })] }),
        createConfig(workspace)
      );

      // Repaired from settings, as for a missing file: the group is known, so it is an update.
      expect(result).toMatchObject({ status: "success", entriesAdded: 0, entriesUpdated: 1 });
      const registry = (await readJson(workspace.registryPath)) as {
        entries: Record<string, { command?: string }>;
      };
      expect(registry.entries["hook:PreToolUse:joyus:hook"]).toMatchObject({ command: "echo new" });
    }
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

  it("still owns a command whose registry record has no timeout", async () => {
    const workspace = await createWorkspace();
    const installedAt = "2026-03-01T00:00:00.000Z";
    const userHook = { type: "command", command: "echo user-bash" };
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [userHook, { type: "command", command: "echo audit", timeout: 5 }],
          },
        ],
      },
    };
    const seedRegistry = () =>
      writeJson(workspace.registryPath, {
        schema_version: "1.0",
        entries: {
          "hook:PreToolUse:joyus:audit": {
            type: "hook",
            bundle: "core",
            manifest_version: "1.0.0",
            event: "PreToolUse",
            matcher: "Bash",
            command: "echo audit",
            target: "global",
            installed_at: installedAt,
          },
        },
        last_reconciled: installedAt,
      });
    const managed = createHook({ id: "joyus:audit", matcher: "Bash", command: "echo audit" });

    // Still listed: the record gains the timeout, and settings do not change.
    await writeJson(workspace.globalSettingsPath, settings);
    await seedRegistry();
    const kept = await reconcile(createManifest({ hooks: [managed] }), createConfig(workspace));
    expect(kept).toMatchObject({ status: "success", entriesAdded: 0, entriesUpdated: 1 });
    expect(kept.backupPath).toBeUndefined();
    const registry = (await readJson(workspace.registryPath)) as {
      entries: Record<string, { timeout?: number; installed_at: string }>;
    };
    expect(registry.entries["hook:PreToolUse:joyus:audit"]).toMatchObject({
      timeout: 5,
      installed_at: installedAt,
    });

    // Revoked while the record still has no timeout: the command is removed.
    await seedRegistry();
    await reconcile(createManifest({ hooks: [] }), createConfig(workspace));
    expect(await readJson(workspace.globalSettingsPath)).toEqual({
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [userHook] }] },
    });
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

**4d.** At the very end of `test/registry.test.ts`, after the closing `});` of `describe("repairRegistry")`, add this new block:

<!-- block: tests-registry-read -->

```ts
describe("readRegistry shape check", () => {
  it("returns undefined for JSON that is not a registry", async () => {
    const dir = await tmpDir();
    const filePath = join(dir, "registry.json");
    const wrongShapes = [
      "{}",
      "null",
      "[]",
      '"text"',
      '{"entries":null}',
      '{"entries":[]}',
      '{"entries":{"hook:PreToolUse:joyus:test":null}}',
      '{"entries":{"hook:PreToolUse:joyus:test":"text"}}',
    ];

    for (const content of wrongShapes) {
      await writeFile(filePath, content, "utf8");
      expect(await readRegistry(filePath)).toBeUndefined();
    }
  });

  it("accepts a registry with no entries", async () => {
    const dir = await tmpDir();
    const filePath = join(dir, "registry.json");
    const empty = { schema_version: "1.0", entries: {}, last_reconciled: "2026-01-01T00:00:00.000Z" };
    await writeFile(filePath, JSON.stringify(empty), "utf8");

    expect(await readRegistry(filePath)).toEqual(empty);
  });
});
```

**Verify**: `pnpm vitest run packages/settings-reconciler` → 157 pass. `pnpm vitest run apps/desktop-companion/test/sidecar/configCheckWiring.test.ts` → 50 pass. Commit (commit 1, together with Steps 1–3).

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

- Sixteen new helper tests. They cover: a shared group keeps the user's hooks; an identical user command is left as the same object; an owned entry is refreshed in place; two manifest hooks with one command write one entry; removal takes only the owned command; a changed command is replaced; an all-owned group and its event are dropped; an unowned command is never removed; the tool's own entry is found when the user's copy comes first, has an extra key, or sits in an earlier group; two manifest hooks do not touch the user's earlier copy; indistinguishable copies; an owned command that is gone from the file; a `joyus:` group whose hook changes event; malformed shapes.
- Fifteen new `reconcile` tests through real files. They cover: install then revoke beside a user hook; an identical user command that is never rewritten or removed; the same while another managed hook comes and goes; a copy the user adds before the managed entry, through refresh and revocation; the two-space layout after a write; a `joyus:` group that changes event; a registry file of the wrong shape; ownership once the user deletes their copy; refresh in place and a target move; a lost registry; a registry record without a timeout; upgrade of an old-format registry entry; `null` as a settings file; `null` in a hook list; a repair that throws.
- Four new registry tests: `repairRegistry` on JSON that is not an object and on groups that are not objects; `readRegistry` on JSON that is not a registry and on a registry with no entries.
- Three existing tests updated for the new call shape and the new entry fields.
- Structural pattern: the existing tests in the same `describe` blocks.
- Verification: `pnpm vitest run packages/settings-reconciler` → 157 pass (35 more than before this plan).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm vitest run packages/settings-reconciler` exits 0 with 157 tests
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
- One of the two tests that compare the settings file as text fails: "never rewrites or removes an identical command the user already had", or the last assertion of "installs a tool-scoped hook beside the user's hook and removes only it on revocation". Those are core guarantees of this plan; do not loosen the assertions.
- You find yourself adding a key to `settings.json` to mark ownership, or changing `manifest.ts`.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

What this plan guarantees, and where the guarantee ends:

- **Identical commands the user had first.** If the user already has the exact same command string in a group with the same matcher, the tool writes nothing and records the hook without a `command`. It never refreshes or removes that entry, whatever the manifest later says about timeout or revocation. If the user later deletes their copy, the next reconcile installs the managed one and owns it. The comparison is on the command string only: an entry with the same command and a different `type` or `timeout` still counts as the user's.
- **Copies the user adds later.** The tool recognizes its own entry by what it wrote: `type`, the command and the recorded timeout, with no other keys. A copy with any other timeout or any extra key is left alone, wherever it sits. A copy that is exactly identical cannot be told apart, and does not need to be: whichever entry is refreshed or removed, the file ends up the same apart from the order of two identical entries.
- **Where that recognition ends.** Position decides, and the first entry with the command is taken, in two cases. One: the registry record has no timeout, which is true of records written by the first revision of this plan (pull request #13 before it is updated). Two: the user edited the managed entry itself *and* also keeps a copy of the command. Both are pinned by the test "removes one entry when a copy cannot be told from its own".
- **Lost registry.** If `~/.claude/.joyus-managed.json` is deleted, or holds JSON that is not a registry, repair can only rediscover groups with a `joyus:` matcher and MCP servers. A managed hook with a real matcher is **not** re-adopted: nothing in `settings.json` says this tool wrote it, so from then on it is treated as the user's and a revocation leaves it in place. This is the cost of keeping markers out of `settings.json`, and of never claiming a command the user may have written. The test "treats a tool-scoped hook as the user's after the registry is lost" pins it.
- **Hooks installed before this plan.** A hook with a real matcher that the code at `363bb14` installed has a registry record with no `command`. After this plan it counts as the user's and is never revoked. That is the safe direction, and nothing has shipped: no installed base exists. Hooks in `joyus:` groups are upgraded on the next run.
- **Edited commands.** If the user edits the command string of a managed entry, the tool no longer recognizes it. It adds the manifest's version beside it and does not remove the edited one. If the user edits only another field of a managed entry, such as `timeout`, the next reconcile sets it back to the manifest's value.
- **File layout.** When the tool writes a settings file, it writes two-space JSON with a trailing newline. A file the user kept in another layout comes back with the same content in that layout. When the tool has nothing to change, it does not write, and the bytes stay as they were. Both are pinned by tests.
- **Several groups with one matcher.** The managed command joins the first group with that matcher whose `hooks` is a list. A group whose `hooks` is not a list is left alone, and a new group is added instead.
- **`joyus:` groups.** They are still replaced as a whole and removed by prefix. A user who edits such a group loses the edit on the next reconcile, as before. New in this plan: a group is kept only while the manifest lists its matcher under the same event.
- **Duplicate ids.** Two hooks with the same `event` and `id` in one manifest share a registry key; only the last is recorded. The manifest validator does not reject this.
- **Registry key change.** Keys were `hook:<event>:<matcher>` and are now `hook:<event>:<id>`. For a hook whose id differs from its matcher, the first run after this change counts one entry removed and one added. `settings.json` is not affected.
- **Malformed hook values are dropped on a rewrite.** `normalizeHooksRecord` keeps only event values that are lists. A settings file with, say, a string where a list belongs loses that value whenever the file is rewritten. This is in the code on `main` today and is not changed here.
- `configCheckWiring.ts` still detects revocations by comparing `hook:<event>:<matcher>` ids between manifests. With real matchers, two hooks can share that id. Plan 013 replaces that logic.
- Reviewer focus: `planHookMerge` must never change or drop an entry it did not write, and `removeStaleHooks` must remove a non-legacy entry only when its exact event, matcher and command are in the registry and not in the manifest.
