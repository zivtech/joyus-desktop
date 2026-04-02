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

export interface ManifestHook {
  readonly id: string;
  readonly event: HookEventType;
  readonly matcher: string;
  readonly command: string;
  readonly timeout?: number;
  readonly target?: SettingsTarget;
}

export interface ManifestMcpServer {
  readonly id: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly target?: SettingsTarget;
}

export interface ManifestBundle {
  readonly version: string;
  readonly hooks?: readonly ManifestHook[];
  readonly mcpServers?: readonly ManifestMcpServer[];
  readonly config?: Readonly<Record<string, unknown>>;
}

export interface DistributionManifest {
  readonly schema_version: string;
  readonly tenant_id: string;
  readonly bundles: Readonly<Record<string, ManifestBundle>>;
  readonly config_path?: string;
}

export const SUPPORTED_SCHEMA_VERSIONS = ["1.0"] as const;

const VALID_HOOK_EVENTS = new Set<string>([
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
]);

function isValidHook(value: unknown): value is ManifestHook {
  if (!value || typeof value !== "object") {
    return false;
  }
  const h = value as Record<string, unknown>;
  if (typeof h["id"] !== "string" || !h["id"].startsWith("joyus:")) {
    return false;
  }
  if (typeof h["event"] !== "string" || !VALID_HOOK_EVENTS.has(h["event"])) {
    return false;
  }
  if (typeof h["matcher"] !== "string") {
    return false;
  }
  if (typeof h["command"] !== "string" || h["command"].length === 0) {
    return false;
  }
  return true;
}

function isValidMcpServer(value: unknown): value is ManifestMcpServer {
  if (!value || typeof value !== "object") {
    return false;
  }
  const s = value as Record<string, unknown>;
  if (typeof s["id"] !== "string" || !s["id"].startsWith("joyus:")) {
    return false;
  }
  if (typeof s["command"] !== "string" || s["command"].length === 0) {
    return false;
  }
  return true;
}

function isValidBundle(value: unknown): value is ManifestBundle {
  if (!value || typeof value !== "object") {
    return false;
  }
  const b = value as Record<string, unknown>;
  if (typeof b["version"] !== "string") {
    return false;
  }
  if (b["hooks"] !== undefined) {
    if (!Array.isArray(b["hooks"])) {
      return false;
    }
    for (const hook of b["hooks"]) {
      if (!isValidHook(hook)) {
        return false;
      }
    }
  }
  if (b["mcpServers"] !== undefined) {
    if (!Array.isArray(b["mcpServers"])) {
      return false;
    }
    for (const server of b["mcpServers"]) {
      if (!isValidMcpServer(server)) {
        return false;
      }
    }
  }
  return true;
}

export function isValidManifest(value: unknown): value is DistributionManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const m = value as Record<string, unknown>;
  if (typeof m["schema_version"] !== "string") {
    return false;
  }
  if (typeof m["tenant_id"] !== "string") {
    return false;
  }
  if (!m["bundles"] || typeof m["bundles"] !== "object" || Array.isArray(m["bundles"])) {
    return false;
  }
  for (const bundle of Object.values(m["bundles"] as Record<string, unknown>)) {
    if (!isValidBundle(bundle)) {
      return false;
    }
  }
  return true;
}

export function validateManifest(value: unknown): DistributionManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid manifest: expected an object");
  }
  const m = value as Record<string, unknown>;

  if (typeof m["schema_version"] !== "string") {
    throw new Error("Invalid manifest: missing or invalid schema_version");
  }
  if (!(SUPPORTED_SCHEMA_VERSIONS as readonly string[]).includes(m["schema_version"])) {
    throw new Error(
      `Invalid manifest: unsupported schema_version "${m["schema_version"]}". Supported: ${SUPPORTED_SCHEMA_VERSIONS.join(", ")}`
    );
  }
  if (typeof m["tenant_id"] !== "string") {
    throw new Error("Invalid manifest: missing or invalid tenant_id");
  }
  if (!m["bundles"] || typeof m["bundles"] !== "object" || Array.isArray(m["bundles"])) {
    throw new Error("Invalid manifest: missing or invalid bundles");
  }
  for (const [name, bundle] of Object.entries(m["bundles"] as Record<string, unknown>)) {
    if (!isValidBundle(bundle)) {
      throw new Error(`Invalid manifest: invalid bundle "${name}"`);
    }
  }

  return value as DistributionManifest;
}

export async function fetchManifest(
  url: string,
  fetchImpl?: typeof fetch
): Promise<DistributionManifest> {
  const fetcher = fetchImpl ?? fetch;
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch manifest: ${response.status}`);
  }
  const parsed = (await response.json()) as unknown;
  return validateManifest(parsed);
}
