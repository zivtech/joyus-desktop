import { describe, expect, it } from "vitest";
import type {
  ManagedMcpEntry,
  McpServerConfig,
  McpServerInfo,
  PidFileEntry,
  ServerManifest,
  ServerStatus,
} from "../src/types";

describe("types", () => {
  it("ServerStatus accepts valid values", () => {
    const statuses: ServerStatus[] = ["stopped", "starting", "running", "error"];
    expect(statuses).toHaveLength(4);
  });

  it("McpServerConfig has required fields", () => {
    const config: McpServerConfig = { command: "node", args: ["server.js"] };
    expect(config.command).toBe("node");
    expect(config.args).toEqual(["server.js"]);
    expect(config.env).toBeUndefined();
  });

  it("McpServerConfig accepts optional env", () => {
    const config: McpServerConfig = {
      command: "node",
      args: [],
      env: { PORT: "3000" },
    };
    expect(config.env).toEqual({ PORT: "3000" });
  });

  it("McpServerInfo has all fields", () => {
    const info: McpServerInfo = {
      name: "test",
      config: { command: "node", args: [] },
      status: "running",
      pid: 1234,
      version: "1.0.0",
      enabled: true,
      restartCount: 0,
      lastError: undefined,
    };
    expect(info.name).toBe("test");
    expect(info.pid).toBe(1234);
  });

  it("McpServerInfo works with optional fields omitted", () => {
    const info: McpServerInfo = {
      name: "test",
      config: { command: "node", args: [] },
      status: "stopped",
      enabled: false,
      restartCount: 0,
    };
    expect(info.pid).toBeUndefined();
    expect(info.version).toBeUndefined();
    expect(info.lastError).toBeUndefined();
  });

  it("ServerManifest holds server entries", () => {
    const manifest: ServerManifest = {
      servers: {
        foo: { command: "node", args: ["foo.js"], enabled: true, version: "1.0.0" },
        bar: { command: "python", args: ["bar.py"], enabled: false },
      },
    };
    expect(Object.keys(manifest.servers)).toHaveLength(2);
    expect(manifest.servers["foo"]?.version).toBe("1.0.0");
    expect(manifest.servers["bar"]?.version).toBeUndefined();
  });

  it("PidFileEntry has required fields", () => {
    const entry: PidFileEntry = { name: "srv", pid: 42, startedAt: "2026-01-01T00:00:00Z" };
    expect(entry.name).toBe("srv");
    expect(entry.pid).toBe(42);
    expect(entry.startedAt).toBe("2026-01-01T00:00:00Z");
  });

  it("ManagedMcpEntry has managed_by marker", () => {
    const entry: ManagedMcpEntry = {
      command: "node",
      args: ["mcp.js"],
      _managed_by: "joyus-desktop",
      _version: "1.0.0",
    };
    expect(entry._managed_by).toBe("joyus-desktop");
    expect(entry._version).toBe("1.0.0");
  });
});
