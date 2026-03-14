import type { ProcessManager } from "@joyus/mcp-registry";
import type { Registry } from "@joyus/mcp-registry";
import type { ConfigPoller } from "@joyus/mcp-governance";
import type { PeriodicSync } from "@joyus/desktop-sync";
import type { IpcHandler } from "./ipc-handler";
import {
  createUsageCollector,
  registerUsageMethods,
  type UsageCollector,
} from "./usage-collector";

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

export interface OnboardingParams {
  authToken: string;
  tenantId: string;
  workspaceId: string;
}

export interface OnboardingResult {
  success: boolean;
  serversStarted: number;
  skillsSynced: boolean;
  errors: string[];
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

export function registerOnboarding(
  ipc: IpcHandler,
  container: ServiceContainer,
  usageCollector: UsageCollector,
): void {
  ipc.registerMethod("onboarding.start", async (params: unknown) => {
    const p = params as OnboardingParams;
    const errors: string[] = [];
    let serversStarted = 0;
    let skillsSynced = false;

    // Step 1: store auth credentials by recording a usage event
    try {
      usageCollector.recordEvent({
        eventType: "server_event",
        source: "onboarding",
        action: "auth_configured",
        outcome: "success",
        durationMs: 0,
        metadata: { tenantId: p.tenantId, workspaceId: p.workspaceId },
      });
      ipc.sendNotification("config.set", {
        key: "auth",
        value: JSON.stringify({
          authToken: p.authToken,
          tenantId: p.tenantId,
          workspaceId: p.workspaceId,
        }),
      });
    } catch (err) {
      errors.push(
        `auth: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Step 2: start all MCP servers
    try {
      const infos = container.registry.startAll();
      serversStarted = infos.filter((i: { status: string }) => i.status === "running").length;
    } catch (err) {
      errors.push(
        `servers: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Step 3: trigger skill sync
    try {
      container.periodicSync.start();
      skillsSynced = true;
    } catch (err) {
      errors.push(
        `sync: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Step 4: persist onboarding_complete flag
    ipc.sendNotification("config.set", {
      key: "onboarding_complete",
      value: "true",
    });

    const result: OnboardingResult = {
      success: errors.length === 0,
      serversStarted,
      skillsSynced,
      errors,
    };

    return result;
  });
}

export function registerAllMethods(
  ipc: IpcHandler,
  container: ServiceContainer,
  startTime: number,
  nowFn: () => number,
): void {
  const usageCollector = createUsageCollector(ipc, {
    nowFn: () => new Date().toISOString(),
    pruneAfterDays: 30,
  });

  registerHealthCheck(ipc, startTime, nowFn);
  registerUsageMethods(ipc, usageCollector);
  registerOnboarding(ipc, container, usageCollector);
}
