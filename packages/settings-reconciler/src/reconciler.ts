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

function buildActiveHookIds(hooks: readonly ManifestHook[]): ReadonlySet<string> {
  return new Set(hooks.map((hook) => hook.matcher));
}

function buildActiveMcpIds(servers: readonly ManifestMcpServer[]): ReadonlySet<string> {
  return new Set(servers.map((server) => server.id));
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
    return {
      backupPath: undefined,
      changed: false,
      existedBefore: false,
    };
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

    const nextRegistry = buildNewRegistry(manifest, currentRegistry, now);
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
