import type { RemoteEnvironmentStatus } from "./remoteEnvironmentStore.js";
import type { RemoteEnvironmentStore } from "./remoteEnvironmentStore.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExecCommand = (
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>;

export interface DeploymentStatusPollerDeps {
  readonly execCommand: ExecCommand;
  readonly store: RemoteEnvironmentStore;
  readonly pollIntervalMs?: number;
  readonly debounceMs?: number;
}

export interface PollResult {
  readonly environmentId: string;
  readonly deploymentId: number | undefined;
  readonly status: RemoteEnvironmentStatus;
  readonly environmentUrl: string | undefined;
  readonly rateLimited: boolean;
}

export interface DeploymentStatusPoller {
  /** Poll GitHub deployment status for a single PR in a repository. */
  pollForPr(
    repoOwner: string,
    repoName: string,
    prNumber: number,
  ): Promise<PollResult | undefined>;

  /** Start the background 60-second polling loop for all tracked environments. */
  startPolling(): void;

  /** Stop the background polling loop. */
  stopPolling(): void;

  /** Trigger an immediate poll (debounced) for a specific PR. */
  triggerImmediatePoll(
    repoOwner: string,
    repoName: string,
    prNumber: number,
  ): void;
}

// ─── GitHub API types ─────────────────────────────────────────────────────────

interface GhPrViewJson {
  headRefOid?: string;
}

interface GhDeployment {
  id: number;
  sha: string;
  environment?: string;
  task?: string;
  statuses_url?: string;
}

interface GhDeploymentStatus {
  state: string;
  environment_url?: string | null;
  log_url?: string | null;
}

// ─── State Mapping ────────────────────────────────────────────────────────────

const GITHUB_STATE_MAP: Record<string, RemoteEnvironmentStatus> = {
  pending: "building",
  queued: "building",
  in_progress: "building",
  waiting: "building",
  success: "ready",
  failure: "failed",
  error: "failed",
  inactive: "expired",
  abandoned: "expired",
};

export function mapGitHubStateToStatus(
  state: string,
): RemoteEnvironmentStatus {
  return GITHUB_STATE_MAP[state.toLowerCase()] ?? "building";
}

// ─── gh CLI helpers ───────────────────────────────────────────────────────────

interface RateLimitError {
  readonly rateLimited: true;
}

type ExecResult =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly rateLimited: boolean };

async function runGh(
  execCommand: ExecCommand,
  args: readonly string[],
): Promise<ExecResult> {
  try {
    const { stdout } = await execCommand(args);
    return { ok: true, stdout };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : String(err);
    // GitHub rate limit surfaces as exit code 1 with "403" or "rate limit" in message
    const rateLimited =
      message.includes("403") ||
      message.toLowerCase().includes("rate limit") ||
      message.toLowerCase().includes("rate_limit");
    return { ok: false, rateLimited };
  }
}

async function getPrHeadSha(
  execCommand: ExecCommand,
  repoOwner: string,
  repoName: string,
  prNumber: number,
): Promise<string | undefined | RateLimitError> {
  const result = await runGh(execCommand, [
    "gh",
    "pr",
    "view",
    String(prNumber),
    "--repo",
    `${repoOwner}/${repoName}`,
    "--json",
    "headRefOid",
  ]);

  if (!result.ok) {
    if (result.rateLimited) return { rateLimited: true };
    return undefined;
  }

  try {
    const parsed = JSON.parse(result.stdout) as GhPrViewJson;
    return parsed.headRefOid;
  } catch {
    return undefined;
  }
}

async function getDeploymentsBySha(
  execCommand: ExecCommand,
  repoOwner: string,
  repoName: string,
  sha: string,
): Promise<GhDeployment[] | RateLimitError> {
  const result = await runGh(execCommand, [
    "gh",
    "api",
    `repos/${repoOwner}/${repoName}/deployments?sha=${sha}&per_page=20`,
  ]);

  if (!result.ok) {
    if (result.rateLimited) return { rateLimited: true };
    return [];
  }

  try {
    return JSON.parse(result.stdout) as GhDeployment[];
  } catch {
    return [];
  }
}

async function getDeploymentStatuses(
  execCommand: ExecCommand,
  repoOwner: string,
  repoName: string,
  deploymentId: number,
): Promise<GhDeploymentStatus[] | RateLimitError> {
  const result = await runGh(execCommand, [
    "gh",
    "api",
    `repos/${repoOwner}/${repoName}/deployments/${deploymentId}/statuses?per_page=10`,
  ]);

  if (!result.ok) {
    if (result.rateLimited) return { rateLimited: true };
    return [];
  }

  try {
    return JSON.parse(result.stdout) as GhDeploymentStatus[];
  } catch {
    return [];
  }
}

function isRateLimitError(v: unknown): v is RateLimitError {
  return typeof v === "object" && v !== null && "rateLimited" in v;
}

// ─── Core poll logic ──────────────────────────────────────────────────────────

