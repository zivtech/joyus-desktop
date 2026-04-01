import { describe, it, expect, vi } from "vitest";

import { createDockerClient } from "../src/dockerClient.js";
import type { HttpRequestFn, HttpResponse, HttpRequestHandle } from "../src/dockerClient.js";

// ─── HTTP mock helpers ────────────────────────────────────────────────────────

function makeResponse(statusCode: number, body: string): HttpResponse {
  return {
    statusCode,
    on(event: string, cb: (chunk?: Buffer) => void): HttpResponse {
      if (event === "data") cb(Buffer.from(body));
      if (event === "end") cb();
      return this;
    },
  } as unknown as HttpResponse;
}

function makeHandle(): HttpRequestHandle {
  return {
    on(_event: string, _cb: (err: Error) => void): HttpRequestHandle {
      return this;
    },
    end() {
      // no-op
    },
  } as unknown as HttpRequestHandle;
}

function makeErrorHandle(err: Error): HttpRequestHandle {
  return {
    on(event: string, cb: (err: Error) => void): HttpRequestHandle {
      if (event === "error") Promise.resolve().then(() => cb(err));
      return this;
    },
    end() {
      // no-op
    },
  } as unknown as HttpRequestHandle;
}

function stubHttp(statusCode: number, body: string): HttpRequestFn {
  const res = makeResponse(statusCode, body);
  const handle = makeHandle();
  return vi.fn().mockImplementation((_opts, cb: (res: HttpResponse) => void) => {
    Promise.resolve().then(() => cb(res));
    return handle;
  });
}

