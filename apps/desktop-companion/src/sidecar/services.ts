import type { ProcessManager } from "@joyus/mcp-registry";
import type { Registry } from "@joyus/mcp-registry";
import type { ConfigPoller } from "@joyus/mcp-governance";
import type { PeriodicSync, SyncResult, SyncStatus } from "@joyus/desktop-sync";
import type { GovernanceDecision, GovernanceMode } from "@joyus/mcp-governance";
import type { IpcHandler } from "./ipc-handler";
import type { SkillScannerDeps } from "./skill-scanner";
import { scanSkills } from "./skill-scanner";

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

export interface SyncState {
  status: SyncStatus;
  version: string | null;
  timestamp: string | null;
}

export interface GovernanceDecisionEntry {
  toolName: string;
  serverName: string;
  decision: GovernanceDecision;
  mode: GovernanceMode;
}

export interface SyncTriggerDeps {
  triggerSync: () => Promise<SyncResult>;
  scannerDeps: SkillScannerDeps;
}

export interface SyncIpcDeps {
  syncConfig: { destDir: string; bundleName: string };
  triggerSync: () => Promise<SyncResult>;
  scannerDeps: SkillScannerDeps;
}

export function registerSyncMethods(
  ipc: IpcHandler,
  container: ServiceContainer,
  syncIpcDeps: SyncIpcDeps,
  syncState: SyncState,
): void {
  ipc.registerMethod("sync.trigger", async () => {
    syncState.status = "syncing";
    try {
      const result = await syncIpcDeps.triggerSync();
      syncState.status = "synced";
      syncState.version = result.version;
      syncState.timestamp = result.syncedAt;

      ipc.sendNotification("state.syncCompleted", {
        version: result.version,
        fromCache: result.fromCache,
        durationMs: result.durationMs,
      });

      return result;
    } catch (err: unknown) {
      syncState.status = "error";
      const message = err instanceof Error ? err.message : String(err);
      ipc.sendNotification("state.error", {
        source: "sync.trigger",
        message,
        fatal: false,
      });
      throw err;
    }
  });

  ipc.registerMethod("sync.status", async () => {
    return {
      status: syncState.status,
      version: syncState.version,
      timestamp: syncState.timestamp,
    };
  });

  ipc.registerMethod("skills.list", async () => {
    return scanSkills(
      syncIpcDeps.syncConfig.destDir,
      syncIpcDeps.syncConfig.bundleName,
      syncIpcDeps.scannerDeps,
    );
  });

  // Expose container for periodic sync status fallback
  void container;
}

export function registerGovernanceMethods(
  ipc: IpcHandler,
  container: ServiceContainer,
  decisionLog: GovernanceDecisionEntry[],
): void {
  ipc.registerMethod("governance.getMode", async () => {
    const config = container.configPoller.getConfig();
    return { mode: config.mode };
  });

  ipc.registerMethod("governance.getDecisions", async (params: unknown) => {
    let limit: number | undefined;
    if (
      params !== null &&
      params !== undefined &&
      typeof params === "object"
    ) {
      const p = params as Record<string, unknown>;
      if (typeof p["limit"] === "number") {
        limit = p["limit"];
      }
    }
    const entries = limit !== undefined ? decisionLog.slice(-limit) : decisionLog.slice();
    return entries;
  });
}

export function emitGovernanceDecision(
  ipc: IpcHandler,
  decisionLog: GovernanceDecisionEntry[],
  entry: GovernanceDecisionEntry,
): void {
  decisionLog.push(entry);
  ipc.sendNotification("state.governanceDecision", entry);
}

export interface TelemetryErrorDeps {
  emitTelemetry: (params: {
    toolName: string;
    source: string;
    message: string;
  }) => Promise<void>;
  isOptedOut: () => boolean;
}

export function registerErrorReporting(
  ipc: IpcHandler,
  telemetryDeps: TelemetryErrorDeps,
): void {
  // Non-fatal error notification helper exposed via returned function
  // (used by callers that need to report non-fatal errors)
  ipc.registerMethod("state.reportError", async (params: unknown) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const source = typeof p["source"] === "string" ? p["source"] : "unknown";
    const message = typeof p["message"] === "string" ? p["message"] : "unknown error";

    ipc.sendNotification("state.error", { source, message, fatal: false });

    if (!telemetryDeps.isOptedOut()) {
      await telemetryDeps.emitTelemetry({ toolName: "app_error", source, message });
    }

    return { ok: true };
  });
}
