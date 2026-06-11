import { describe, it, expect, vi } from "vitest";

import {
  createDdevCli,
  classifyDdevError,
} from "../src/ddevCli.js";
import type { DdevCliDeps, DdevError } from "../src/ddevCli.js";
import type { ExecCommand } from "../src/runtimeDetector.js";
import type { DockerClient, DockerCpuStats } from "../src/dockerClient.js";

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

function makeDockerClient(overrides?: Partial<DockerClient>): DockerClient {
  return {
    ping: vi.fn().mockResolvedValue(true),
    info: vi.fn().mockResolvedValue(undefined),
    listContainers: vi.fn().mockResolvedValue([]),
    containerStats: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeDeps(
  execResponses: Record<string, { stdout: string; stderr: string } | Error>,
  dockerOverrides?: Partial<DockerClient>,
): DdevCliDeps {
  return {
    execCommand: makeExecCommand(execResponses),
    dockerClient: makeDockerClient(dockerOverrides),
  };
}

function envelope(msg: string, level = "info", raw: unknown = null): string {
  return JSON.stringify({ msg, level, raw });
}

// ─── classifyDdevError ────────────────────────────────────────────────────────

describe("classifyDdevError", () => {
  it("classifies port conflict errors", () => {
    const err = classifyDdevError("Error: address already in use");
    expect(err.code).toBe("port-conflict");
    expect(err.message).toContain("port");
    expect(err.raw).toBe("Error: address already in use");
  });

  it("classifies port conflict — 'bind already' variant", () => {
    expect(classifyDdevError("bind: address already in use").code).toBe("port-conflict");
  });

  it("classifies port conflict — 'port conflict' variant", () => {
    expect(classifyDdevError("port conflict on port 80").code).toBe("port-conflict");
  });

  it("classifies missing docker errors", () => {
    const err = classifyDdevError("docker is not running");
    expect(err.code).toBe("missing-docker");
    expect(err.message).toContain("Docker");
  });

  it("classifies missing docker — 'cannot connect to the docker daemon' variant", () => {
    expect(classifyDdevError("Cannot connect to the Docker daemon").code).toBe("missing-docker");
  });

  it("classifies missing docker — 'is the docker daemon running' variant", () => {
    expect(classifyDdevError("Is the docker daemon running?").code).toBe("missing-docker");
  });

  it("classifies missing config errors", () => {
    const err = classifyDdevError("no ddev config found in this directory");
    expect(err.code).toBe("missing-config");
    expect(err.message).toContain("DDEV configuration");
  });

  it("classifies missing config — '.ddev/config.yaml not found' variant", () => {
    expect(classifyDdevError(".ddev/config.yaml not found").code).toBe("missing-config");
  });

  it("classifies project not found errors", () => {
    const err = classifyDdevError("project mysite not found");
    expect(err.code).toBe("project-not-found");
    expect(err.message).toContain("not found");
  });

  it("classifies project not found — 'no project named' variant", () => {
    expect(classifyDdevError("no project named mysite").code).toBe("project-not-found");
  });

  it("returns unknown for unrecognized errors", () => {
    const err = classifyDdevError("something completely different went wrong");
    expect(err.code).toBe("unknown");
    expect(err.message).toBe("An unexpected error occurred.");
    expect(err.raw).toBe("something completely different went wrong");
  });
});

// ─── createDdevCli ────────────────────────────────────────────────────────────

describe("createDdevCli", () => {
  // ── start ─────────────────────────────────────────────────────────────────

  describe("start", () => {
    it("calls ddev start <project> -j and returns parsed envelope", async () => {
      const out = envelope("Starting mysite", "info", { started: true });
      const deps = makeDeps({ "ddev start mysite -j": { stdout: out, stderr: "" } });
      const cli = createDdevCli(deps);

      const result = await cli.start("mysite");

      expect(result.msg).toBe("Starting mysite");
      expect(result.level).toBe("info");
      expect(result.raw).toEqual({ started: true });
      expect(deps.execCommand).toHaveBeenCalledWith(
        ["ddev", "start", "mysite", "-j"],
        undefined,
      );
    });

    it("passes cwd to execCommand", async () => {
      const out = envelope("Starting mysite");
      const deps = makeDeps({ "ddev start mysite -j": { stdout: out, stderr: "" } });
      const cli = createDdevCli(deps);

      await cli.start("mysite", "/some/path");

      expect(deps.execCommand).toHaveBeenCalledWith(
        ["ddev", "start", "mysite", "-j"],
        "/some/path",
      );
    });

    it("throws classified error when execCommand rejects with stderr", async () => {
      const execErr = Object.assign(new Error("port conflict"), {
        stderr: "Error: address already in use :443",
      });
      const deps = makeDeps({ "ddev start mysite -j": execErr });
      const cli = createDdevCli(deps);

      await expect(cli.start("mysite")).rejects.toMatchObject({
        ddevError: { code: "port-conflict" } satisfies Partial<DdevError>,
      });
    });

    it("throws unknown error when stderr does not match any pattern", async () => {
      const execErr = Object.assign(new Error("unknown error"), {
        stderr: "something weird happened",
      });
      const deps = makeDeps({ "ddev start mysite -j": execErr });
      const cli = createDdevCli(deps);

      await expect(cli.start("mysite")).rejects.toMatchObject({
        ddevError: { code: "unknown" } satisfies Partial<DdevError>,
      });
    });

    it("falls back to error message when no stderr property", async () => {
      const execErr = new Error("docker is not running");
      const deps = makeDeps({ "ddev start mysite -j": execErr });
      const cli = createDdevCli(deps);

      await expect(cli.start("mysite")).rejects.toMatchObject({
        ddevError: { code: "missing-docker" } satisfies Partial<DdevError>,
      });
    });

    it("handles non-JSON stdout by returning raw text as msg", async () => {
      const deps = makeDeps({
        "ddev start mysite -j": { stdout: "Starting services...", stderr: "" },
      });
      const cli = createDdevCli(deps);
      const result = await cli.start("mysite");
      expect(result.msg).toBe("Starting services...");
      expect(result.level).toBe("info");
    });
  });

  // ── stop ──────────────────────────────────────────────────────────────────

  describe("stop", () => {
    it("calls ddev stop <project> -j and returns parsed envelope", async () => {
      const out = envelope("Stopping mysite");
      const deps = makeDeps({ "ddev stop mysite -j": { stdout: out, stderr: "" } });
      const cli = createDdevCli(deps);

      const result = await cli.stop("mysite");

      expect(result.msg).toBe("Stopping mysite");
      expect(deps.execCommand).toHaveBeenCalledWith(
        ["ddev", "stop", "mysite", "-j"],
        undefined,
      );
    });

    it("passes cwd to execCommand", async () => {
      const out = envelope("Stopping mysite");
      const deps = makeDeps({ "ddev stop mysite -j": { stdout: out, stderr: "" } });
      const cli = createDdevCli(deps);

      await cli.stop("mysite", "/cwd");

      expect(deps.execCommand).toHaveBeenCalledWith(
        ["ddev", "stop", "mysite", "-j"],
        "/cwd",
      );
    });

    it("throws classified error on exec failure", async () => {
      const execErr = Object.assign(new Error("not found"), {
        stderr: "project mysite not found",
      });
      const deps = makeDeps({ "ddev stop mysite -j": execErr });
      const cli = createDdevCli(deps);

      await expect(cli.stop("mysite")).rejects.toMatchObject({
        ddevError: { code: "project-not-found" } satisfies Partial<DdevError>,
      });
    });
  });

  // ── restart ───────────────────────────────────────────────────────────────

  describe("restart", () => {
    it("calls ddev restart <project> -j and returns parsed envelope", async () => {
      const out = envelope("Restarting mysite");
      const deps = makeDeps({ "ddev restart mysite -j": { stdout: out, stderr: "" } });
      const cli = createDdevCli(deps);

      const result = await cli.restart("mysite");

      expect(result.msg).toBe("Restarting mysite");
      expect(deps.execCommand).toHaveBeenCalledWith(
        ["ddev", "restart", "mysite", "-j"],
        undefined,
      );
    });

    it("throws classified error on exec failure", async () => {
      const execErr = Object.assign(new Error("no docker"), {
        stderr: "Cannot connect to the Docker daemon",
      });
      const deps = makeDeps({ "ddev restart mysite -j": execErr });
      const cli = createDdevCli(deps);

      await expect(cli.restart("mysite")).rejects.toMatchObject({
        ddevError: { code: "missing-docker" } satisfies Partial<DdevError>,
      });
    });
  });

  // ── delete ────────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("calls ddev delete <project> --omit-snapshot -j", async () => {
      const out = envelope("Deleting mysite");
      const deps = makeDeps({
        "ddev delete mysite --omit-snapshot -j": { stdout: out, stderr: "" },
      });
      const cli = createDdevCli(deps);

      const result = await cli.delete("mysite");

      expect(result.msg).toBe("Deleting mysite");
      expect(deps.execCommand).toHaveBeenCalledWith(
        ["ddev", "delete", "mysite", "--omit-snapshot", "-j"],
        undefined,
      );
    });

    it("throws classified error when project not found", async () => {
      const execErr = Object.assign(new Error("not found"), {
        stderr: "could not find project mysite",
      });
      const deps = makeDeps({
        "ddev delete mysite --omit-snapshot -j": execErr,
      });
      const cli = createDdevCli(deps);

      await expect(cli.delete("mysite")).rejects.toMatchObject({
        ddevError: { code: "project-not-found" } satisfies Partial<DdevError>,
      });
    });
  });

  // ── describe ──────────────────────────────────────────────────────────────

  describe("describe", () => {
    it("calls ddev describe <project> -j and returns parsed project info", async () => {
      const rawProject = {
        name: "mysite",
        status: "running",
        httpurl: "http://mysite.ddev.site",
        httpsurl: "https://mysite.ddev.site",
        type: "drupal10",
        shortroot: "/Users/alex/projects/mysite",
      };
      const out = envelope("mysite", "info", rawProject);
      const deps = makeDeps({
        "ddev describe mysite -j": { stdout: out, stderr: "" },
      });
      const cli = createDdevCli(deps);

      const info = await cli.describe("mysite");

      expect(info.name).toBe("mysite");
      expect(info.status).toBe("running");
      expect(info.httpUrl).toBe("http://mysite.ddev.site");
      expect(info.httpsUrl).toBe("https://mysite.ddev.site");
      expect(info.type).toBe("drupal10");
      expect(info.location).toBe("/Users/alex/projects/mysite");
    });

    it("returns empty strings and undefined for missing fields", async () => {
      const out = envelope("", "info", {});
      const deps = makeDeps({
        "ddev describe mysite -j": { stdout: out, stderr: "" },
      });
      const cli = createDdevCli(deps);

      const info = await cli.describe("mysite");

      expect(info.name).toBe("");
      expect(info.status).toBe("");
      expect(info.httpUrl).toBeUndefined();
      expect(info.httpsUrl).toBeUndefined();
      expect(info.type).toBeUndefined();
      expect(info.location).toBeUndefined();
    });

    it("handles null raw gracefully", async () => {
      const out = envelope("", "info", null);
      const deps = makeDeps({
        "ddev describe mysite -j": { stdout: out, stderr: "" },
      });
      const cli = createDdevCli(deps);
      const info = await cli.describe("mysite");
      expect(info.name).toBe("");
    });

    it("throws classified error on exec failure", async () => {
      const execErr = Object.assign(new Error("not found"), {
        stderr: "project mysite not found",
      });
      const deps = makeDeps({ "ddev describe mysite -j": execErr });
      const cli = createDdevCli(deps);

      await expect(cli.describe("mysite")).rejects.toMatchObject({
        ddevError: { code: "project-not-found" } satisfies Partial<DdevError>,
      });
    });
  });

  // ── list ──────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("calls ddev list -j and returns array of project info", async () => {
      const rawList = [
        { name: "site-a", status: "running", httpurl: "http://site-a.ddev.site" },
        { name: "site-b", status: "stopped" },
      ];
      const out = envelope("", "info", rawList);
      const deps = makeDeps({ "ddev list -j": { stdout: out, stderr: "" } });
      const cli = createDdevCli(deps);

      const list = await cli.list();

      expect(list).toHaveLength(2);
      expect(list[0]?.name).toBe("site-a");
      expect(list[0]?.status).toBe("running");
      expect(list[0]?.httpUrl).toBe("http://site-a.ddev.site");
      expect(list[1]?.name).toBe("site-b");
      expect(list[1]?.status).toBe("stopped");
    });

    it("returns empty array when raw is not an array", async () => {
      const out = envelope("", "info", null);
      const deps = makeDeps({ "ddev list -j": { stdout: out, stderr: "" } });
      const cli = createDdevCli(deps);

      expect(await cli.list()).toEqual([]);
    });

    it("passes cwd to execCommand", async () => {
      const out = envelope("", "info", []);
      const deps = makeDeps({ "ddev list -j": { stdout: out, stderr: "" } });
      const cli = createDdevCli(deps);

      await cli.list("/some/cwd");

      expect(deps.execCommand).toHaveBeenCalledWith(
        ["ddev", "list", "-j"],
        "/some/cwd",
      );
    });

    it("throws classified error on exec failure", async () => {
      const execErr = Object.assign(new Error("no docker"), {
        stderr: "docker daemon is not running",
      });
      const deps = makeDeps({ "ddev list -j": execErr });
      const cli = createDdevCli(deps);

      await expect(cli.list()).rejects.toMatchObject({
        ddevError: { code: "missing-docker" } satisfies Partial<DdevError>,
      });
    });
  });

  // ── version ───────────────────────────────────────────────────────────────

  describe("version", () => {
    it("calls ddev version -j and returns parsed envelope", async () => {
      const rawVersion = { ddev_version: "1.23.4", docker_platform: "orbstack" };
      const out = envelope("ddev v1.23.4", "info", rawVersion);
      const deps = makeDeps({ "ddev version -j": { stdout: out, stderr: "" } });
      const cli = createDdevCli(deps);

      const result = await cli.version();

      expect(result.msg).toBe("ddev v1.23.4");
      expect(result.raw).toEqual(rawVersion);
      expect(deps.execCommand).toHaveBeenCalledWith(
        ["ddev", "version", "-j"],
        undefined,
      );
    });

    it("throws error when ddev not found", async () => {
      const execErr = new Error("command not found: ddev");
      const deps = makeDeps({ "ddev version -j": execErr });
      const cli = createDdevCli(deps);

      await expect(cli.version()).rejects.toMatchObject({
        ddevError: { code: "unknown" } satisfies Partial<DdevError>,
      });
    });
  });

  // ── resourceSnapshot ──────────────────────────────────────────────────────

  describe("resourceSnapshot", () => {
    const makeStats = (
      cpuDelta: number,
      systemDelta: number,
      onlineCpus: number,
      memUsage: number,
      memLimit: number,
    ): DockerCpuStats => ({
      cpuDelta,
      systemDelta,
      onlineCpus,
      memoryUsageBytes: memUsage,
      memoryLimitBytes: memLimit,
    });

    it("returns undefined when no containers match the project", async () => {
      const deps = makeDeps(
        {},
        {
          listContainers: vi.fn().mockResolvedValue([
            { id: "abc", names: ["/other-project-web"], state: "running" },
          ]),
        },
      );
      const cli = createDdevCli(deps);
      expect(await cli.resourceSnapshot("mysite")).toBeUndefined();
    });

    it("returns undefined when listContainers returns empty array", async () => {
      const deps = makeDeps({}, { listContainers: vi.fn().mockResolvedValue([]) });
      const cli = createDdevCli(deps);
      expect(await cli.resourceSnapshot("mysite")).toBeUndefined();
    });

    it("returns resource snapshot for single container", async () => {
      const stats = makeStats(1000000, 10000000, 4, 52428800, 8589934592);
      const deps = makeDeps(
        {},
        {
          listContainers: vi.fn().mockResolvedValue([
            { id: "cnt1", names: ["/ddev-mysite-web"], state: "running" },
          ]),
          containerStats: vi.fn().mockResolvedValue(stats),
        },
      );
      const cli = createDdevCli(deps);
      const snapshot = await cli.resourceSnapshot("mysite");

      expect(snapshot).toBeDefined();
      expect(snapshot?.memoryUsageBytes).toBe(52428800);
      expect(snapshot?.memoryLimitBytes).toBe(8589934592);
      // cpuPercent = (1000000 / 10000000) * 4 * 100 = 40
      expect(snapshot?.cpuPercent).toBeCloseTo(40);
    });

    it("aggregates memory across multiple containers", async () => {
      const stats1 = makeStats(500000, 10000000, 4, 30000000, 8589934592);
      const stats2 = makeStats(500000, 10000000, 4, 20000000, 8589934592);
      const containerStatsMock = vi
        .fn()
        .mockResolvedValueOnce(stats1)
        .mockResolvedValueOnce(stats2);
      const deps = makeDeps(
        {},
        {
          listContainers: vi.fn().mockResolvedValue([
            { id: "cnt1", names: ["/ddev-mysite-web"], state: "running" },
            { id: "cnt2", names: ["/ddev-mysite-db"], state: "running" },
          ]),
          containerStats: containerStatsMock,
        },
      );
      const cli = createDdevCli(deps);
      const snapshot = await cli.resourceSnapshot("mysite");

      expect(snapshot?.memoryUsageBytes).toBe(50000000);
    });

    it("returns undefined when all containerStats return undefined", async () => {
      const deps = makeDeps(
        {},
        {
          listContainers: vi.fn().mockResolvedValue([
            { id: "cnt1", names: ["/ddev-mysite-web"], state: "running" },
          ]),
          containerStats: vi.fn().mockResolvedValue(undefined),
        },
      );
      const cli = createDdevCli(deps);
      expect(await cli.resourceSnapshot("mysite")).toBeUndefined();
    });

    it("returns undefined when dockerClient.listContainers throws", async () => {
      const deps = makeDeps(
        {},
        {
          listContainers: vi.fn().mockRejectedValue(new Error("socket error")),
        },
      );
      const cli = createDdevCli(deps);
      expect(await cli.resourceSnapshot("mysite")).toBeUndefined();
    });

    it("matches containers by ddev-<projectName>- prefix (strips leading slash)", async () => {
      const stats = makeStats(100, 1000, 2, 1000000, 8000000000);
      const deps = makeDeps(
        {},
        {
          listContainers: vi.fn().mockResolvedValue([
            // Leading slash is stripped before prefix match
            { id: "c1", names: ["/ddev-my-project-web"], state: "running" },
            // Container for a different project — should not match
            { id: "c2", names: ["/ddev-other-web"], state: "running" },
          ]),
          containerStats: vi.fn().mockResolvedValue(stats),
        },
      );
      const cli = createDdevCli(deps);
      const snapshot = await cli.resourceSnapshot("my-project");

      // Only one container matched, so containerStats called once
      expect(deps.dockerClient.containerStats).toHaveBeenCalledTimes(1);
      expect(deps.dockerClient.containerStats).toHaveBeenCalledWith("c1");
      expect(snapshot).toBeDefined();
    });

    it("parseEnvelope handles non-string msg and level in JSON", async () => {
      const badEnvelope = JSON.stringify({ msg: 42, level: null, raw: "data" });
      const deps = makeDeps({
        "ddev version -j": { stdout: badEnvelope, stderr: "" },
      });
      const cli = createDdevCli(deps);
      const result = await cli.version();
      expect(result.msg).toBe("");
      expect(result.level).toBe("");
    });

    it("classifies error from non-Error rejection value", async () => {
      const execCommand = vi.fn().mockRejectedValue("string rejection") as unknown as ExecCommand;
      const cli = createDdevCli({ execCommand, dockerClient: makeDockerClient() });
      await expect(cli.start("my-project", "/path")).rejects.toThrow();
    });

    it("returns cpuPercent=0 when systemDelta is 0", async () => {
      const stats = makeStats(1000, 0, 4, 1000000, 8000000000);
      const deps = makeDeps(
        {},
        {
          listContainers: vi.fn().mockResolvedValue([
            { id: "c1", names: ["/ddev-mysite-web"], state: "running" },
          ]),
          containerStats: vi.fn().mockResolvedValue(stats),
        },
      );
      const cli = createDdevCli(deps);
      const snapshot = await cli.resourceSnapshot("mysite");
      expect(snapshot?.cpuPercent).toBe(0);
    });
  });
});
