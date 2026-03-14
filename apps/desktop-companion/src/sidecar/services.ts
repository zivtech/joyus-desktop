import type { ProcessManager } from "@joyus/mcp-registry";
import type { Registry } from "@joyus/mcp-registry";
import type { McpServerInfo } from "@joyus/mcp-registry";
import type { ConfigPoller } from "@joyus/mcp-governance";
import type { PeriodicSync } from "@joyus/desktop-sync";
import type { IpcHandler } from "./ipc-handler";
import { JSON_RPC_ERRORS } from "./ipc-handler";
import type { ChromeDetectDeps } from "./chrome-detect";
import { detectChrome } from "./chrome-detect";

export interface ServiceContainer {
  processManager: ProcessManager;
  registry: Registry;
  configPoller: ConfigPoller;
  periodicSync: PeriodicSync;
}

export interface ServiceConfig {
  manifestPath: string;
  governanceConfigPath: string;
  governancePollIntervalMs: number;
  syncConfig: {
    repoUrl: string;
    cacheDir: string;
    destDir: string;
    distributionConfigPath: string;
    bundleName: string;
    syncIntervalMs: number;
  };
}

export interface ServiceDeps {
  createProcessManager: () => ProcessManager;
  createRegistry: (processManager: ProcessManager) => Registry;
  createConfigPoller: (configPath: string, intervalMs: number) => ConfigPoller;
  createPeriodicSync: () => PeriodicSync;
}

export function createServices(
  deps: ServiceDeps,
): ServiceContainer {
  const processManager = deps.createProcessManager();
  const registry = deps.createRegistry(processManager);
  const configPoller = deps.createConfigPoller("governance.json", 30_000);
  const periodicSync = deps.createPeriodicSync();

  return {
    processManager,
    registry,
    configPoller,
    periodicSync,
  };
}

export function registerHealthCheck(
  ipc: IpcHandler,
  startTime: number,
  nowFn: () => number,
): void {
  ipc.registerMethod("health.check", async () => {
    return { ok: true, uptime_ms: nowFn() - startTime };
  });
}

function extractParams(params: unknown): Record<string, unknown> {
  if (params !== null && typeof params === "object" && !Array.isArray(params)) {
    return params as Record<string, unknown>;
  }
  return {};
}

function invalidParams(message: string): never {
  const err = new Error(message) as Error & { code: number };
  err.code = JSON_RPC_ERRORS.INVALID_PARAMS;
  throw err;
}

export function registerServerMethods(
  ipc: IpcHandler,
  registry: Registry,
): void {
  ipc.registerMethod("servers.list", async () => {
    return registry.listServers();
  });

  ipc.registerMethod("servers.start", async (params) => {
    const p = extractParams(params);
    const name = p["name"];
    if (typeof name !== "string" || name.length === 0) {
      invalidParams("Missing required param: name");
    }
    return registry.startServer(name);
  });

  ipc.registerMethod("servers.stop", async (params) => {
    const p = extractParams(params);
    const name = p["name"];
    if (typeof name !== "string" || name.length === 0) {
      invalidParams("Missing required param: name");
    }
    await registry.stopServer(name);
    return { stopped: true };
  });

  ipc.registerMethod("servers.restart", async (params) => {
    const p = extractParams(params);
    const name = p["name"];
    if (typeof name !== "string" || name.length === 0) {
      invalidParams("Missing required param: name");
    }
    return registry.restartServer(name);
  });
}

export function registerServerNotifications(
  ipc: IpcHandler,
  processManager: ProcessManager,
  registry: Registry,
): void {
  processManager.startWatchdog(
    5_000,
    5,
    (name: string) => {
      // Watchdog called onRestart after the process was removed from the map.
      // At this point the server was restarted (or hit max restarts).
      // We need to determine the status from the registry if possible.
      let info: McpServerInfo | undefined;
      try {
        info = registry.listServers().find((s) => s.name === name);
      } catch {
        // ignore
      }

      if (info !== undefined) {
        ipc.sendNotification("state.serverChanged", {
          name,
          status: info.status,
          ...(info.lastError !== undefined && { lastError: info.lastError }),
          restartCount: info.restartCount,
        });
      } else {
        // Server hit max restarts — not in registry anymore or errored
        ipc.sendNotification("state.serverChanged", {
          name,
          status: "error",
          lastError: "Max restarts exceeded",
          restartCount: 5,
        });
      }
    },
  );
}

export function registerChromeDetect(
  ipc: IpcHandler,
  chromeDeps: ChromeDetectDeps,
): void {
  ipc.registerMethod("chrome.detect", async () => {
    return detectChrome(chromeDeps);
  });
}
