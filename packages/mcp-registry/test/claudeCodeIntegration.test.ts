import { describe, expect, it, vi } from "vitest";
import {
  mergeMcpConfig,
  removeManagedEntries,
  removeMcpConfig,
  writeMcpConfig,
  type ClaudeCodeDeps,
  type McpConfigJson,
} from "../src/claudeCodeIntegration";
import type { ManagedMcpEntry } from "../src/types";

function makeDeps(overrides?: Partial<ClaudeCodeDeps>): ClaudeCodeDeps {
  return {
    readFile: vi.fn(async () => '{"mcpServers":{}}'),
    writeFile: vi.fn(async () => undefined),
    copyFile: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("mergeMcpConfig", () => {
  it("adds managed entries to empty config", () => {
    const existing: McpConfigJson = { mcpServers: {} };
    const managed: Record<string, ManagedMcpEntry> = {
      "joyus-tools": {
        command: "node",
        args: ["tools.js"],
        _managed_by: "joyus-desktop",
        _version: "1.0.0",
      },
    };

    const result = mergeMcpConfig(existing, managed);
    expect(result.mcpServers?.["joyus-tools"]).toEqual(managed["joyus-tools"]);
  });

  it("preserves non-managed entries", () => {
    const existing: McpConfigJson = {
      mcpServers: {
        "user-server": { command: "python", args: ["srv.py"] },
      },
    };
    const managed: Record<string, ManagedMcpEntry> = {
      "joyus-tools": {
        command: "node",
        args: ["tools.js"],
        _managed_by: "joyus-desktop",
        _version: "1.0.0",
      },
    };

    const result = mergeMcpConfig(existing, managed);
    expect(result.mcpServers?.["user-server"]).toEqual({ command: "python", args: ["srv.py"] });
    expect(result.mcpServers?.["joyus-tools"]).toBeDefined();
  });

  it("replaces existing managed entries", () => {
    const existing: McpConfigJson = {
      mcpServers: {
        "joyus-old": {
          command: "node",
          args: ["old.js"],
          _managed_by: "joyus-desktop",
          _version: "0.9.0",
        },
      },
    };
    const managed: Record<string, ManagedMcpEntry> = {
      "joyus-new": {
        command: "node",
        args: ["new.js"],
        _managed_by: "joyus-desktop",
        _version: "1.0.0",
      },
    };

    const result = mergeMcpConfig(existing, managed);
    expect(result.mcpServers?.["joyus-old"]).toBeUndefined();
    expect(result.mcpServers?.["joyus-new"]).toBeDefined();
  });

  it("handles missing mcpServers in existing config", () => {
    const existing: McpConfigJson = {};
    const managed: Record<string, ManagedMcpEntry> = {
      srv: {
        command: "node",
        args: [],
        _managed_by: "joyus-desktop",
        _version: "1.0.0",
      },
    };

    const result = mergeMcpConfig(existing, managed);
    expect(result.mcpServers?.["srv"]).toBeDefined();
  });
});

describe("removeManagedEntries", () => {
  it("removes only managed entries", () => {
    const config: McpConfigJson = {
      mcpServers: {
        "user-srv": { command: "python", args: [] },
        "managed-srv": {
          command: "node",
          args: [],
          _managed_by: "joyus-desktop",
          _version: "1.0.0",
        },
      },
    };

    const result = removeManagedEntries(config);
    expect(result.mcpServers?.["user-srv"]).toBeDefined();
    expect(result.mcpServers?.["managed-srv"]).toBeUndefined();
  });

  it("handles empty mcpServers", () => {
    const result = removeManagedEntries({ mcpServers: {} });
    expect(result.mcpServers).toEqual({});
  });

  it("handles missing mcpServers", () => {
    const result = removeManagedEntries({});
    expect(result.mcpServers).toEqual({});
  });
});

describe("writeMcpConfig", () => {
  it("reads existing config, merges, and writes", async () => {
    const existingConfig = {
      mcpServers: { "user-srv": { command: "python", args: ["srv.py"] } },
    };
    const deps = makeDeps({
      readFile: vi.fn(async () => JSON.stringify(existingConfig)),
    });

    const entries: Record<string, ManagedMcpEntry> = {
      "joyus-tools": {
        command: "node",
        args: ["tools.js"],
        _managed_by: "joyus-desktop",
        _version: "1.0.0",
      },
    };

    await writeMcpConfig("/home/.mcp.json", entries, deps);

    expect(deps.readFile).toHaveBeenCalledWith("/home/.mcp.json");
    expect(deps.writeFile).toHaveBeenCalledWith(
      "/home/.mcp.json",
      expect.stringContaining("user-srv"),
    );
    expect(deps.writeFile).toHaveBeenCalledWith(
      "/home/.mcp.json",
      expect.stringContaining("joyus-tools"),
    );
  });

  it("handles missing file by creating fresh config", async () => {
    const deps = makeDeps({
      readFile: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
    });

    const entries: Record<string, ManagedMcpEntry> = {
      srv: {
        command: "node",
        args: [],
        _managed_by: "joyus-desktop",
        _version: "1.0.0",
      },
    };

    await writeMcpConfig("/home/.mcp.json", entries, deps);
    expect(deps.writeFile).toHaveBeenCalled();
  });

  it("handles empty file", async () => {
    const deps = makeDeps({
      readFile: vi.fn(async () => ""),
    });

    const entries: Record<string, ManagedMcpEntry> = {
      srv: {
        command: "node",
        args: [],
        _managed_by: "joyus-desktop",
        _version: "1.0.0",
      },
    };

    await writeMcpConfig("/home/.mcp.json", entries, deps);
    expect(deps.writeFile).toHaveBeenCalled();
    const writtenStr = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    expect(JSON.parse(writtenStr)).toHaveProperty("mcpServers");
  });

  it("backs up malformed JSON and creates fresh config", async () => {
    const deps = makeDeps({
      readFile: vi.fn(async () => "{invalid json!!!"),
    });

    const entries: Record<string, ManagedMcpEntry> = {
      srv: {
        command: "node",
        args: [],
        _managed_by: "joyus-desktop",
        _version: "1.0.0",
      },
    };

    await writeMcpConfig("/home/.mcp.json", entries, deps);
    expect(deps.copyFile).toHaveBeenCalledWith("/home/.mcp.json", "/home/.mcp.json.backup");
    expect(deps.writeFile).toHaveBeenCalled();
  });
});

describe("removeMcpConfig", () => {
  it("removes managed entries from file", async () => {
    const config = {
      mcpServers: {
        "user-srv": { command: "python", args: [] },
        "managed": {
          command: "node",
          args: [],
          _managed_by: "joyus-desktop",
          _version: "1.0.0",
        },
      },
    };
    const deps = makeDeps({
      readFile: vi.fn(async () => JSON.stringify(config)),
    });

    await removeMcpConfig("/home/.mcp.json", deps);

    const writtenStr = (deps.writeFile as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
    const parsed = JSON.parse(writtenStr) as McpConfigJson;
    expect(parsed.mcpServers?.["user-srv"]).toBeDefined();
    expect(parsed.mcpServers?.["managed"]).toBeUndefined();
  });

  it("handles missing file gracefully", async () => {
    const deps = makeDeps({
      readFile: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
    });

    await removeMcpConfig("/home/.mcp.json", deps);
    expect(deps.writeFile).toHaveBeenCalled();
  });
});
