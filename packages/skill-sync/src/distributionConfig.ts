import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export interface DistributionBundlePin {
  version: string;
}

export interface DistributionConfig {
  schema_version: string;
  default_version: string;
  bundles: Record<string, DistributionBundlePin>;
  updated_at?: string;
  updated_by?: string;
}

export interface ResolvePinnedVersionOptions {
  bundleName?: string;
  configPath?: string;
  configUrl?: string;
  cwd?: string;
  fetchImpl?: typeof fetch;
}

export interface ResolvedPinnedVersion {
  version: string;
  source: "bundle" | "default";
  bundleName?: string;
}

function isValidDistributionConfig(value: unknown): value is DistributionConfig {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<DistributionConfig>;
  if (typeof candidate.schema_version !== "string") {
    return false;
  }

  if (typeof candidate.default_version !== "string") {
    return false;
  }

  if (!candidate.bundles || typeof candidate.bundles !== "object") {
    return false;
  }

  for (const bundle of Object.values(candidate.bundles)) {
    if (!bundle || typeof bundle !== "object" || typeof bundle.version !== "string") {
      return false;
    }
  }

  return true;
}

export function resolveConfigPath(pathValue: string, cwd: string): string {
  if (isAbsolute(pathValue)) {
    return pathValue;
  }

  return join(cwd, pathValue);
}

export async function loadDistributionConfigFromFile(pathValue: string): Promise<DistributionConfig> {
  const raw = await readFile(pathValue, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!isValidDistributionConfig(parsed)) {
    throw new Error(`Invalid distribution config at ${pathValue}`);
  }

  return parsed;
}

export async function loadDistributionConfigFromUrl(
  url: string,
  fetchImpl: typeof fetch
): Promise<DistributionConfig> {
  const response = await fetchImpl(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Failed to fetch distribution config: ${response.status}`);
  }

  const parsed = (await response.json()) as unknown;
  if (!isValidDistributionConfig(parsed)) {
    throw new Error(`Invalid distribution config fetched from ${url}`);
  }

  return parsed;
}

export async function resolvePinnedVersion(
  options: ResolvePinnedVersionOptions
): Promise<ResolvedPinnedVersion> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath ?? "config/distribution-config.json";

  const config = options.configUrl
    ? await loadDistributionConfigFromUrl(options.configUrl, options.fetchImpl ?? fetch)
    : await loadDistributionConfigFromFile(resolveConfigPath(configPath, cwd));

  if (options.bundleName) {
    const entry = config.bundles[options.bundleName];
    if (entry?.version) {
      return {
        version: entry.version,
        source: "bundle",
        bundleName: options.bundleName
      };
    }
  }

  return {
    version: config.default_version,
    source: "default"
  };
}