function stubHttpError(err: Error): HttpRequestFn {
  return vi.fn().mockImplementation((_opts, _cb) => {
    return makeErrorHandle(err);
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const SOCKET = "/var/run/docker.sock";

describe("createDockerClient", () => {
  // ── ping ──────────────────────────────────────────────────────────────────

  describe("ping", () => {
    it("returns true when daemon responds OK", async () => {
      const client = createDockerClient(SOCKET, stubHttp(200, "OK"));
      expect(await client.ping()).toBe(true);
    });

    it("returns false when status is not 200", async () => {
      const client = createDockerClient(SOCKET, stubHttp(500, "Internal Server Error"));
      expect(await client.ping()).toBe(false);
    });

    it("returns false when body is not OK", async () => {
      const client = createDockerClient(SOCKET, stubHttp(200, "not-ok"));
      expect(await client.ping()).toBe(false);
    });

    it("returns false when request throws", async () => {
      const client = createDockerClient(SOCKET, stubHttpError(new Error("ENOENT")));
      expect(await client.ping()).toBe(false);
    });
  });

  // ── info ──────────────────────────────────────────────────────────────────

  describe("info", () => {
    it("returns parsed DockerInfo on success", async () => {
      const body = JSON.stringify({
        ServerVersion: "24.0.5",
        NCPU: 4,
        MemTotal: 8589934592,
        Containers: 3,
        ContainersRunning: 2,
      });
      const client = createDockerClient(SOCKET, stubHttp(200, body));
      const info = await client.info();
      expect(info).toEqual({
        serverVersion: "24.0.5",
        ncpu: 4,
        memTotal: 8589934592,
        containers: 3,
        containersRunning: 2,
      });
    });

    it("returns undefined fields for missing keys", async () => {
      const client = createDockerClient(SOCKET, stubHttp(200, JSON.stringify({})));
      const info = await client.info();
      expect(info).toEqual({
        serverVersion: undefined,
        ncpu: undefined,
        memTotal: undefined,
        containers: undefined,
        containersRunning: undefined,
      });
    });

    it("returns undefined when status is not 200", async () => {
      const client = createDockerClient(SOCKET, stubHttp(500, "{}"));
      expect(await client.info()).toBeUndefined();
    });

    it("returns undefined when response body is invalid JSON", async () => {
      const client = createDockerClient(SOCKET, stubHttp(200, "not-json"));
      expect(await client.info()).toBeUndefined();
    });

    it("returns undefined when request throws", async () => {
      const client = createDockerClient(SOCKET, stubHttpError(new Error("ENOENT")));
      expect(await client.info()).toBeUndefined();
    });
  });

  // ── listContainers ────────────────────────────────────────────────────────

  describe("listContainers", () => {
    it("returns parsed containers on success", async () => {
      const body = JSON.stringify([
        { Id: "abc123", Names: ["/my-container"], State: "running" },
        { Id: "def456", Names: ["/other"], State: "exited" },
      ]);
      const client = createDockerClient(SOCKET, stubHttp(200, body));
      const containers = await client.listContainers();
      expect(containers).toEqual([
        { id: "abc123", names: ["/my-container"], state: "running" },
        { id: "def456", names: ["/other"], state: "exited" },
      ]);
    });

    it("returns empty array when status is not 200", async () => {
      const client = createDockerClient(SOCKET, stubHttp(500, "[]"));
      expect(await client.listContainers()).toEqual([]);
    });

    it("returns empty array when response body is invalid JSON", async () => {
      const client = createDockerClient(SOCKET, stubHttp(200, "bad json"));
      expect(await client.listContainers()).toEqual([]);
    });

    it("returns empty array when request throws", async () => {
      const client = createDockerClient(SOCKET, stubHttpError(new Error("ENOENT")));
      expect(await client.listContainers()).toEqual([]);
    });

    it("handles missing Id, Names, State fields gracefully", async () => {
      const client = createDockerClient(SOCKET, stubHttp(200, JSON.stringify([{}])));
      const containers = await client.listContainers();
      expect(containers).toEqual([{ id: "", names: [], state: "" }]);
    });

    it("filters non-string entries from Names array", async () => {
      const body = JSON.stringify([
        { Id: "abc", Names: ["/good", 42, null], State: "running" },
      ]);
      const client = createDockerClient(SOCKET, stubHttp(200, body));
      const containers = await client.listContainers();
      expect(containers[0]?.names).toEqual(["/good"]);
    });
  });

  // ── containerStats ────────────────────────────────────────────────────────

  describe("containerStats", () => {
    const validStatsBody = JSON.stringify({
      cpu_stats: {
        cpu_usage: { total_usage: 2000000 },
        system_cpu_usage: 100000000,
        online_cpus: 4,
      },
      precpu_stats: {
        cpu_usage: { total_usage: 1000000 },
        system_cpu_usage: 90000000,
      },
      memory_stats: {
        usage: 52428800,
        limit: 8589934592,
      },
    });

    it("returns parsed stats on success", async () => {
      const client = createDockerClient(SOCKET, stubHttp(200, validStatsBody));
      const stats = await client.containerStats("abc123");
      expect(stats).toEqual({
        cpuDelta: 1000000,
        systemDelta: 10000000,
        onlineCpus: 4,
        memoryUsageBytes: 52428800,
        memoryLimitBytes: 8589934592,
      });
    });

    it("returns undefined when status is not 200", async () => {
      const client = createDockerClient(SOCKET, stubHttp(404, "{}"));
      expect(await client.containerStats("abc123")).toBeUndefined();
    });

    it("returns undefined when body is invalid JSON", async () => {
      const client = createDockerClient(SOCKET, stubHttp(200, "not-json"));
      expect(await client.containerStats("abc123")).toBeUndefined();
    });

    it("returns undefined when request throws", async () => {
      const client = createDockerClient(SOCKET, stubHttpError(new Error("ENOENT")));
      expect(await client.containerStats("abc123")).toBeUndefined();
    });

    it("returns undefined when cpu_stats is missing", async () => {
      const body = JSON.stringify({ precpu_stats: {}, memory_stats: {} });
      const client = createDockerClient(SOCKET, stubHttp(200, body));
      expect(await client.containerStats("abc123")).toBeUndefined();
    });

    it("returns undefined when precpu_stats is missing", async () => {
      const body = JSON.stringify({ cpu_stats: {}, memory_stats: {} });
      const client = createDockerClient(SOCKET, stubHttp(200, body));
      expect(await client.containerStats("abc123")).toBeUndefined();
    });

    it("returns undefined when memory_stats is missing", async () => {
      const body = JSON.stringify({ cpu_stats: {}, precpu_stats: {} });
      const client = createDockerClient(SOCKET, stubHttp(200, body));
      expect(await client.containerStats("abc123")).toBeUndefined();
    });

    it("returns undefined when cpu_usage is missing from cpu_stats", async () => {
      const body = JSON.stringify({
        cpu_stats: { system_cpu_usage: 100 },
        precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
        memory_stats: { usage: 0, limit: 0 },
      });
      const client = createDockerClient(SOCKET, stubHttp(200, body));
      expect(await client.containerStats("abc123")).toBeUndefined();
    });

    it("returns undefined when cpu_usage is missing from precpu_stats", async () => {
      const body = JSON.stringify({
        cpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 100 },
        precpu_stats: { system_cpu_usage: 0 },
        memory_stats: { usage: 0, limit: 0 },
      });
      const client = createDockerClient(SOCKET, stubHttp(200, body));
      expect(await client.containerStats("abc123")).toBeUndefined();
    });

    it("defaults numeric fields to 0 when missing", async () => {
      const body = JSON.stringify({
        cpu_stats: { cpu_usage: {}, system_cpu_usage: 100, online_cpus: 2 },
        precpu_stats: { cpu_usage: {}, system_cpu_usage: 50 },
        memory_stats: {},
      });
      const client = createDockerClient(SOCKET, stubHttp(200, body));
      const stats = await client.containerStats("abc123");
      expect(stats).toEqual({
        cpuDelta: 0,
        systemDelta: 50,
        onlineCpus: 2,
        memoryUsageBytes: 0,
        memoryLimitBytes: 0,
      });
    });

    it("defaults onlineCpus to 1 when missing", async () => {
      const body = JSON.stringify({
        cpu_stats: { cpu_usage: { total_usage: 10 }, system_cpu_usage: 100 },
        precpu_stats: { cpu_usage: { total_usage: 5 }, system_cpu_usage: 80 },
        memory_stats: { usage: 0, limit: 0 },
      });
      const client = createDockerClient(SOCKET, stubHttp(200, body));
      const stats = await client.containerStats("abc123");
      expect(stats?.onlineCpus).toBe(1);
    });
  });
});
