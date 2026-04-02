import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";

import type { DistributionManifest } from "./manifest.js";

export interface TenantConfig {
  readonly tenant_id: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly updated_at: string;
}

const DEFAULT_CONFIG_PATH = "~/.claude/.joyus-config.json";

export function resolveHomePath(p: string): string {
  if (p === "~") {
    return homedir();
  }
  if (p.startsWith("~/")) {
    return homedir() + p.slice(1);
  }
  return p;
}

export function resolveConfigPath(manifest: DistributionManifest): string {
  const configPath = manifest.config_path ?? DEFAULT_CONFIG_PATH;
  return resolveHomePath(configPath);
}

export function aggregateTenantConfig(
  manifest: DistributionManifest,
  now: () => Date = () => new Date()
): TenantConfig {
  const parameters: Record<string, unknown> = {};

  for (const key of Object.keys(manifest.bundles).sort()) {
    const bundle = manifest.bundles[key];
    if (bundle?.config != null) {
      Object.assign(parameters, bundle.config);
    }
  }

  return {
    tenant_id: manifest.tenant_id,
    parameters,
    updated_at: now().toISOString(),
  };
}

export async function writeTenantConfig(
  config: TenantConfig,
  configPath: string
): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  const tmpPath = `${configPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  await rename(tmpPath, configPath);
}
