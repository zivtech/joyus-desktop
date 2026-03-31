/**
 * Internal API contracts for @joyus/environment-monitor
 *
 * These are TypeScript interfaces — not runtime code.
 * Implementation will live in packages/environment-monitor/src/
 */

// ─── Remote Environment Types ───────────────────────────────────────────────

export type EnvironmentType = "probo" | "joyus-ai-hosted";
export type RemoteEnvironmentStatus =
  | "building"
  | "ready"
  | "failed"
  | "expired"
  | "provisioning";

export interface RemoteEnvironment {
  readonly id: string;
  readonly repoOwner: string;
  readonly repoName: string;
  readonly environmentType: EnvironmentType;
  readonly prNumber: number | undefined;
  readonly prUrl: string | undefined;
  readonly prTitle: string | undefined;
  readonly deploymentId: number | undefined;
  readonly environmentUrl: string | undefined;
  readonly status: RemoteEnvironmentStatus;
  readonly taskBranchId: string | undefined;
  readonly errorMessage: string | undefined;
  readonly lastCheckedAt: number;
  readonly createdAt: number;
}

// ─── Activity Log Types ─────────────────────────────────────────────────────

export type ActivityEventType =
  | "push"
  | "pr_created"
  | "env_building"
  | "env_ready"
  | "env_failed"
  | "env_expired"
  | "site_started"
  | "site_stopped"
  | "site_error"
  | "runtime_installed"
  | "error";

export interface ActivityLogEntry {
  readonly id: string;
  readonly repoOwner: string | undefined;
  readonly repoName: string | undefined;
  readonly eventType: ActivityEventType;
  readonly description: string;
  readonly metadata: Record<string, unknown> | undefined;
  readonly createdAt: number;
}

// ─── Remote Environment Store ───────────────────────────────────────────────

export interface RemoteEnvironmentStore {
  upsertFromDeployment(env: Omit<RemoteEnvironment, "id" | "createdAt">): RemoteEnvironment;
  findById(id: string): RemoteEnvironment | undefined;
  findByDeploymentId(deploymentId: number): RemoteEnvironment | undefined;
  findByTaskBranchId(taskBranchId: string): RemoteEnvironment | undefined;
  listByRepo(repoOwner: string, repoName: string): readonly RemoteEnvironment[];
  listAll(): readonly RemoteEnvironment[];
  updateStatus(id: string, status: RemoteEnvironmentStatus, environmentUrl?: string): void;
  updateLastChecked(id: string): void;
  softDelete(id: string): void;
  close(): void;
}

// ─── Activity Log ───────────────────────────────────────────────────────────

export interface ActivityLog {
  append(entry: Omit<ActivityLogEntry, "id" | "createdAt">): ActivityLogEntry;
  listRecent(limit: number): readonly ActivityLogEntry[];
  listByRepo(repoOwner: string, repoName: string, limit: number): readonly ActivityLogEntry[];
  pruneOlderThan(cutoffMs: number): number;
  close(): void;
}

// ─── Probo Detection ────────────────────────────────────────────────────────

export interface ProboDetector {
  /** Check if a repository has Probo enabled by looking for .probo.yaml. */
  hasProbo(repoPath: string): boolean;
}

// ─── Deployment Status Poller ───────────────────────────────────────────────

export interface DeploymentStatusResult {
  readonly deploymentId: number;
  readonly state: string;
  readonly environmentUrl: string | undefined;
  readonly environment: string;
  readonly description: string | undefined;
}

export interface DeploymentStatusPoller {
  /**
   * Query GitHub for deployments associated with a PR's head SHA.
   * Uses `gh api` CLI under the hood.
   */
  pollForPr(
    repoOwner: string,
    repoName: string,
    prNumber: number,
  ): Promise<readonly DeploymentStatusResult[]>;

  /** Start background polling loop (60s interval). */
  startPolling(): void;

  /** Stop background polling loop. */
  stopPolling(): void;

  /** Trigger an immediate poll (event-driven, e.g., after push/PR creation). */
  triggerImmediatePoll(repoOwner: string, repoName: string, prNumber: number): Promise<void>;
}

// ─── Environment Monitor (orchestrator) ─────────────────────────────────────

export interface EnvironmentMonitor {
  /** Handle a push+PR event from Feature 006. Triggers immediate poll. */
  onPrCreated(repoOwner: string, repoName: string, prNumber: number, taskBranchId: string): Promise<void>;

  /** Request a joyus-ai hosted environment for a project. */
  requestHostedEnvironment(repoOwner: string, repoName: string): Promise<RemoteEnvironment>;

  /** List all remote environments (Probo + joyus-ai hosted). */
  listAll(): readonly RemoteEnvironment[];

  /** List environments for a specific repo. */
  listByRepo(repoOwner: string, repoName: string): readonly RemoteEnvironment[];

  /** Get the activity log. */
  getActivityLog(): ActivityLog;

  /** Start background polling. */
  start(): void;

  /** Stop background polling. */
  stop(): void;
}

// ─── Project Discovery ──────────────────────────────────────────────────────

export interface DiscoveredProject {
  readonly repoUrl: string;
  readonly repoOwner: string;
  readonly repoName: string;
  readonly source: "github-org" | "admin-curated" | "manual";
  readonly hasProbo: boolean | undefined;
  readonly hasDdev: boolean | undefined;
}

export interface ProjectDiscovery {
  /** Discover projects from all sources, deduplicated by repo URL. */
  discoverAll(): Promise<readonly DiscoveredProject[]>;

  /** Discover from GitHub org only. */
  discoverFromGitHubOrg(orgName: string): Promise<readonly DiscoveredProject[]>;

  /** Add a manual project by URL. */
  addManual(repoUrl: string): DiscoveredProject;
}

// ─── User Identity ──────────────────────────────────────────────────────────

export type UserType = "internal" | "client";

export interface UserIdentity {
  /** Determine user type from GitHub org membership or Google domain. */
  getUserType(): Promise<UserType>;
}
