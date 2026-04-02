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
