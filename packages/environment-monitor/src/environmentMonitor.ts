import { randomUUID } from "node:crypto";

import type { ExecCommand } from "./deploymentStatusPoller.js";
import type { DeploymentStatusPoller } from "./deploymentStatusPoller.js";
import type { ActivityLog } from "./activityLog.js";
import type {
  RemoteEnvironment,
  RemoteEnvironmentStatus,
  RemoteEnvironmentStore,
} from "./remoteEnvironmentStore.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EnvironmentMonitor {
  /** Handle a push+PR event from Feature 006. Triggers immediate poll. */
  onPrCreated(
    repoOwner: string,
    repoName: string,
    prNumber: number,
    taskBranchId: string,
  ): Promise<void>;

  /** Request a joyus-ai hosted environment for a project. */
  requestHostedEnvironment(
    repoOwner: string,
    repoName: string,
  ): Promise<RemoteEnvironment>;

  /** List all remote environments (Probo + joyus-ai hosted). */
  listAll(): readonly RemoteEnvironment[];

  /** List environments for a specific repo. */
  listByRepo(
    repoOwner: string,
    repoName: string,
  ): readonly RemoteEnvironment[];

  /** Get the activity log instance. */
  getActivityLog(): ActivityLog;

  /** Start background polling and run an initial sync. */
  start(): void;

  /** Stop background polling. */
  stop(): void;
}

export interface EnvironmentMonitorDeps {
  readonly store: RemoteEnvironmentStore;
  readonly activityLog: ActivityLog;
  readonly poller: DeploymentStatusPoller;
  readonly execCommand: ExecCommand;
  /** Called after each poll cycle; used to react to status changes. */
  readonly onPollResult?: (env: RemoteEnvironment, previousStatus: RemoteEnvironmentStatus) => void;
}

// ─── PR Title Lookup ──────────────────────────────────────────────────────────

interface GhPrJson {
  title?: string;
  url?: string;
}

async function fetchPrTitle(
  execCommand: ExecCommand,
  repoOwner: string,
  repoName: string,
  prNumber: number,
): Promise<{ title: string | undefined; url: string | undefined }> {
  try {
    const { stdout } = await execCommand([
      "gh",
      "api",
      `repos/${repoOwner}/${repoName}/pulls/${prNumber}`,
    ]);
    const parsed = JSON.parse(stdout) as GhPrJson;
    return {
      title: typeof parsed.title === "string" ? parsed.title : undefined,
      url: typeof parsed.url === "string" ? parsed.url : undefined,
    };
  } catch {
    return { title: undefined, url: undefined };
  }
}

// ─── Joyus AI Hosted Environment Stub ─────────────────────────────────────────

/**
 * Stub for joyus-ai API. Returns a provisioning-status environment.
 * Will be replaced with a real API call once the platform endpoint is available.
 */
async function requestJoyusAiEnvironment(
  store: RemoteEnvironmentStore,
  repoOwner: string,
  repoName: string,
): Promise<RemoteEnvironment> {
  const now = Date.now();
  return store.upsertFromDeployment({
    repoOwner,
    repoName,
    environmentType: "joyus-ai-hosted",
    prNumber: undefined,
    prUrl: undefined,
    prTitle: undefined,
    deploymentId: undefined,
    environmentUrl: undefined,
    status: "provisioning",
    taskBranchId: undefined,
    errorMessage: undefined,
    lastCheckedAt: now,
  });
}

// ─── Status Transition Logging ────────────────────────────────────────────────

function logStatusChange(
  activityLog: ActivityLog,
  env: RemoteEnvironment,
  previousStatus: RemoteEnvironmentStatus,
): void {
  const nextStatus = env.status;
  if (nextStatus === previousStatus) return;

  activityLog.append({
    repoOwner: env.repoOwner,
    repoName: env.repoName,
    eventType: "status_changed",
    detail: `${previousStatus} → ${nextStatus}`,
  });

  // Log terminal-state events with more specific event types
  if (nextStatus === "expired") {
    activityLog.append({
      repoOwner: env.repoOwner,
      repoName: env.repoName,
      eventType: "environment_expired",
    });
  } else if (nextStatus === "failed") {
    activityLog.append({
      repoOwner: env.repoOwner,
      repoName: env.repoName,
      eventType: "environment_failed",
    });
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createEnvironmentMonitor(
  deps: EnvironmentMonitorDeps,
): EnvironmentMonitor {
  const { store, activityLog, poller, execCommand, onPollResult } = deps;

  let started = false;

  async function runInitialSync(): Promise<void> {
    const all = store.listAll();
    const seen = new Set<string>();

    for (const env of all) {
      if (env.prNumber === undefined) continue;
      const key = `${env.repoOwner}/${env.repoName}#${env.prNumber}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const previousStatus = env.status;
      const result = await poller.pollForPr(
        env.repoOwner,
        env.repoName,
        env.prNumber,
      );

      if (result === undefined) continue;

      const updated = store.findById(result.environmentId);
      if (updated === undefined) continue;

      logStatusChange(activityLog, updated, previousStatus);
      activityLog.append({
        repoOwner: updated.repoOwner,
        repoName: updated.repoName,
        eventType: "check_performed",
      });

      if (onPollResult !== undefined) {
        onPollResult(updated, previousStatus);
      }
    }
  }

  return {
    async onPrCreated(
      repoOwner: string,
      repoName: string,
      prNumber: number,
      taskBranchId: string,
    ): Promise<void> {
      // Look up PR title via gh api
      const { title: prTitle, url: prUrl } = await fetchPrTitle(
        execCommand,
        repoOwner,
        repoName,
        prNumber,
      );

      const now = Date.now();

      // Create or update the RemoteEnvironment record
      const env = store.upsertFromDeployment({
        repoOwner,
        repoName,
        environmentType: "probo",
        prNumber,
        prUrl,
        prTitle,
        deploymentId: undefined,
        environmentUrl: undefined,
        status: "building",
        taskBranchId,
        errorMessage: undefined,
        lastCheckedAt: now,
      });

      // Log the creation event
      activityLog.append({
        repoOwner,
        repoName,
        eventType: "environment_created",
        detail: prTitle !== undefined ? `PR #${prNumber}: ${prTitle}` : `PR #${prNumber}`,
      });

      // Trigger an immediate poll (debounced)
      poller.triggerImmediatePoll(repoOwner, repoName, prNumber);

      // Suppress unused variable lint — env is used for side effect (upsert)
      void env;
    },

    async requestHostedEnvironment(
      repoOwner: string,
      repoName: string,
    ): Promise<RemoteEnvironment> {
      const env = await requestJoyusAiEnvironment(store, repoOwner, repoName);

      activityLog.append({
        repoOwner,
        repoName,
        eventType: "environment_created",
        detail: `joyus-ai hosted environment requested (status: provisioning)`,
      });

      return env;
    },

    listAll(): readonly RemoteEnvironment[] {
      return store.listAll();
    },

    listByRepo(
      repoOwner: string,
      repoName: string,
    ): readonly RemoteEnvironment[] {
      return store.listByRepo(repoOwner, repoName);
    },

    getActivityLog(): ActivityLog {
      return activityLog;
    },

    start(): void {
      if (started) return;
      started = true;
      poller.startPolling();
      void runInitialSync();
    },

    stop(): void {
      if (!started) return;
      started = false;
      poller.stopPolling();
    },
  };
}
