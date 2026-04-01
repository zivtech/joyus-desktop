import { access } from "node:fs/promises";
import { homedir, cpus, totalmem } from "node:os";

import { createDockerClient } from "./dockerClient.js";
import type { DockerClient } from "./dockerClient.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExecCommand = (
  args: readonly string[],
  cwd?: string,
) => Promise<{ stdout: string; stderr: string }>;

export type AccessFn = (path: string) => Promise<void>;

export type CreateDockerClientFn = (socketPath: string) => DockerClient;

export type CpusFn = () => readonly { model: string; speed: number; times: { user: number; nice: number; sys: number; idle: number; irq: number } }[];

export type TotalMemFn = () => number;

export interface RuntimeCheckResult {
  readonly dockerInstalled: boolean;
  readonly dockerRunning: boolean;
  readonly dockerProvider: "docker-desktop" | "orbstack" | undefined;
  readonly dockerVersion: string | undefined;
  readonly socketPath: string | undefined;
  readonly ddevInstalled: boolean;
  readonly ddevVersion: string | undefined;
  readonly ddevDockerPlatform: string | undefined;
  readonly systemCpus: number | undefined;
  readonly systemMemoryBytes: number | undefined;
}

export interface RuntimeDetector {
  /** Probe for Docker and DDEV installations. */
  check(): Promise<RuntimeCheckResult>;

  /** Install OrbStack (preferred) or Docker Desktop. Returns true on success. */
  installContainerRuntime(
    provider: "orbstack" | "docker-desktop",
  ): Promise<boolean>;

  /** Install DDEV via platform package manager. Returns true on success. */
  installDdev(): Promise<boolean>;
}

export interface RuntimeDetectorDeps {
  readonly execCommand: ExecCommand;
  readonly accessFn?: AccessFn;
  readonly createDockerClientFn?: CreateDockerClientFn;
  readonly cpusFn?: CpusFn;
  readonly totalMemFn?: TotalMemFn;
}

// ─── Socket probing ──────────────────────────────────────────────────────────

function candidateSockets(home: string): readonly string[] {
  return [
    `${home}/.docker/run/docker.sock`,
    `${home}/.orbstack/run/docker.sock`,
    "/var/run/docker.sock",
  ];
}

async function socketAccessible(
  accessFn: AccessFn,
  path: string,
): Promise<boolean> {
  try {
    await accessFn(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveSocketPath(
  accessFn: AccessFn,
  envDockerHost: string | undefined,
): Promise<string | undefined> {
  if (envDockerHost !== undefined && envDockerHost !== "") {
    const unixPrefix = "unix://";
    if (envDockerHost.startsWith(unixPrefix)) {
      return envDockerHost.slice(unixPrefix.length);
    }
    // Non-unix DOCKER_HOST (tcp/etc.) — not a local socket path
    return undefined;
  }

  const home = homedir();
  for (const candidate of candidateSockets(home)) {
    if (await socketAccessible(accessFn, candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function inferProvider(
  socketPath: string,
): "docker-desktop" | "orbstack" | undefined {
  if (socketPath.includes(".orbstack")) return "orbstack";
  // .docker path or /var/run/docker.sock — treat as docker-desktop
  return "docker-desktop";
}

// ─── DDEV detection ──────────────────────────────────────────────────────────

interface DdevVersionJson {
  raw?: {
    ddev_version?: string;
    docker_platform?: string;
  };
}

async function checkDdev(execCommand: ExecCommand): Promise<{
  installed: boolean;
  version: string | undefined;
  dockerPlatform: string | undefined;
}> {
  try {
    const { stdout } = await execCommand(["ddev", "version", "-j"]);
    const parsed = JSON.parse(stdout) as DdevVersionJson;
    return {
      installed: true,
      version: parsed.raw?.ddev_version,
      dockerPlatform: parsed.raw?.docker_platform,
    };
  } catch {
    return { installed: false, version: undefined, dockerPlatform: undefined };
  }
}

// ─── Install helpers ─────────────────────────────────────────────────────────

async function runInstall(
  execCommand: ExecCommand,
  args: readonly string[],
): Promise<boolean> {
  try {
    await execCommand(args);
    return true;
  } catch {
    return false;
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createRuntimeDetector(
  execCommandOrDeps: ExecCommand | RuntimeDetectorDeps,
): RuntimeDetector {
  const deps: RuntimeDetectorDeps =
    typeof execCommandOrDeps === "function"
      ? { execCommand: execCommandOrDeps }
      : execCommandOrDeps;

  const {
    execCommand,
    accessFn = access as AccessFn,
    createDockerClientFn = createDockerClient,
    cpusFn = cpus as CpusFn,
    totalMemFn = totalmem,
  } = deps;

  return {
    async check(): Promise<RuntimeCheckResult> {
      const envDockerHost = process.env["DOCKER_HOST"];
      const socketPath = await resolveSocketPath(accessFn, envDockerHost);

      let dockerInstalled = false;
      let dockerRunning = false;
      let dockerProvider: "docker-desktop" | "orbstack" | undefined;
      let dockerVersion: string | undefined;

      if (socketPath !== undefined) {
        dockerInstalled = true;
        const client = createDockerClientFn(socketPath);
        dockerRunning = await client.ping();

        if (dockerRunning) {
          dockerProvider = inferProvider(socketPath);
          const info = await client.info();
          dockerVersion = info?.serverVersion;
        }
      }

      const ddev = await checkDdev(execCommand);

      return {
        dockerInstalled,
        dockerRunning,
        dockerProvider,
        dockerVersion,
        socketPath,
        ddevInstalled: ddev.installed,
        ddevVersion: ddev.version,
        ddevDockerPlatform: ddev.dockerPlatform,
        systemCpus: cpusFn().length,
        systemMemoryBytes: totalMemFn(),
      };
    },

    async installContainerRuntime(
      provider: "orbstack" | "docker-desktop",
    ): Promise<boolean> {
      if (provider === "orbstack") {
        return runInstall(execCommand, [
          "brew",
          "install",
          "--cask",
          "orbstack",
        ]);
      }
      return runInstall(execCommand, ["brew", "install", "--cask", "docker"]);
    },

    async installDdev(): Promise<boolean> {
      return runInstall(execCommand, ["brew", "install", "ddev/ddev/ddev"]);
    },
  };
}
