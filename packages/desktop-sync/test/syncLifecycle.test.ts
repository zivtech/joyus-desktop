import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopSyncDeps, SyncConfig } from "../src/types";
import { createPeriodicSync, startupSync } from "../src/syncLifecycle";

function makeConfig(overrides?: Partial<SyncConfig>): SyncConfig {
  return {
    repoUrl: "https://repo.git",
    destDir: "/dest",
    cacheDir: "/cache",
    distributionConfigPath: "/config.json",
    bundleName: "core-skills",
    syncIntervalMs: 1000,
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<DesktopSyncDeps>): DesktopSyncDeps {
  return {
    execGit: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
    readFile: vi.fn().mockImplementation((path: string) => {
      if (path === "/config.json") {
        return Promise.resolve(
          JSON.stringify({
            bundles: {
              "core-skills": { version: "v1.0.0" },
            },
          })
        );
      }
      return Promise.reject(new Error("file not found"));
    }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(false),
    copyDir: vi.fn().mockResolvedValue(undefined),
    now: vi.fn().mockReturnValue("2026-03-11T00:00:00Z"),
    ...overrides,
  };
}

describe("startupSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("performs a full sync on first run", async () => {
    const config = makeConfig();
    const deps = makeDeps();

    const result = await startupSync(config, deps);

    expect(result.version).toBe("v1.0.0");
    expect(result.syncedAt).toBe("2026-03-11T00:00:00Z");
    expect(result.fromCache).toBe(false);
    expect(typeof result.durationMs).toBe("number");
    expect(deps.mkdir).toHaveBeenCalledWith("/cache", { recursive: true });
    expect(deps.execGit).toHaveBeenCalled();
    expect(deps.writeFile).toHaveBeenCalled();
  });

  it("returns fromCache true when version has not changed", async () => {
    const config = makeConfig();
    const deps = makeDeps({
      readFile: vi.fn().mockImplementation((path: string) => {
        if (path === "/config.json") {
          return Promise.resolve(
            JSON.stringify({
              bundles: {
                "core-skills": { version: "v1.0.0" },
              },
            })
          );
        }
        if (path === "/cache/.sync-metadata.json") {
          return Promise.resolve(
            JSON.stringify({
              version: "v1.0.0",
              syncedAt: "2026-03-10T00:00:00Z",
              lastCheckAt: "2026-03-10T00:00:00Z",
            })
          );
        }
        return Promise.reject(new Error("file not found"));
      }),
    });

    const result = await startupSync(config, deps);

    expect(result.fromCache).toBe(true);
    expect(result.version).toBe("v1.0.0");
    // Should not have called execGit for clone/update since version matches
    expect(deps.execGit).not.toHaveBeenCalled();
  });

  it("performs full sync when version has changed", async () => {
    const config = makeConfig();
    const deps = makeDeps({
      readFile: vi.fn().mockImplementation((path: string) => {
        if (path === "/config.json") {
          return Promise.resolve(
            JSON.stringify({
              bundles: {
                "core-skills": { version: "v2.0.0" },
              },
            })
          );
        }
        if (path === "/cache/.sync-metadata.json") {
          return Promise.resolve(
            JSON.stringify({
              version: "v1.0.0",
              syncedAt: "2026-03-10T00:00:00Z",
              lastCheckAt: "2026-03-10T00:00:00Z",
            })
          );
        }
        return Promise.reject(new Error("file not found"));
      }),
    });

    const result = await startupSync(config, deps);

    expect(result.fromCache).toBe(false);
    expect(result.version).toBe("v2.0.0");
    expect(deps.execGit).toHaveBeenCalled();
  });

  it("handles metadata with invalid JSON gracefully", async () => {
    const config = makeConfig();
    const deps = makeDeps({
      readFile: vi.fn().mockImplementation((path: string) => {
        if (path === "/config.json") {
          return Promise.resolve(
            JSON.stringify({
              bundles: {
                "core-skills": { version: "v1.0.0" },
              },
            })
          );
        }
        if (path === "/cache/.sync-metadata.json") {
          return Promise.resolve("not valid json");
        }
        return Promise.reject(new Error("file not found"));
      }),
    });

    const result = await startupSync(config, deps);

    expect(result.fromCache).toBe(false);
    expect(result.version).toBe("v1.0.0");
  });

  it("handles metadata with missing version field", async () => {
    const config = makeConfig();
    const deps = makeDeps({
      readFile: vi.fn().mockImplementation((path: string) => {
        if (path === "/config.json") {
          return Promise.resolve(
            JSON.stringify({
              bundles: {
                "core-skills": { version: "v1.0.0" },
              },
            })
          );
        }
        if (path === "/cache/.sync-metadata.json") {
          return Promise.resolve(JSON.stringify({ syncedAt: "2026-03-10T00:00:00Z" }));
        }
        return Promise.reject(new Error("file not found"));
      }),
    });

    const result = await startupSync(config, deps);

    // metadata version is undefined, so hasVersionChanged("undefined" !== "v1.0.0") is true => not from cache
    expect(result.fromCache).toBe(false);
  });

  it("handles metadata with non-string version field", async () => {
    const config = makeConfig();
    const deps = makeDeps({
      readFile: vi.fn().mockImplementation((path: string) => {
        if (path === "/config.json") {
          return Promise.resolve(
            JSON.stringify({
              bundles: {
                "core-skills": { version: "v1.0.0" },
              },
            })
          );
        }
        if (path === "/cache/.sync-metadata.json") {
          return Promise.resolve(JSON.stringify({ version: 123 }));
        }
        return Promise.reject(new Error("file not found"));
      }),
    });

    const result = await startupSync(config, deps);

    expect(result.fromCache).toBe(false);
  });

  it("handles metadata that is not an object", async () => {
    const config = makeConfig();
    const deps = makeDeps({
      readFile: vi.fn().mockImplementation((path: string) => {
        if (path === "/config.json") {
          return Promise.resolve(
            JSON.stringify({
              bundles: {
                "core-skills": { version: "v1.0.0" },
              },
            })
          );
        }
        if (path === "/cache/.sync-metadata.json") {
          return Promise.resolve(JSON.stringify("a string"));
        }
        return Promise.reject(new Error("file not found"));
      }),
    });

    const result = await startupSync(config, deps);

    expect(result.fromCache).toBe(false);
  });

  it("handles null metadata", async () => {
    const config = makeConfig();
    const deps = makeDeps({
      readFile: vi.fn().mockImplementation((path: string) => {
        if (path === "/config.json") {
          return Promise.resolve(
            JSON.stringify({
              bundles: {
                "core-skills": { version: "v1.0.0" },
              },
            })
          );
        }
        if (path === "/cache/.sync-metadata.json") {
          return Promise.resolve("null");
        }
        return Promise.reject(new Error("file not found"));
      }),
    });

    const result = await startupSync(config, deps);

    expect(result.fromCache).toBe(false);
  });
});

