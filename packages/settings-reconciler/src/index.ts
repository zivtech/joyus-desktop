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
  mergeMcpServers,
  removeStaleMcpServers,
  partitionByTarget,
} from "./reconciler.js";

export type { ReconcileConfig, ReconcileResult, ReconcileStatus } from "./reconciler.js";

export * from "./tenantConfig";
