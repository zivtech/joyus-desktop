import type { ExecCommand } from "./runtimeDetector.js";
import type { DockerClient, DockerCpuStats } from "./dockerClient.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DdevEnvelope {
  readonly msg: string;
  readonly level: string;
  readonly raw: unknown;
}

export type DdevErrorCode =
  | "port-conflict"
  | "missing-docker"
  | "missing-config"
  | "project-not-found"
  | "unknown";

export interface DdevError {
  readonly code: DdevErrorCode;
  readonly message: string;
  readonly raw: string;
}

export interface DdevProjectInfo {
  readonly name: string;
  readonly status: string;
  readonly httpUrl: string | undefined;
  readonly httpsUrl: string | undefined;
  readonly type: string | undefined;
  readonly location: string | undefined;
}

export interface ResourceSnapshot {
  readonly cpuPercent: number;
  readonly memoryUsageBytes: number;
  readonly memoryLimitBytes: number;
}

export interface DdevCli {
  /** Start a DDEV project. */
  start(projectName: string, cwd?: string): Promise<DdevEnvelope>;

  /** Stop a DDEV project. */
  stop(projectName: string, cwd?: string): Promise<DdevEnvelope>;

  /** Restart a DDEV project. */
  restart(projectName: string, cwd?: string): Promise<DdevEnvelope>;

  /** Delete a DDEV project. */
  delete(projectName: string, cwd?: string): Promise<DdevEnvelope>;

  /** Describe a DDEV project. Returns parsed project info. */
  describe(projectName: string, cwd?: string): Promise<DdevProjectInfo>;

  /** List all DDEV projects. */
  list(cwd?: string): Promise<readonly DdevProjectInfo[]>;

  /** Get DDEV version info. */
  version(): Promise<DdevEnvelope>;

  /** Get resource snapshot for a running DDEV project. Returns undefined if unavailable. */
  resourceSnapshot(projectName: string): Promise<ResourceSnapshot | undefined>;
}

export interface DdevCliDeps {
  readonly execCommand: ExecCommand;
  readonly dockerClient: DockerClient;
}

// ─── Error classification ────────────────────────────────────────────────────

const ERROR_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  code: DdevErrorCode;
  message: string;
}> = [
  {
    pattern: /address already in use|port.*in use|bind.*already|port.*conflict/i,
    code: "port-conflict",
    message:
      "A port required by this site is already in use. Close the conflicting application and try again.",
  },
  {
    pattern: /docker.*not running|cannot connect to the docker daemon|docker daemon.*not running|is the docker daemon running/i,
    code: "missing-docker",
    message:
      "Docker is not running. Start Docker Desktop or OrbStack and try again.",
  },
  {
    pattern: /no such file.*ddev\.yaml|\.ddev\/config\.yaml.*not found|no ddev config|not a valid ddev project/i,
    code: "missing-config",
    message:
      "No DDEV configuration found in this directory. Run `ddev config` to set up the project first.",
  },
  {
    pattern: /project.*not found|no project named|could not find.*project/i,
    code: "project-not-found",
    message: "The DDEV project was not found. It may have been removed.",
  },
];

export function classifyDdevError(stderr: string): DdevError {
  for (const { pattern, code, message } of ERROR_PATTERNS) {
    if (pattern.test(stderr)) {
      return { code, message, raw: stderr };
    }
  }
  return { code: "unknown", message: "An unexpected error occurred.", raw: stderr };
}

// ─── JSON envelope parsing ───────────────────────────────────────────────────

interface RawEnvelope {
  msg?: unknown;
  level?: unknown;
  raw?: unknown;
}

function parseEnvelope(stdout: string): DdevEnvelope {
  try {
    const parsed = JSON.parse(stdout) as RawEnvelope;
    return {
      msg: typeof parsed.msg === "string" ? parsed.msg : "",
      level: typeof parsed.level === "string" ? parsed.level : "",
      raw: parsed.raw ?? null,
    };
  } catch {
    return { msg: stdout.trim(), level: "info", raw: null };
  }
}

// ─── Project info extraction ─────────────────────────────────────────────────

interface RawProjectInfo {
  name?: unknown;
  status?: unknown;
  httpurl?: unknown;
  httpsurl?: unknown;
  type?: unknown;
  shortroot?: unknown;
}

