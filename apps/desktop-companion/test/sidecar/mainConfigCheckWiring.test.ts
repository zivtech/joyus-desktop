import { describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { startSidecar } from "../../src/sidecar/main";
import type { SidecarDeps } from "../../src/sidecar/main";
import type { ServiceDeps } from "../../src/sidecar/services";

function makeStubServiceDeps(): ServiceDeps {
  return {
    createProcessManager: () => ({
      spawnServer: vi.fn() as never,
      stopServer: vi.fn() as never,
      stopAll: vi.fn().mockResolvedValue(undefined) as never,
      isRunning: vi.fn().mockReturnValue(false) as never,
      getEntry: vi.fn().mockReturnValue(undefined) as never,
      writePidFile: vi.fn() as never,
      readPidFile: vi.fn() as never,
      cleanupOrphans: vi.fn() as never,
      startWatchdog: vi.fn() as never,
      stopWatchdog: vi.fn() as never,
    }),
    createRegistry: () => ({
      registerServer: vi.fn() as never,
      unregisterServer: vi.fn() as never,
      startServer: vi.fn() as never,
      stopServer: vi.fn() as never,
      restartServer: vi.fn() as never,
      getStatus: vi.fn() as never,
      listServers: vi.fn().mockReturnValue([]) as never,
      startAll: vi.fn() as never,
      stopAll: vi.fn() as never,
    }),
    createConfigPoller: () => ({
      start: vi.fn().mockResolvedValue(undefined) as never,
      stop: vi.fn() as never,
      getConfig: vi
        .fn()
        .mockReturnValue({ mode: "off", updatedAt: "" }) as never,
    }),
    createPeriodicSync: () => ({
      start: vi.fn() as never,
      stop: vi.fn() as never,
      getStatus: vi.fn().mockReturnValue("idle" as const) as never,
    }),
  };
}

function makeDeps(overrides?: Partial<SidecarDeps>): SidecarDeps {
  return {
    stdin: new Readable({
      read() {
        this.push(null);
      },
    }),
    stdout: { write: vi.fn() },
    stderr: { write: vi.fn() },
    exit: vi.fn(),
    onSignal: vi.fn(),
    onUncaughtException: vi.fn(),
    onUnhandledRejection: vi.fn(),
    nowFn: vi.fn().mockReturnValue(1000),
    serviceDeps: makeStubServiceDeps(),
    isOptedOut: vi.fn().mockReturnValue(false),
    emitTelemetry: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("startSidecar managed tooling wiring", () => {
  it("starts config-check wiring when managed tooling config is provided and logs poll errors", () => {
    const createConfigCheckWiringFn = vi.fn((config) => {
      config.onPollError?.(new Error("poll failed"));

      return {
        stop: vi.fn(),
        getState: () => ({ consecutiveFailures: 1 }),
      };
    });
    const deps = makeDeps({
      managedToolingConfig: {
        manifestUrl: "https://example.com/manifest.json",
        intervalMs: 30_000,
        syncConfig: {
          repoUrl: "file:///repo.git",
          bundleName: "core",
          destDir: "/tmp/skills",
          cacheDir: "/tmp/cache",
        },
      },
      createConfigCheckWiringFn,
    });

    startSidecar(deps);

    expect(createConfigCheckWiringFn).toHaveBeenCalledOnce();
    expect(deps.stderr.write).toHaveBeenCalledWith(
      "configCheckWiring: poll failed: poll failed\n",
    );
  });

  it("passes optional managed-tooling config through and logs handler warnings and errors", async () => {
    let capturedOnSync: ((manifest: {
      schema_version: string;
      tenant_id: string;
      bundles: Record<string, { version: string }>;
    }) => Promise<void>) | undefined;

    const deps = makeDeps({
      managedToolingConfig: {
        manifestUrl: "https://example.com/manifest.json",
        intervalMs: 15_000,
        tenantConfigPath: "/tmp/tenant-config.json",
        reconcileConfig: {
          globalSettingsPath: "/tmp/global-settings.json",
        },
        syncConfig: {
          repoUrl: "file:///repo.git",
          destDir: "/tmp/skills",
          cacheDir: "/tmp/cache",
        },
      },
      createConfigCheckWiringFn: vi.fn((config) => {
        capturedOnSync = config.onSync;

        return {
          stop: vi.fn(),
          getState: () => ({ consecutiveFailures: 0 }),
        };
      }),
    });

    startSidecar(deps);

    await capturedOnSync?.({
      schema_version: "1.0",
      tenant_id: "tenant-1",
      bundles: {
        "bundle-a": { version: "v1.0.0" },
        "bundle-b": { version: "v2.0.0" },
      },
    });

    expect(deps.createConfigCheckWiringFn).toHaveBeenCalledWith(
      expect.objectContaining({
        intervalMs: 15_000,
      }),
    );
    expect(deps.stderr.write).toHaveBeenCalledWith(
      "configCheckWiring: Unable to resolve skill-sync target version from manifest with multiple bundle versions; configure bundleName explicitly.\n",
    );
    expect(deps.stderr.write).toHaveBeenCalledWith(
      "configCheckWiring: skipping skill sync because no target version could be resolved.\n",
    );
  });

  it("stops the config-check wiring on SIGTERM", async () => {
    let sigtermHandler: (() => void) | undefined;
    const stop = vi.fn();
    const deps = makeDeps({
      managedToolingConfig: {
        manifestUrl: "https://example.com/manifest.json",
        syncConfig: {
          repoUrl: "file:///repo.git",
          bundleName: "core",
          destDir: "/tmp/skills",
          cacheDir: "/tmp/cache",
        },
      },
      createConfigCheckWiringFn: vi.fn(() => ({
        stop,
        getState: () => ({ consecutiveFailures: 0 }),
      })),
      onSignal: vi.fn((signal: string, handler: () => void) => {
        if (signal === "SIGTERM") {
          sigtermHandler = handler;
        }
      }),
    });

    startSidecar(deps);

    sigtermHandler?.();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(stop).toHaveBeenCalledOnce();
    expect(deps.exit).toHaveBeenCalledWith(0);
  });
});
