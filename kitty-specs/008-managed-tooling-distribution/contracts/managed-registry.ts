/**
 * Managed Registry — sidecar file tracking ownership of managed entries.
 * Lives at ~/.claude/.joyus-managed.json
 */

import type { HookEventType, SettingsTarget } from "./distribution-manifest";

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