function parseProjectInfo(raw: unknown): DdevProjectInfo {
  const r = (raw ?? {}) as RawProjectInfo;
  return {
    name: typeof r.name === "string" ? r.name : "",
    status: typeof r.status === "string" ? r.status : "",
    httpUrl: typeof r.httpurl === "string" ? r.httpurl : undefined,
    httpsUrl: typeof r.httpsurl === "string" ? r.httpsurl : undefined,
    type: typeof r.type === "string" ? r.type : undefined,
    location: typeof r.shortroot === "string" ? r.shortroot : undefined,
  };
}

// ─── Resource snapshot ───────────────────────────────────────────────────────

function computeResourceSnapshot(stats: DockerCpuStats): ResourceSnapshot {
  const cpuPercent =
    stats.systemDelta > 0
      ? (stats.cpuDelta / stats.systemDelta) * stats.onlineCpus * 100
      : 0;
  return {
    cpuPercent,
    memoryUsageBytes: stats.memoryUsageBytes,
    memoryLimitBytes: stats.memoryLimitBytes,
  };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createDdevCli(deps: DdevCliDeps): DdevCli {
  const { execCommand, dockerClient } = deps;

  async function runDdev(
    args: readonly string[],
    cwd?: string,
  ): Promise<DdevEnvelope> {
    const fullArgs = ["ddev", ...args, "-j"];
    try {
      const { stdout } = await execCommand(fullArgs, cwd);
      return parseEnvelope(stdout);
    } catch (err: unknown) {
      const stderr =
        err instanceof Error && "stderr" in err
          ? String((err as { stderr: unknown }).stderr)
          : err instanceof Error
            ? err.message
            : String(err);
      const classified = classifyDdevError(stderr);
      const error = new Error(classified.message) as Error & {
        ddevError: DdevError;
      };
      error.ddevError = classified;
      throw error;
    }
  }

  return {
    async start(projectName: string, cwd?: string): Promise<DdevEnvelope> {
      return runDdev(["start", projectName], cwd);
    },

    async stop(projectName: string, cwd?: string): Promise<DdevEnvelope> {
      return runDdev(["stop", projectName], cwd);
    },

    async restart(projectName: string, cwd?: string): Promise<DdevEnvelope> {
      return runDdev(["restart", projectName], cwd);
    },

    async delete(projectName: string, cwd?: string): Promise<DdevEnvelope> {
      return runDdev(["delete", projectName, "--omit-snapshot"], cwd);
    },

    async describe(projectName: string, cwd?: string): Promise<DdevProjectInfo> {
      const envelope = await runDdev(["describe", projectName], cwd);
      return parseProjectInfo(envelope.raw);
    },

    async list(cwd?: string): Promise<readonly DdevProjectInfo[]> {
      const envelope = await runDdev(["list"], cwd);
      const raw = envelope.raw;
      if (!Array.isArray(raw)) return [];
      return raw.map((item) => parseProjectInfo(item as unknown));
    },

    async version(): Promise<DdevEnvelope> {
      return runDdev(["version"]);
    },

    async resourceSnapshot(
      projectName: string,
    ): Promise<ResourceSnapshot | undefined> {
      try {
        const containers = await dockerClient.listContainers();
        const ddevPrefix = `ddev-${projectName}-`;
        const projectContainers = containers.filter((c) =>
          c.names.some((n) => n.replace(/^\//, "").startsWith(ddevPrefix)),
        );

        if (projectContainers.length === 0) return undefined;

        const statsResults = await Promise.all(
          projectContainers.map((c) => dockerClient.containerStats(c.id)),
        );

        const validStats = statsResults.filter(
          (s): s is DockerCpuStats => s !== undefined,
        );

        if (validStats.length === 0) return undefined;

        // Aggregate across all containers
        const aggregated: DockerCpuStats = {
          cpuDelta: validStats.reduce((sum, s) => sum + s.cpuDelta, 0),
          systemDelta: validStats[0]!.systemDelta,
          onlineCpus: validStats[0]!.onlineCpus,
          memoryUsageBytes: validStats.reduce(
            (sum, s) => sum + s.memoryUsageBytes,
            0,
          ),
          memoryLimitBytes: validStats[0]!.memoryLimitBytes,
        };

        return computeResourceSnapshot(aggregated);
      } catch {
        return undefined;
      }
    },
  };
}
