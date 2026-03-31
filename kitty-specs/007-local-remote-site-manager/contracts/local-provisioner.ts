/**
 * Internal API contracts for @joyus/local-provisioner
 *
 * These are TypeScript interfaces — not runtime code.
 * Implementation will live in packages/local-provisioner/src/
 */

// ─── Runtime Detection ──────────────────────────────────────────────────────

export interface RuntimeCheckResult {
  readonly dockerInstalled: boolean;
  readonly dockerRunning: boolean;
  readonly dockerProvider: "docker-desktop" | "orbstack" | undefined;
  readonly dockerVersion: string | undefined;
  readonly socketPath: string | undefined;
  readonly ddevInstalled: boolean;
  readonly ddevVersion: string | undefined;
  readonly ddevDockerPlatform: string | undefined;
  readonly systemCpus: number | undefined;
  readonly systemMemoryBytes: number | undefined;
}

export interface RuntimeDetector {
  /** Probe for Docker and DDEV installations. */
  check(): Promise<RuntimeCheckResult>;

  /** Install OrbStack (preferred) or Docker Desktop. Returns true on success. */
  installContainerRuntime(
    provider: "orbstack" | "docker-desktop",
  ): Promise<boolean>;

  /** Install DDEV via platform package manager. Returns true on success. */
  installDdev(): Promise<boolean>;
}

// ─── Local Site Types ───────────────────────────────────────────────────────

export type LocalSiteStatus = "running" | "stopped" | "starting" | "error";

export interface LocalSite {
  readonly id: string;
  readonly projectName: string;
  readonly repoUrl: string;
  readonly repoPath: string;
  readonly ddevProjectName: string;
  readonly httpUrl: string | undefined;
  readonly httpsUrl: string | undefined;
  readonly status: LocalSiteStatus;
  readonly errorMessage: string | undefined;
  readonly projectType: string | undefined;
  readonly createdAt: number;
  readonly lastActivityAt: number;
}

export interface CreateLocalSiteInput {
  readonly repoUrl: string;
  readonly clonePath?: string;
}

export interface ResourceSnapshot {
  readonly cpuPercent: number;
  readonly memoryUsageBytes: number;
  readonly memoryLimitBytes: number;
}

// ─── Local Site Store ───────────────────────────────────────────────────────

export interface LocalSiteStore {
  create(site: Omit<LocalSite, "id" | "createdAt" | "lastActivityAt">): LocalSite;
  findById(id: string): LocalSite | undefined;
  findByRepoPath(repoPath: string): LocalSite | undefined;
  listAll(): readonly LocalSite[];
  updateStatus(id: string, status: LocalSiteStatus, errorMessage?: string): void;
  updateUrls(id: string, httpUrl: string, httpsUrl: string): void;
  updateActivity(id: string): void;
  softDelete(id: string): void;
  close(): void;
}

// ─── Local Site Manager ─────────────────────────────────────────────────────

export interface LocalSiteManager {
  /** Clone repo + ddev start. Returns the created site. */
  provision(input: CreateLocalSiteInput): Promise<LocalSite>;

  /** Start a stopped site. */
  start(siteId: string): Promise<void>;

  /** Stop a running site. */
  stop(siteId: string): Promise<void>;

  /** Stop + start. */
  restart(siteId: string): Promise<void>;

  /** Stop, destroy DDEV project, optionally delete repo clone. */
  remove(siteId: string, deleteRepo: boolean): Promise<void>;

  /** Get resource usage for a running site's containers. */
  getResourceUsage(siteId: string): Promise<ResourceSnapshot | undefined>;

  /** Refresh status of all sites from DDEV. */
  syncAll(): Promise<void>;

  /** List all managed local sites. */
  listAll(): readonly LocalSite[];
}