async function doPollForPr(
  execCommand: ExecCommand,
  store: RemoteEnvironmentStore,
  repoOwner: string,
  repoName: string,
  prNumber: number,
): Promise<PollResult | undefined> {
  // 1. Get PR head SHA
  const shaResult = await getPrHeadSha(
    execCommand,
    repoOwner,
    repoName,
    prNumber,
  );

  if (isRateLimitError(shaResult)) {
    // Rate limited — update all environments for this PR to last-known status
    const envs = store.listByRepo(repoOwner, repoName).filter(
      (e) => e.prNumber === prNumber,
    );
    for (const env of envs) {
      store.updateLastChecked(env.id);
    }
    const first = envs[0];
    if (first !== undefined) {
      return {
        environmentId: first.id,
        deploymentId: first.deploymentId,
        status: first.status,
        environmentUrl: first.environmentUrl,
        rateLimited: true,
      };
    }
    return undefined;
  }

  if (shaResult === undefined || shaResult === "") {
    return undefined;
  }

  // 2. Query deployments by SHA
  const deploymentsResult = await getDeploymentsBySha(
    execCommand,
    repoOwner,
    repoName,
    shaResult,
  );

  if (isRateLimitError(deploymentsResult)) {
    const envs = store.listByRepo(repoOwner, repoName).filter(
      (e) => e.prNumber === prNumber,
    );
    for (const env of envs) {
      store.updateLastChecked(env.id);
    }
    const first = envs[0];
    if (first !== undefined) {
      return {
        environmentId: first.id,
        deploymentId: first.deploymentId,
        status: first.status,
        environmentUrl: first.environmentUrl,
        rateLimited: true,
      };
    }
    return undefined;
  }

  if (deploymentsResult.length === 0) {
    return undefined;
  }

  // Use the most recent deployment (first in array — GitHub returns newest first)
  const deployment = deploymentsResult[0];
  if (deployment === undefined) return undefined;

  // 3. Query deployment statuses
  const statusesResult = await getDeploymentStatuses(
    execCommand,
    repoOwner,
    repoName,
    deployment.id,
  );

  if (isRateLimitError(statusesResult)) {
    const existing = store.findByDeploymentId(deployment.id);
    if (existing !== undefined) {
      store.updateLastChecked(existing.id);
      return {
        environmentId: existing.id,
        deploymentId: existing.deploymentId,
        status: existing.status,
        environmentUrl: existing.environmentUrl,
        rateLimited: true,
      };
    }
    return undefined;
  }

  // GitHub returns statuses newest first; use the first one
  const latestStatus = statusesResult[0];
  const mappedStatus = latestStatus !== undefined
    ? mapGitHubStateToStatus(latestStatus.state)
    : "building";
  const environmentUrl =
    latestStatus?.environment_url ?? undefined;

  // 4. Upsert into store — find existing PR env or upsert by deploymentId
  const existing = store.findByDeploymentId(deployment.id);

  let environmentId: string;
  if (existing !== undefined) {
    store.updateStatus(existing.id, mappedStatus, environmentUrl);
    store.updateLastChecked(existing.id);
    environmentId = existing.id;
  } else {
    // Look up existing env for this PR (may have been created without deploymentId)
    const prEnvs = store.listByRepo(repoOwner, repoName).filter(
      (e) => e.prNumber === prNumber,
    );
    if (prEnvs.length > 0 && prEnvs[0] !== undefined) {
      const prEnv = prEnvs[0];
      store.updateStatus(prEnv.id, mappedStatus, environmentUrl);
      store.updateLastChecked(prEnv.id);
      environmentId = prEnv.id;
    } else {
      const upserted = store.upsertFromDeployment({
        repoOwner,
        repoName,
        environmentType: "probo",
        prNumber,
        prUrl: undefined,
        prTitle: undefined,
        deploymentId: deployment.id,
        environmentUrl,
        status: mappedStatus,
        taskBranchId: undefined,
        errorMessage: undefined,
        lastCheckedAt: Date.now(),
      });
      environmentId = upserted.id;
    }
  }

  return {
    environmentId,
    deploymentId: deployment.id,
    status: mappedStatus,
    environmentUrl,
    rateLimited: false,
  };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_DEBOUNCE_MS = 500;

export function createDeploymentStatusPoller(
  deps: DeploymentStatusPollerDeps,
): DeploymentStatusPoller {
  const {
    execCommand,
    store,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    debounceMs = DEFAULT_DEBOUNCE_MS,
  } = deps;

  let intervalHandle: ReturnType<typeof setInterval> | undefined;
  const debounceHandles = new Map<string, ReturnType<typeof setTimeout>>();

  function makeDebounceKey(
    repoOwner: string,
    repoName: string,
    prNumber: number,
  ): string {
    return `${repoOwner}/${repoName}#${prNumber}`;
  }

  async function pollAllEnvironments(): Promise<void> {
    const allEnvs = store.listAll();
    // Group unique (repoOwner, repoName, prNumber) combos to avoid redundant calls
    const seen = new Set<string>();
    for (const env of allEnvs) {
      if (env.prNumber === undefined) continue;
      const key = makeDebounceKey(env.repoOwner, env.repoName, env.prNumber);
      if (seen.has(key)) continue;
      seen.add(key);
      await doPollForPr(
        execCommand,
        store,
        env.repoOwner,
        env.repoName,
        env.prNumber,
      );
    }
  }

  return {
    async pollForPr(
      repoOwner: string,
      repoName: string,
      prNumber: number,
    ): Promise<PollResult | undefined> {
      return doPollForPr(execCommand, store, repoOwner, repoName, prNumber);
    },

    startPolling(): void {
      if (intervalHandle !== undefined) return;
      intervalHandle = setInterval(() => {
        void pollAllEnvironments();
      }, pollIntervalMs);
    },

    stopPolling(): void {
      if (intervalHandle !== undefined) {
        clearInterval(intervalHandle);
        intervalHandle = undefined;
      }
      for (const handle of debounceHandles.values()) {
        clearTimeout(handle);
      }
      debounceHandles.clear();
    },

    triggerImmediatePoll(
      repoOwner: string,
      repoName: string,
      prNumber: number,
    ): void {
      const key = makeDebounceKey(repoOwner, repoName, prNumber);
      const existing = debounceHandles.get(key);
      if (existing !== undefined) {
        clearTimeout(existing);
      }
      const handle = setTimeout(() => {
        debounceHandles.delete(key);
        void doPollForPr(execCommand, store, repoOwner, repoName, prNumber);
      }, debounceMs);
      debounceHandles.set(key, handle);
    },
  };
}
