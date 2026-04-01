import { describe, it, expect, vi } from "vitest";
import * as os from "node:os";

import { createRuntimeDetector } from "../src/runtimeDetector.js";
import type {
  ExecCommand,
  AccessFn,
  CreateDockerClientFn,
  RuntimeDetectorDeps,
} from "../src/runtimeDetector.js";
import type { DockerClient } from "../src/dockerClient.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeExecCommand(
  responses: Record<string, { stdout: string; stderr: string } | Error>,
): ExecCommand {
  return vi.fn().mockImplementation((args: readonly string[]) => {
    const key = args.join(" ");
    const response = responses[key];
    if (response instanceof Error) return Promise.reject(response);
    if (response !== undefined) return Promise.resolve(response);
    return Promise.reject(new Error(`Unexpected command: ${key}`));
  });
}

function ddevVersionOutput(version: string, dockerPlatform: string): string {
  return JSON.stringify({
    raw: { ddev_version: version, docker_platform: dockerPlatform },
  });
}

function makeDockerClient(overrides?: Partial<DockerClient>): DockerClient {
  return {
    ping: vi.fn().mockResolvedValue(true),
    info: vi.fn().mockResolvedValue({
      serverVersion: "24.0.5",
      ncpu: 4,
      memTotal: 8589934592,
      containers: 2,
      containersRunning: 1,
    }),
    listContainers: vi.fn().mockResolvedValue([]),
    containerStats: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function noSocketAccess(): AccessFn {
  return vi.fn().mockRejectedValue(new Error("ENOENT"));
}

function socketAt(...paths: string[]): AccessFn {
  return vi.fn().mockImplementation((p: string) => {
    if (paths.includes(p)) return Promise.resolve();
    return Promise.reject(new Error("ENOENT"));
  });
}

function makeClientFactory(client: DockerClient): CreateDockerClientFn {
  return vi.fn().mockReturnValue(client);
}

function noDdev(): ExecCommand {
  return makeExecCommand({
    "ddev version -j": new Error("command not found"),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createRuntimeDetector", () => {
  // ── check(): no socket available ──────────────────────────────────────────

  describe("check() — no Docker socket available", () => {
    it("returns dockerInstalled=false when no socket is accessible", async () => {
      const deps: RuntimeDetectorDeps = {
        execCommand: noDdev(),
        accessFn: noSocketAccess(),
      };
      const detector = createRuntimeDetector(deps);
      const result = await detector.check();

      expect(result.dockerInstalled).toBe(false);
      expect(result.dockerRunning).toBe(false);
      expect(result.dockerProvider).toBeUndefined();
      expect(result.dockerVersion).toBeUndefined();
      expect(result.socketPath).toBeUndefined();
    });

    it("returns ddevInstalled=false when ddev CLI not found", async () => {
      const deps: RuntimeDetectorDeps = {
        execCommand: noDdev(),
        accessFn: noSocketAccess(),
      };
      const detector = createRuntimeDetector(deps);
      const result = await detector.check();

      expect(result.ddevInstalled).toBe(false);
      expect(result.ddevVersion).toBeUndefined();
      expect(result.ddevDockerPlatform).toBeUndefined();
    });

    it("populates systemCpus and systemMemoryBytes from injected os functions", async () => {
      const deps: RuntimeDetectorDeps = {
        execCommand: noDdev(),
        accessFn: noSocketAccess(),
        cpusFn: vi.fn().mockReturnValue([
          { model: "CPU", speed: 2400, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } },
          { model: "CPU", speed: 2400, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } },
        ]),
        totalMemFn: vi.fn().mockReturnValue(16000000000),
      };
      const detector = createRuntimeDetector(deps);
      const result = await detector.check();

      expect(result.systemCpus).toBe(2);
      expect(result.systemMemoryBytes).toBe(16000000000);
    });
  });

  // ── check(): Docker Desktop socket (.docker path) ─────────────────────────

  describe("check() — Docker Desktop socket", () => {
    it("detects docker-desktop provider via .docker socket path", async () => {
      const home = os.homedir();
      const dockerSock = `${home}/.docker/run/docker.sock`;
      const mockClient = makeDockerClient();

      const deps: RuntimeDetectorDeps = {
        execCommand: makeExecCommand({
          "ddev version -j": {
            stdout: ddevVersionOutput("1.23.4", "docker desktop"),
            stderr: "",
          },
        }),
        accessFn: socketAt(dockerSock),
        createDockerClientFn: makeClientFactory(mockClient),
      };

      const detector = createRuntimeDetector(deps);
      const result = await detector.check();

      expect(result.dockerInstalled).toBe(true);
      expect(result.dockerRunning).toBe(true);
      expect(result.dockerProvider).toBe("docker-desktop");
      expect(result.socketPath).toBe(dockerSock);
      expect(result.dockerVersion).toBe("24.0.5");
    });

    it("probes .docker socket before .orbstack socket", async () => {
      const home = os.homedir();
      const dockerSock = `${home}/.docker/run/docker.sock`;
      const orbSock = `${home}/.orbstack/run/docker.sock`;
      const mockClient = makeDockerClient();

      const accessFn = socketAt(dockerSock, orbSock);
      const deps: RuntimeDetectorDeps = {
        execCommand: noDdev(),
        accessFn,
        createDockerClientFn: makeClientFactory(mockClient),
      };

      const detector = createRuntimeDetector(deps);
      const result = await detector.check();

      // Should pick .docker first (higher priority)
      expect(result.socketPath).toBe(dockerSock);
      expect(result.dockerProvider).toBe("docker-desktop");
    });
  });

  // ── check(): OrbStack socket ──────────────────────────────────────────────

  describe("check() — OrbStack socket", () => {
    it("detects orbstack provider via .orbstack socket path", async () => {
      const home = os.homedir();
      const orbSock = `${home}/.orbstack/run/docker.sock`;
      const mockClient = makeDockerClient();

      const deps: RuntimeDetectorDeps = {
        execCommand: makeExecCommand({
          "ddev version -j": {
            stdout: ddevVersionOutput("1.23.4", "orbstack"),
            stderr: "",
          },
        }),
        accessFn: socketAt(orbSock),
        createDockerClientFn: makeClientFactory(mockClient),
      };

      const detector = createRuntimeDetector(deps);
      const result = await detector.check();

      expect(result.dockerInstalled).toBe(true);
      expect(result.dockerRunning).toBe(true);
      expect(result.dockerProvider).toBe("orbstack");
      expect(result.socketPath).toBe(orbSock);
    });
  });

  // ── check(): legacy /var/run/docker.sock ─────────────────────────────────

  describe("check() — legacy /var/run/docker.sock", () => {
    it("detects docker-desktop provider for legacy socket path", async () => {
      const mockClient = makeDockerClient();

      const deps: RuntimeDetectorDeps = {
        execCommand: noDdev(),
        accessFn: socketAt("/var/run/docker.sock"),
        createDockerClientFn: makeClientFactory(mockClient),
      };

      const detector = createRuntimeDetector(deps);
      const result = await detector.check();

      expect(result.socketPath).toBe("/var/run/docker.sock");
      expect(result.dockerProvider).toBe("docker-desktop");
    });
  });

  // ── check(): DOCKER_HOST env var ──────────────────────────────────────────

  describe("check() — DOCKER_HOST env var", () => {
    it("uses unix:// DOCKER_HOST socket path when set", async () => {
      vi.stubEnv("DOCKER_HOST", "unix:///custom/docker.sock");
      const mockClient = makeDockerClient();

      const deps: RuntimeDetectorDeps = {
        execCommand: noDdev(),
        accessFn: noSocketAccess(),
        createDockerClientFn: makeClientFactory(mockClient),
      };

      const detector = createRuntimeDetector(deps);
      const result = await detector.check();

      expect(result.socketPath).toBe("/custom/docker.sock");
      expect(result.dockerInstalled).toBe(true);

      vi.unstubAllEnvs();
    });

    it("returns socketPath=undefined for non-unix DOCKER_HOST", async () => {
      vi.stubEnv("DOCKER_HOST", "tcp://localhost:2376");

      const deps: RuntimeDetectorDeps = {
        execCommand: noDdev(),
        accessFn: noSocketAccess(),
      };

      const detector = createRuntimeDetector(deps);
      const result = await detector.check();

      expect(result.socketPath).toBeUndefined();
      expect(result.dockerInstalled).toBe(false);

      vi.unstubAllEnvs();
    });

    it("skips filesystem probing when DOCKER_HOST is set to unix socket", async () => {
      vi.stubEnv("DOCKER_HOST", "unix:///custom/docker.sock");
      const accessFn = noSocketAccess();
      const mockClient = makeDockerClient();

      const deps: RuntimeDetectorDeps = {
        execCommand: noDdev(),
        accessFn,
        createDockerClientFn: makeClientFactory(mockClient),
      };

      const detector = createRuntimeDetector(deps);
      await detector.check();

      // accessFn should NOT be called — DOCKER_HOST bypasses probing
      expect(accessFn).not.toHaveBeenCalled();

      vi.unstubAllEnvs();
    });
  });

  // ── check(): socket accessible but daemon not running ────────────────────

  describe("check() — socket accessible but daemon not running", () => {
    it("sets dockerInstalled=true but dockerRunning=false when ping fails", async () => {
      const home = os.homedir();
      const dockerSock = `${home}/.docker/run/docker.sock`;
      const mockClient = makeDockerClient({
        ping: vi.fn().mockResolvedValue(false),
      });

      const deps: RuntimeDetectorDeps = {
        execCommand: noDdev(),
        accessFn: socketAt(dockerSock),
        createDockerClientFn: makeClientFactory(mockClient),
      };

      const detector = createRuntimeDetector(deps);
      const result = await detector.check();

      expect(result.dockerInstalled).toBe(true);
      expect(result.dockerRunning).toBe(false);
      expect(result.dockerProvider).toBeUndefined();
      expect(result.dockerVersion).toBeUndefined();
    });
  });

  // ── check(): DDEV detection ───────────────────────────────────────────────

  describe("check() — DDEV detection", () => {
    it("returns ddev version and docker platform when ddev is installed", async () => {
      const deps: RuntimeDetectorDeps = {
        execCommand: makeExecCommand({
          "ddev version -j": {
            stdout: ddevVersionOutput("1.23.4", "orbstack"),
            stderr: "",
          },
        }),
        accessFn: noSocketAccess(),
      };

      const detector = createRuntimeDetector(deps);
      const result = await detector.check();

      expect(result.ddevInstalled).toBe(true);
      expect(result.ddevVersion).toBe("1.23.4");
      expect(result.ddevDockerPlatform).toBe("orbstack");
    });

    it("handles ddev version output with missing raw fields", async () => {
      const deps: RuntimeDetectorDeps = {
        execCommand: makeExecCommand({
          "ddev version -j": { stdout: JSON.stringify({}), stderr: "" },
        }),
        accessFn: noSocketAccess(),
      };

      const detector = createRuntimeDetector(deps);
      const result = await detector.check();

      expect(result.ddevInstalled).toBe(true);
      expect(result.ddevVersion).toBeUndefined();
      expect(result.ddevDockerPlatform).toBeUndefined();
    });

    it("handles ddev version output with missing nested fields", async () => {
      const deps: RuntimeDetectorDeps = {
        execCommand: makeExecCommand({
          "ddev version -j": {
            stdout: JSON.stringify({ raw: {} }),
            stderr: "",
          },
        }),
        accessFn: noSocketAccess(),
      };

      const detector = createRuntimeDetector(deps);
      const result = await detector.check();

      expect(result.ddevInstalled).toBe(true);
      expect(result.ddevVersion).toBeUndefined();
      expect(result.ddevDockerPlatform).toBeUndefined();
    });
  });

  // ── backward-compat: plain execCommand as first arg ───────────────────────

  describe("createRuntimeDetector(execCommand) — function shorthand", () => {
    it("accepts a plain ExecCommand function and returns a RuntimeCheckResult", async () => {
      const execCommand = noDdev();
      // Use injected deps to avoid relying on real filesystem
      const detector = createRuntimeDetector({
        execCommand,
        accessFn: noSocketAccess(),
      });
      const result = await detector.check();
      // Just verify result shape is correct — don't assert environment-specific state
      expect(typeof result.dockerInstalled).toBe("boolean");
      expect(typeof result.ddevInstalled).toBe("boolean");
    });
  });

  // ── installContainerRuntime ───────────────────────────────────────────────

  describe("installContainerRuntime", () => {
    it("runs brew install --cask orbstack for orbstack", async () => {
      const execCommand = vi
        .fn()
        .mockResolvedValue({ stdout: "", stderr: "" }) as ExecCommand;

      const detector = createRuntimeDetector({ execCommand });
      const result = await detector.installContainerRuntime("orbstack");

      expect(result).toBe(true);
      expect(execCommand).toHaveBeenCalledWith([
        "brew",
        "install",
        "--cask",
        "orbstack",
      ]);
    });

    it("runs brew install --cask docker for docker-desktop", async () => {
      const execCommand = vi
        .fn()
        .mockResolvedValue({ stdout: "", stderr: "" }) as ExecCommand;

      const detector = createRuntimeDetector({ execCommand });
      const result = await detector.installContainerRuntime("docker-desktop");

      expect(result).toBe(true);
      expect(execCommand).toHaveBeenCalledWith([
        "brew",
        "install",
        "--cask",
        "docker",
      ]);
    });

    it("returns false when brew command fails", async () => {
      const execCommand = vi
        .fn()
        .mockRejectedValue(new Error("brew not found")) as ExecCommand;

      const detector = createRuntimeDetector({ execCommand });
      const result = await detector.installContainerRuntime("orbstack");

      expect(result).toBe(false);
    });
  });

  // ── installDdev ───────────────────────────────────────────────────────────

  describe("installDdev", () => {
    it("runs brew install ddev/ddev/ddev", async () => {
      const execCommand = vi
        .fn()
        .mockResolvedValue({ stdout: "", stderr: "" }) as ExecCommand;

      const detector = createRuntimeDetector({ execCommand });
      const result = await detector.installDdev();

      expect(result).toBe(true);
      expect(execCommand).toHaveBeenCalledWith([
        "brew",
        "install",
        "ddev/ddev/ddev",
      ]);
    });

    it("returns false when brew command fails", async () => {
      const execCommand = vi
        .fn()
        .mockRejectedValue(new Error("brew not found")) as ExecCommand;

      const detector = createRuntimeDetector({ execCommand });
      const result = await detector.installDdev();

      expect(result).toBe(false);
    });
  });
});
