import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  DistributionManifest,
  HookEventType,
  ManifestHook,
  ManifestMcpServer,
  SettingsTarget,
} from "./manifest.js";
import { SUPPORTED_SCHEMA_VERSIONS } from "./manifest.js";
import type { ManagedRegistry, RegistryEntry } from "./registry.js";
import { readRegistry, repairRegistry, writeRegistry } from "./registry.js";
import {
  createSettingsBackup,
  readSettingsFile,
  readSettingsFileStrict,
  rollbackSettings,
  writeSettingsFile,
} from "./settingsFile.js";

export type ReconcileStatus = "success" | "rolled_back" | "skipped" | "error";

export interface ReconcileConfig {
  readonly globalSettingsPath?: string;
  readonly projectSettingsPath?: string;
  readonly registryPath?: string;
  readonly backupDir?: string;
  readonly maxBackups?: number;
  /**
   * When true, only remove what the registry records as installed and the
   * manifest no longer lists. Nothing is added, updated or moved, and the
   * registry entries that survive are kept exactly as they were. Each
   * settings file is handled on its own.
   */
  readonly removalsOnly?: boolean;
  readonly now?: () => Date;
}

export interface ReconcileResult {
  readonly status: ReconcileStatus;
  readonly entriesAdded: number;
  readonly entriesUpdated: number;
  readonly entriesRemoved: number;
  readonly backupPath?: string;
  readonly registryPath: string;
  readonly error?: string;
}

interface Partition {
  global: { hooks: ManifestHook[]; mcps: ManifestMcpServer[] };
  project: { hooks: ManifestHook[]; mcps: ManifestMcpServer[] };
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveTarget(target: SettingsTarget | undefined): SettingsTarget {
  return target === "project" ? "project" : "global";
}

function resolveDefaultPath(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }

  return path;
}

function normalizeHooksRecord(value: unknown): Record<string, unknown[]> {
  if (!isRecord(value)) {
    return {};
  }

  const normalized: Record<string, unknown[]> = {};
  for (const [event, groups] of Object.entries(value)) {
    if (Array.isArray(groups)) {
      normalized[event] = groups.slice();
    }
  }

  return normalized;
}

function normalizeMcpRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  return { ...value };
}

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

export function mergeMcpServers(
  currentServers: Record<string, unknown>,
  manifestServers: readonly ManifestMcpServer[]
): Record<string, unknown> {
  const mergedServers = normalizeMcpRecord(currentServers);

  for (const server of manifestServers) {
    const nextServer: Record<string, unknown> = { command: server.command };

    if (server.args !== undefined) {
      nextServer["args"] = [...server.args];
    }
    if (server.env !== undefined) {
      nextServer["env"] = { ...server.env };
    }

    mergedServers[server.id] = nextServer;
  }

  return mergedServers;
}

export function removeStaleMcpServers(
  currentServers: Record<string, unknown>,
  activeIds: ReadonlySet<string>
): Record<string, unknown> {
  const nextServers: Record<string, unknown> = {};

  for (const [id, server] of Object.entries(normalizeMcpRecord(currentServers))) {
    if (id.startsWith("joyus:") && !activeIds.has(id)) {
      continue;
    }

    nextServers[id] = server;
  }

  return nextServers;
}

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

export function partitionByTarget(
  hooks: readonly ManifestHook[],
  mcpServers: readonly ManifestMcpServer[]
): Partition {
  const partition: Partition = {
    global: { hooks: [], mcps: [] },
    project: { hooks: [], mcps: [] },
  };

  for (const hook of hooks) {
    partition[resolveTarget(hook.target)].hooks.push(hook);
  }

  for (const server of mcpServers) {
    partition[resolveTarget(server.target)].mcps.push(server);
  }

  return partition;
}

function collectAllHooks(manifest: DistributionManifest): ManifestHook[] {
  return Object.values(manifest.bundles).flatMap((bundle) => [...(bundle.hooks ?? [])]);
}

function collectAllMcpServers(manifest: DistributionManifest): ManifestMcpServer[] {
  return Object.values(manifest.bundles).flatMap((bundle) => [...(bundle.mcpServers ?? [])]);
}

function buildActiveMcpIds(servers: readonly ManifestMcpServer[]): ReadonlySet<string> {
  return new Set(servers.map((server) => server.id));
}

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

function scanManagedEntries(
  settings: Record<string, unknown>,
  target: SettingsTarget,
  installedAt: string
): Record<string, RegistryEntry> {
  const entries: Record<string, RegistryEntry> = {};
  const hooks = normalizeHooksRecord(settings["hooks"]);

  for (const event of HOOK_EVENT_TYPES) {
    for (const group of hooks[event] ?? []) {
      if (!isRecord(group) || typeof group["matcher"] !== "string") {
        continue;
      }
      if (!group["matcher"].startsWith("joyus:")) {
        continue;
      }

      entries[`hook:${event}:${group["matcher"]}`] = {
        type: "hook",
        bundle: "unknown",
        manifest_version: "unknown",
        event,
        target,
        installed_at: installedAt,
      };
    }
  }

  for (const id of Object.keys(normalizeMcpRecord(settings["mcpServers"]))) {
    if (!id.startsWith("joyus:")) {
      continue;
    }

    entries[`mcp:${id}`] = {
      type: "mcp",
      bundle: "unknown",
      manifest_version: "unknown",
      target,
      installed_at: installedAt,
    };
  }

  return entries;
}

async function repairRegistryFromSettings(
  globalSettingsPath: string,
  projectSettingsPath: string,
  now: () => Date
): Promise<ManagedRegistry> {
  const repairedGlobalRegistry = await repairRegistry(globalSettingsPath, now);
  const projectSettings = await readSettingsFile(projectSettingsPath);

  return {
    schema_version: repairedGlobalRegistry.schema_version,
    entries: {
      ...repairedGlobalRegistry.entries,
      ...scanManagedEntries(
        projectSettings,
        "project",
        repairedGlobalRegistry.last_reconciled
      ),
    },
    last_reconciled: repairedGlobalRegistry.last_reconciled,
  };
}

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

function computeCounts(
  previousRegistry: ManagedRegistry,
  nextRegistry: ManagedRegistry
): { added: number; updated: number; removed: number } {
  const previousEntries = previousRegistry.entries;
  const nextEntries = nextRegistry.entries;

  let added = 0;
  let updated = 0;
  let removed = 0;

  for (const [key, entry] of Object.entries(nextEntries)) {
    const previousEntry = previousEntries[key];
    if (previousEntry === undefined) {
      added += 1;
      continue;
    }

    if (!registryEntryEquals(previousEntry, entry)) {
      updated += 1;
    }
  }

  for (const key of Object.keys(previousEntries)) {
    if (!(key in nextEntries)) {
      removed += 1;
    }
  }

  return { added, updated, removed };
}

function settingsEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function withOptionalBackupPath(
  result: Omit<ReconcileResult, "backupPath">,
  backupPath: string | undefined
): ReconcileResult {
  if (backupPath === undefined) {
    return result;
  }

  return { ...result, backupPath };
}

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

async function rollbackReconciledSettings(
  settingsPath: string,
  updateResult: SettingsUpdateResult
): Promise<void> {
  if (!updateResult.changed) {
    return;
  }

  if (updateResult.backupPath !== undefined) {
    await rollbackSettings(settingsPath, updateResult.backupPath);
    return;
  }

  if (!updateResult.existedBefore) {
    await rm(settingsPath, { force: true });
  }
}

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
