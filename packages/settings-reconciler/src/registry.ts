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
  readonly target: SettingsTarget;
  readonly installed_at: string;
}

export interface ManagedRegistry {
  readonly schema_version: string;
  readonly entries: Readonly<Record<string, RegistryEntry>>;
  readonly last_reconciled: string;
}

// T008: Read registry

export async function readRegistry(registryPath: string): Promise<ManagedRegistry | undefined> {
  try {
    const raw = await readFile(registryPath, "utf8");
    return JSON.parse(raw) as ManagedRegistry;
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

interface SettingsHookMatcher {
  matcher?: string;
  hooks?: Array<{ command?: string }>;
}

interface SettingsJson {
  hooks?: Partial<Record<string, SettingsHookMatcher[]>>;
  mcpServers?: Record<string, unknown>;
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

  // Scan mcpServers for joyus:-prefixed keys
  if (settings.mcpServers != null) {
    for (const key of Object.keys(settings.mcpServers)) {
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
