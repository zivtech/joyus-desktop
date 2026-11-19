export {
  SUPPORTED_SCHEMA_VERSIONS,
  isValidManifest,
  validateManifest,
  fetchManifest,
} from "./manifest.js";

export type {
  HookEventType,
  SettingsTarget,
  ManifestHook,
  ManifestMcpServer,
  ManifestBundle,
  DistributionManifest,
} from "./manifest.js";

export * from "./registry";

export * from "./settingsFile";

export {
  reconcile,
  mergeHooks,
  removeStaleHooks,
  removeRevokedHooks,
  mergeMcpServers,
  removeStaleMcpServers,
  removeRevokedMcpServers,
  partitionByTarget,
} from "./reconciler.js";

export type { HookGroupRef, OwnedHook, ReconcileConfig, ReconcileResult, ReconcileStatus } from "./reconciler.js";

export * from "./tenantConfig";
