/**
 * Settings Reconciler — public API contract.
 * The reconciler is a pure library called by desktop-companion after syncSkills().
 */

import type { DistributionManifest } from "./distribution-manifest";
import type { ManagedRegistry } from "./managed-registry";

export type ReconcileStatus = "success" | "rolled_back" | "skipped" | "error";

export interface ReconcileConfig {
  /** Path to global settings file (default: ~/.claude/settings.json) */
  readonly globalSettingsPath?: string;
  /** Path to project settings file (default: .claude/settings.json in cwd) */
  readonly projectSettingsPath?: string;
  /** Path to sidecar registry (default: ~/.claude/.joyus-managed.json) */
  readonly registryPath?: string;
  /** Path to tenant config output file (default: ~/.claude/.joyus-config.json) */
  readonly tenantConfigPath?: string;
  /** Backup directory for pre-reconciliation snapshots */
  readonly backupDir?: string;
  /** Maximum number of backups to retain (default: 5) */
  readonly maxBackups?: number;
  /** Clock function for timestamps (default: () => new Date()) */
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

export interface ConfigCheckConfig {
  /** Control plane manifest URL */
  readonly manifestUrl: string;
  /** Poll interval in milliseconds (default: 300_000 = 5 minutes) */
  readonly intervalMs?: number;
  /** Fetch implementation (default: global fetch) */
  readonly fetchImpl?: typeof fetch;
  /** Callback when config change detected */
  readonly onChangeDetected: (manifest: DistributionManifest) => Promise<void>;
  /** Callback when poll fails */
  readonly onPollError?: (error: Error) => void;
  /** Clock function for timestamps */
  readonly now?: () => Date;
}

export interface ConfigCheckState {
  readonly lastCheckAt?: string;
  readonly lastChangeAt?: string;
  readonly lastVersionHash?: string;
  readonly consecutiveFailures: number;
}

/**
 * Core reconcile function — reads manifest, merges into settings, updates registry.
 */
export type ReconcileFn = (
  manifest: DistributionManifest,
  config?: ReconcileConfig
) => Promise<ReconcileResult>;

/**
 * Registry read function — returns current registry or undefined if missing.
 */
export type ReadRegistryFn = (
  registryPath?: string
) => Promise<ManagedRegistry | undefined>;

/**
 * Registry repair function — rebuilds registry from joyus: prefix scanning.
 */
export type RepairRegistryFn = (
  settingsPath: string,
  registryPath?: string
) => Promise<ManagedRegistry>;