describe("createPeriodicSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with idle status", () => {
    const config = makeConfig();
    const deps = makeDeps();

    const periodic = createPeriodicSync(config, deps);
    expect(periodic.getStatus()).toBe("idle");
  });

  it("runs sync on interval tick", async () => {
    const config = makeConfig({ syncIntervalMs: 5000 });
    const deps = makeDeps();

    const periodic = createPeriodicSync(config, deps);
    periodic.start();

    expect(periodic.getStatus()).toBe("idle");

    // Advance past one interval
    await vi.advanceTimersByTimeAsync(5000);

    expect(periodic.getStatus()).toBe("synced");
    expect(deps.execGit).toHaveBeenCalled();
  });

  it("sets status to error when sync fails", async () => {
    const config = makeConfig({ syncIntervalMs: 5000 });
    const deps = makeDeps({
      readFile: vi.fn().mockRejectedValue(new Error("read fail")),
    });

    const periodic = createPeriodicSync(config, deps);
    periodic.start();

    await vi.advanceTimersByTimeAsync(5000);

    expect(periodic.getStatus()).toBe("error");
  });

  it("stops the interval timer", async () => {
    const config = makeConfig({ syncIntervalMs: 5000 });
    const deps = makeDeps();

    const periodic = createPeriodicSync(config, deps);
    periodic.start();
    periodic.stop();

    expect(periodic.getStatus()).toBe("idle");

    await vi.advanceTimersByTimeAsync(10000);

    // Should not have run any syncs
    expect(deps.execGit).not.toHaveBeenCalled();
  });

  it("skips tick when already syncing (mutex)", async () => {
    const config = makeConfig({ syncIntervalMs: 5000 });

    let resolveSync: (() => void) | undefined;
    const slowReadFile = vi.fn().mockImplementation((path: string) => {
      if (path === "/config.json") {
        return new Promise<string>((resolve) => {
          resolveSync = () =>
            resolve(
              JSON.stringify({
                bundles: {
                  "core-skills": { version: "v1.0.0" },
                },
              })
            );
        });
      }
      return Promise.reject(new Error("file not found"));
    });

    const deps = makeDeps({ readFile: slowReadFile });
    const periodic = createPeriodicSync(config, deps);
    periodic.start();

    // First tick starts sync
    await vi.advanceTimersByTimeAsync(5000);
    expect(periodic.getStatus()).toBe("syncing");

    // Second tick should be skipped (mutex)
    await vi.advanceTimersByTimeAsync(5000);
    expect(slowReadFile).toHaveBeenCalledTimes(1);

    // Resolve the slow sync
    resolveSync!();
    await vi.advanceTimersByTimeAsync(0);

    expect(periodic.getStatus()).toBe("synced");
  });

  it("does not start a second timer if already started", async () => {
    const config = makeConfig({ syncIntervalMs: 5000 });
    const deps = makeDeps();

    const periodic = createPeriodicSync(config, deps);
    periodic.start();
    periodic.start(); // second call should be no-op

    await vi.advanceTimersByTimeAsync(5000);

    // readFile should only be called once (from one timer, not two)
    expect(deps.readFile).toHaveBeenCalledTimes(2); // config + metadata attempt
  });

  it("stop during active sync keeps syncing status", async () => {
    const config = makeConfig({ syncIntervalMs: 5000 });

    let resolveSync: (() => void) | undefined;
    const slowReadFile = vi.fn().mockImplementation((path: string) => {
      if (path === "/config.json") {
        return new Promise<string>((resolve) => {
          resolveSync = () =>
            resolve(
              JSON.stringify({
                bundles: {
                  "core-skills": { version: "v1.0.0" },
                },
              })
            );
        });
      }
      return Promise.reject(new Error("file not found"));
    });

    const deps = makeDeps({ readFile: slowReadFile });
    const periodic = createPeriodicSync(config, deps);
    periodic.start();

    // Start a sync
    await vi.advanceTimersByTimeAsync(5000);
    expect(periodic.getStatus()).toBe("syncing");

    // Stop while syncing -- should NOT reset to idle because sync is still running
    periodic.stop();
    expect(periodic.getStatus()).toBe("syncing");

    // Resolve the sync
    resolveSync!();
    await vi.advanceTimersByTimeAsync(0);

    expect(periodic.getStatus()).toBe("synced");
  });
});
