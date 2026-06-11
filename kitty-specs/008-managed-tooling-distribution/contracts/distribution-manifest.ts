/**
 * Distribution Manifest — served by control plane per tenant.
 * This is the contract between the control plane and the settings reconciler.
 */

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
