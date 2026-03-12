import type { DesktopSyncDeps, SyncMetadata } from "./types";

export async function readVersionPin(
  configPath: string,
  bundleName: string,
  deps: Pick<DesktopSyncDeps, "readFile">
): Promise<string> {
  const raw = await deps.readFile(configPath, "utf-8");
  const config: unknown = JSON.parse(raw);

  if (
    typeof config !== "object" ||
    config === null ||
    !("bundles" in config) ||
    typeof (config as Record<string, unknown>)["bundles"] !== "object" ||
    (config as Record<string, unknown>)["bundles"] === null
  ) {
    throw new Error(`Invalid distribution config: missing bundles`);
  }

  const bundles = (config as Record<string, Record<string, unknown>>)["bundles"] as Record<
    string,
    unknown
  >;
  const bundle = bundles[bundleName];

  if (
    typeof bundle !== "object" ||
    bundle === null ||
    !("version" in bundle) ||
    typeof (bundle as Record<string, unknown>)["version"] !== "string"
  ) {
    throw new Error(`Bundle "${bundleName}" not found or missing version`);
  }

  return (bundle as Record<string, string>)["version"];
}

export function hasVersionChanged(currentVersion: string, newVersion: string): boolean {
  return currentVersion !== newVersion;
}

export async function updateSyncMetadata(
  metadataPath: string,
  version: string,
  deps: Pick<DesktopSyncDeps, "writeFile" | "now">
): Promise<SyncMetadata> {
  const timestamp = deps.now();
  const metadata: SyncMetadata = {
    version,
    syncedAt: timestamp,
    lastCheckAt: timestamp,
  };
  await deps.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
  return metadata;
}
