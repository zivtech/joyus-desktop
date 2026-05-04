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
import { detectChrome, type ChromeDetectDeps } from "./chrome-detect";
import { scanSkills, type SkillScannerDeps } from "./skill-scanner";

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

function parseOnboardingParams(params: unknown): OnboardingParams {
  if (params === null || typeof params !== "object") {
    throw new Error("onboarding.start: params must be an object");
  }
  const p = params as Record<string, unknown>;
  if (typeof p["authToken"] !== "string" || p["authToken"] === "") {
    throw new Error("onboarding.start: missing required field: authToken");
  }
  if (typeof p["tenantId"] !== "string" || p["tenantId"] === "") {
    throw new Error("onboarding.start: missing required field: tenantId");
  }
  if (typeof p["workspaceId"] !== "string" || p["workspaceId"] === "") {
    throw new Error("onboarding.start: missing required field: workspaceId");
  }
  return {
    authToken: p["authToken"],
    tenantId: p["tenantId"],
    workspaceId: p["workspaceId"],
  };
}

export function registerOnboarding(
  ipc: IpcHandler,
  container: ServiceContainer,
  usageCollector: UsageCollector,
): void {
  ipc.registerMethod("onboarding.start", async (params: unknown) => {
    const p = parseOnboardingParams(params);
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

// ---------------------------------------------------------------------------
// Server management IPC methods
// ---------------------------------------------------------------------------

function requireName(params: unknown): string {
  if (params !== null && typeof params === "object" && "name" in params) {
    const name = (params as { name: unknown }).name;
    if (typeof name === "string" && name !== "") {
      return name;
    }
  }
  throw new Error("Missing required param: name");
}

export function registerServerMethods(ipc: IpcHandler, registry: Registry): void {
  ipc.registerMethod("servers.list", async () => {
    return registry.listServers();
  });

  ipc.registerMethod("servers.start", async (params: unknown) => {
    const name = requireName(params);
    return registry.startServer(name);
  });

  ipc.registerMethod("servers.stop", async (params: unknown) => {
    const name = requireName(params);
    await registry.stopServer(name);
    return { stopped: true };
  });

  ipc.registerMethod("servers.restart", async (params: unknown) => {
    const name = requireName(params);
    return registry.restartServer(name);
  });
}

export function registerServerNotifications(
  ipc: IpcHandler,
  pm: ProcessManager,
  registry: Registry,
): void {
  pm.startWatchdog(5_000, 5, (name: string) => {
    try {
      const servers = registry.listServers();
      const info = servers.find((s) => s.name === name);
      if (info !== undefined) {
        ipc.sendNotification("state.serverChanged", {
          name: info.name,
          status: info.status,
          ...(info.lastError !== undefined && { lastError: info.lastError }),
          restartCount: info.restartCount,
        });
      } else {
        ipc.sendNotification("state.serverChanged", {
          name,
          status: "error",
          lastError: "Max restarts exceeded",
          restartCount: 5,
        });
      }
    } catch {
      ipc.sendNotification("state.serverChanged", {
        name,
        status: "error",
        lastError: "Max restarts exceeded",
        restartCount: 5,
      });
    }
  });
}

export function registerChromeDetect(ipc: IpcHandler, deps: ChromeDetectDeps): void {
  ipc.registerMethod("chrome.detect", async () => {
    return detectChrome(deps);
  });
}

// ---------------------------------------------------------------------------
// Sync IPC methods
// ---------------------------------------------------------------------------

export interface SyncState {
  status: "idle" | "syncing" | "synced" | "error";
  version: string | null;
  timestamp: string | null;
}

export interface SyncIpcDeps {
  syncConfig: { destDir: string; bundleName: string };
  triggerSync: () => Promise<{ version: string; syncedAt: string; fromCache: boolean; durationMs: number }>;
  scannerDeps: SkillScannerDeps;
}

export function registerSyncMethods(
  ipc: IpcHandler,
  _container: ServiceContainer,
  syncIpcDeps: SyncIpcDeps,
  syncState: SyncState,
): void {
  ipc.registerMethod("sync.trigger", async () => {
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
      ipc.sendNotification("state.error", { source: "sync", message, fatal: false });
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
}

// ---------------------------------------------------------------------------
// Governance IPC methods
// ---------------------------------------------------------------------------

export interface GovernanceDecisionEntry {
  toolName: string;
  serverName: string;
  decision: "allow" | "deny" | "audit";
  mode: "off" | "audit" | "enforce";
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
    if (params !== null && typeof params === "object") {
      const p = params as Record<string, unknown>;
      if (typeof p["limit"] === "number") {
        limit = p["limit"];
      }
    }
    if (limit !== undefined) {
      return decisionLog.slice(-limit);
    }
    return decisionLog;
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

// ---------------------------------------------------------------------------
// Error reporting IPC methods
// ---------------------------------------------------------------------------

export interface TelemetryErrorDeps {
  emitTelemetry: (event: { toolName: string; source: string; message: string }) => Promise<void>;
  isOptedOut: () => boolean;
}

export function registerErrorReporting(ipc: IpcHandler, deps: TelemetryErrorDeps): void {
  ipc.registerMethod("state.reportError", async (params: unknown) => {
    let source = "unknown";
    let message = "unknown error";

    if (params !== null && typeof params === "object") {
      const p = params as Record<string, unknown>;
      if (typeof p["source"] === "string") source = p["source"];
      if (typeof p["message"] === "string") message = p["message"];
    }

    ipc.sendNotification("state.error", { source, message, fatal: false });

    if (!deps.isOptedOut()) {
      await deps.emitTelemetry({ toolName: "app_error", source, message });
    }

    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Session IPC methods
// ---------------------------------------------------------------------------

import type { SessionWiring } from "./sessionWiring.js";
import { SessionBrokenError, UncommittedChangesError } from "./sessionWiring.js";

function parseFileModifiedParams(
  params: unknown,
): { sessionId: string; repoPath: string; filePath: string } {
  if (params === null || typeof params !== "object") {
    throw new Error("session.fileModified: params must be an object");
  }
  const p = params as Record<string, unknown>;
  if (typeof p["sessionId"] !== "string" || p["sessionId"] === "") {
    throw new Error("session.fileModified: missing required field: sessionId");
  }
  if (typeof p["repoPath"] !== "string" || p["repoPath"] === "") {
    throw new Error("session.fileModified: missing required field: repoPath");
  }
  if (typeof p["filePath"] !== "string" || p["filePath"] === "") {
    throw new Error("session.fileModified: missing required field: filePath");
  }
  return {
    sessionId: p["sessionId"],
    repoPath: p["repoPath"],
    filePath: p["filePath"],
  };
}

function requireTaskBranchId(params: unknown): { taskBranchId: string } {
  if (params !== null && typeof params === "object") {
    const p = params as Record<string, unknown>;
    if (typeof p["taskBranchId"] === "string" && p["taskBranchId"] !== "") {
      return { taskBranchId: p["taskBranchId"] };
    }
  }
  throw new Error("Missing required param: taskBranchId");
}

function extractOptionalRepoPath(params: unknown): string | undefined {
  if (params !== null && typeof params === "object") {
    const p = params as Record<string, unknown>;
    if (typeof p["repoPath"] === "string" && p["repoPath"] !== "") {
      return p["repoPath"];
    }
  }
  return undefined;
}

function extractRequiredRepoPath(params: unknown): string {
  if (params !== null && typeof params === "object") {
    const p = params as Record<string, unknown>;
    if (typeof p["repoPath"] === "string" && p["repoPath"] !== "") {
      return p["repoPath"];
    }
  }
  throw new Error("Missing required param: repoPath");
}

export function registerSessionMethods(
  ipc: IpcHandler,
  wiring: SessionWiring,
): void {
  // T022 — session.fileModified
  ipc.registerMethod("session.fileModified", async (params: unknown) => {
    const { sessionId, repoPath, filePath } = parseFileModifiedParams(params);
    wiring.detector.handleIpcEvent({ sessionId, repoPath, filePath });
    return { ok: true };
  });

  // T023 — session.list
  ipc.registerMethod("session.list", async () => {
    return wiring.store.listAll();
  });

  // T023 — session.resume
  ipc.registerMethod("session.resume", async (params: unknown) => {
    const { taskBranchId } = requireTaskBranchId(params);
    try {
      return await wiring.sessionManager.resume(taskBranchId);
    } catch (err) {
      if (err instanceof SessionBrokenError) {
        return { error: "broken", message: err.message };
      }
      throw err;
    }
  });

  // T023 — session.delete
  ipc.registerMethod("session.delete", async (params: unknown) => {
    const { taskBranchId } = requireTaskBranchId(params);
    const force = (params as Record<string, unknown>)["force"] === true;
    try {
      await wiring.sessionManager.delete(taskBranchId, { force });
      wiring.driftDetector.clearSession(taskBranchId);
      return { ok: true };
    } catch (err) {
      if (err instanceof UncommittedChangesError) {
        return { error: "uncommitted_changes" };
      }
      throw err;
    }
  });

  // T023 — session.hasUncommittedChanges
  ipc.registerMethod(
    "session.hasUncommittedChanges",
    async (params: unknown) => {
      const { taskBranchId } = requireTaskBranchId(params);
      const hasUncommittedChanges =
        await wiring.sessionManager.hasUncommittedChanges(taskBranchId);
      return { hasUncommittedChanges };
    },
  );

  // T024 — session.getMode
  ipc.registerMethod("session.getMode", async (params: unknown) => {
    const repoPath = extractOptionalRepoPath(params);
    const mode = wiring.sessionManager.getMode(repoPath);
    return { mode };
  });

  // T024 — session.setMode
  ipc.registerMethod("session.setMode", async (params: unknown) => {
    const p = params as Record<string, unknown>;
    const mode = p["mode"];
    if (mode !== "managed" && mode !== "advisory") {
      throw new Error(
        `session.setMode: invalid mode "${String(mode)}". Must be 'managed' or 'advisory'`,
      );
    }
    const repoPath = extractOptionalRepoPath(params);
    wiring.sessionManager.setMode(mode, repoPath);
    return { ok: true };
  });

  // WP-3 — session.listByRepo
  ipc.registerMethod("session.listByRepo", async (params: unknown) => {
    const repoPath = extractRequiredRepoPath(params);
    return wiring.store.findByRepoPath(repoPath);
  });

  // WP-3 — session.countsByRepo
  ipc.registerMethod("session.countsByRepo", async () => {
    return wiring.store.countsByRepo();
  });
}
