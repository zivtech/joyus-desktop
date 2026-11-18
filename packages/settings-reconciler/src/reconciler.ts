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

function buildCommandHook(hook: ManifestHook): Record<string, unknown> {
  return {
    type: "command",
    command: hook.command,
    timeout: hook.timeout ?? 5,
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
      owned.push({ event: entry.event, matcher: entry.matcher, command: entry.command });
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
