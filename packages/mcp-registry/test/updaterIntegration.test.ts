import { describe, expect, it, vi } from "vitest";
import {
  applyUpdate,
  checkForUpdates,
  rollback,
  type UpdaterDeps,
  type VersionCheckResponse,
} from "../src/updaterIntegration";
import type { ServerManifest } from "../src/types";

function makeDeps(overrides?: Partial<UpdaterDeps>): UpdaterDeps {
  return {
    stopServer: vi.fn(async () => undefined),
    startServer: vi.fn(),
    replaceVersion: vi.fn(async () => undefined),
    backupServer: vi.fn(async () => "/backups/srv.bak"),
    restoreBackup: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("checkForUpdates", () => {
  it("returns updates when remote version is newer", () => {
    const manifest: ServerManifest = {
      servers: {
        alpha: { command: "node", args: [], enabled: true, version: "1.0.0" },
      },
    };
    const remote: VersionCheckResponse = {
      servers: { alpha: { latestVersion: "2.0.0" } },
    };

    const updates = checkForUpdates(manifest, remote);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.name).toBe("alpha");
    expect(updates[0]?.currentVersion).toBe("1.0.0");
    expect(updates[0]?.availableVersion).toBe("2.0.0");
  });

  it("returns empty when versions match", () => {
    const manifest: ServerManifest = {
      servers: {
        beta: { command: "node", args: [], enabled: true, version: "1.0.0" },
      },
    };
    const remote: VersionCheckResponse = {
      servers: { beta: { latestVersion: "1.0.0" } },
    };

    const updates = checkForUpdates(manifest, remote);
    expect(updates).toHaveLength(0);
  });

  it("skips servers not in remote", () => {
    const manifest: ServerManifest = {
      servers: {
        local: { command: "node", args: [], enabled: true, version: "1.0.0" },
      },
    };
    const remote: VersionCheckResponse = { servers: {} };

    const updates = checkForUpdates(manifest, remote);
    expect(updates).toHaveLength(0);
  });

  it("uses 0.0.0 for servers without version", () => {
    const manifest: ServerManifest = {
      servers: {
        noVer: { command: "node", args: [], enabled: true },
      },
    };
    const remote: VersionCheckResponse = {
      servers: { noVer: { latestVersion: "1.0.0" } },
    };

    const updates = checkForUpdates(manifest, remote);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.currentVersion).toBe("0.0.0");
  });

  it("handles multiple servers with mixed update status", () => {
    const manifest: ServerManifest = {
      servers: {
        upToDate: { command: "node", args: [], enabled: true, version: "2.0.0" },
        needsUpdate: { command: "node", args: [], enabled: true, version: "1.0.0" },
        notRemote: { command: "node", args: [], enabled: true, version: "1.0.0" },
      },
    };
    const remote: VersionCheckResponse = {
      servers: {
        upToDate: { latestVersion: "2.0.0" },
        needsUpdate: { latestVersion: "3.0.0" },
      },
    };

    const updates = checkForUpdates(manifest, remote);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.name).toBe("needsUpdate");
  });
});

describe("applyUpdate", () => {
  it("backs up, stops, replaces, and starts", async () => {
    const deps = makeDeps();

    const result = await applyUpdate("srv", "2.0.0", deps);
    expect(result).toBe(true);
    expect(deps.backupServer).toHaveBeenCalledWith("srv");
    expect(deps.stopServer).toHaveBeenCalledWith("srv");
    expect(deps.replaceVersion).toHaveBeenCalledWith("srv", "2.0.0");
    expect(deps.startServer).toHaveBeenCalledWith("srv");
  });

  it("rolls back on failure", async () => {
    const deps = makeDeps({
      replaceVersion: vi.fn(async () => {
        throw new Error("replace failed");
      }),
    });

    const result = await applyUpdate("srv", "2.0.0", deps);
    expect(result).toBe(false);
    expect(deps.restoreBackup).toHaveBeenCalledWith("srv", "/backups/srv.bak");
    expect(deps.startServer).toHaveBeenCalledWith("srv");
  });

  it("rolls back when stopServer fails", async () => {
    const deps = makeDeps({
      stopServer: vi.fn(async () => {
        throw new Error("stop failed");
      }),
    });

    const result = await applyUpdate("srv", "2.0.0", deps);
    expect(result).toBe(false);
    expect(deps.restoreBackup).toHaveBeenCalled();
  });
});

describe("rollback", () => {
  it("stops server, restores backup, and starts", async () => {
    const deps = makeDeps();

    await rollback("srv", "/backups/srv.bak", deps);
    expect(deps.stopServer).toHaveBeenCalledWith("srv");
    expect(deps.restoreBackup).toHaveBeenCalledWith("srv", "/backups/srv.bak");
    expect(deps.startServer).toHaveBeenCalledWith("srv");
  });

  it("continues if stop fails (server already stopped)", async () => {
    const deps = makeDeps({
      stopServer: vi.fn(async () => {
        throw new Error("already stopped");
      }),
    });

    await rollback("srv", "/backups/srv.bak", deps);
    expect(deps.restoreBackup).toHaveBeenCalledWith("srv", "/backups/srv.bak");
    expect(deps.startServer).toHaveBeenCalledWith("srv");
  });
});
