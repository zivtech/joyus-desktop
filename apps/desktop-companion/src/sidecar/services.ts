import type { ProcessManager } from "@joyus/mcp-registry";
import type { Registry } from "@joyus/mcp-registry";
import type { ConfigPoller } from "@joyus/mcp-governance";
import type { PeriodicSync } from "@joyus/desktop-sync";
import type { IpcHandler } from "./ipc-handler";

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
