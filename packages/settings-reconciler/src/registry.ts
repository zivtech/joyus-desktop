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
