import type { GovernanceConfig, GovernanceDeps } from "./types";

const DEFAULT_CONFIG: GovernanceConfig = { mode: "off", updatedAt: "" };

interface FileReader {
  readFile: (path: string) => Promise<string>;
}

function isValidMode(value: unknown): value is GovernanceConfig["mode"] {
  return value === "off" || value === "audit" || value === "enforce";
}

export function parseGovernanceConfig(
  raw: string,
  configPath: string,
  log: GovernanceDeps["log"]
): GovernanceConfig {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    log("warn", `Governance config at ${configPath} is not valid JSON, using defaults`);
    return DEFAULT_CONFIG;
  }

  if (!parsed || typeof parsed !== "object") {
    log("warn", `Governance config at ${configPath} is not an object, using defaults`);
    return DEFAULT_CONFIG;
  }

  const obj = parsed as Record<string, unknown>;
  const governance = obj["governance"];

  if (!governance || typeof governance !== "object") {
    log("warn", `No governance section in config at ${configPath}, using defaults`);
    return DEFAULT_CONFIG;
  }

  const section = governance as Record<string, unknown>;
  const mode = section["mode"];
  const updatedAt = section["updatedAt"];

  if (!isValidMode(mode)) {
    log("warn", `Invalid governance mode in config at ${configPath}, using defaults`);
    return DEFAULT_CONFIG;
  }

  return {
    mode,
    updatedAt: typeof updatedAt === "string" ? updatedAt : ""
  };
}

export async function readGovernanceConfig(
  configPath: string,
  deps: Pick<GovernanceDeps, "log"> & { fs: FileReader }
): Promise<GovernanceConfig> {
  let raw: string;

  try {
    raw = await deps.fs.readFile(configPath);
  } catch {
    deps.log("warn", `Governance config not found at ${configPath}, using defaults`);
    return DEFAULT_CONFIG;
  }

  return parseGovernanceConfig(raw, configPath, deps.log);
}

export interface ConfigPoller {
  start: () => Promise<void>;
  stop: () => void;
  getConfig: () => GovernanceConfig;
}

export function createConfigPoller(
  configPath: string,
  intervalMs: number,
  deps: Pick<GovernanceDeps, "log"> & { fs: FileReader }
): ConfigPoller {
  let cached: GovernanceConfig = DEFAULT_CONFIG;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function poll(): Promise<void> {
    try {
      const raw = await deps.fs.readFile(configPath);
      cached = parseGovernanceConfig(raw, configPath, deps.log);
    } catch (err: unknown) {
      /* v8 ignore next */
      const message = err instanceof Error ? err.message : String(err);
      deps.log("warn", `Config poll failed, keeping previous config: ${message}`);
    }
  }

  return {
    async start(): Promise<void> {
      if (timer !== null) {
        return;
      }
      await poll();
      timer = setInterval(() => void poll(), intervalMs);
    },

    stop(): void {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },

    getConfig(): GovernanceConfig {
      return cached;
    }
  };
}
