import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";

import type { DdevCli, ResourceSnapshot } from "./ddevCli.js";
import type { ExecCommand } from "./runtimeDetector.js";
import {
  openLocalSiteStore,
  type LocalSite,
  type LocalSiteStore,
} from "./localSiteStore.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CreateLocalSiteInput {
  readonly repoUrl: string;
  readonly clonePath?: string;
}

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

  /** Close the underlying store. */
  close(): void;
}

export interface LocalSiteManagerDeps {
  readonly ddevCli: DdevCli;
  readonly execCommand: ExecCommand;
  readonly store?: LocalSiteStore;
  readonly dbPath?: string;
  readonly defaultCloneBase?: string;
  readonly readFileFn?: (path: string) => string;
  readonly rmDirFn?: (path: string) => Promise<void>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the project name from a .ddev/config.yaml file using a simple
 * line scan — no YAML parser dependency required.
 * Returns undefined if the file cannot be read or the field is not found.
 */
export function extractDdevProjectName(
  configYaml: string,
): string | undefined {
  for (const line of configYaml.split("\n")) {
    const match = /^name:\s*(.+)$/.exec(line.trim());
    if (match !== null) {
      return match[1]!.trim();
    }
  }
  return undefined;
}

/**
 * Derive a human-readable project name from a git URL.
 * Strips the trailing `.git`, takes the last path segment.
 */
function projectNameFromUrl(repoUrl: string): string {
  const last = repoUrl.split("/").pop() ?? repoUrl;
  return last.endsWith(".git") ? last.slice(0, -4) : last;
}

function requireSite(
  store: LocalSiteStore,
  siteId: string,
): LocalSite {
  const site = store.findById(siteId);
  if (site === undefined) {
    throw new Error(`Site not found: ${siteId}`);
  }
  return site;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createLocalSiteManager(
  deps: LocalSiteManagerDeps,
): LocalSiteManager {
  const {
    ddevCli,
    execCommand,
    defaultCloneBase = join(homedir(), ".joyus", "sites"),
  } = deps;

  const store =
    deps.store ?? openLocalSiteStore(deps.dbPath);

  const readFileFn: (path: string) => string =
    deps.readFileFn ?? ((p) => readFileSync(p, "utf8"));

  const rmDirFn: (path: string) => Promise<void> =
    deps.rmDirFn ?? ((p) => rm(p, { recursive: true, force: true }));

  return {
    async provision(input: CreateLocalSiteInput): Promise<LocalSite> {
      const { repoUrl } = input;
      const projectName = projectNameFromUrl(repoUrl);
      const cloneBase = input.clonePath ?? defaultCloneBase;
      const repoPath = join(cloneBase, projectName);

      // Clone the repository
      await execCommand(["git", "clone", repoUrl, repoPath]);

      // Read .ddev/config.yaml to get ddev project name
      const configPath = join(repoPath, ".ddev", "config.yaml");
      let ddevProjectName: string;
      try {
        const configContent = readFileFn(configPath);
        ddevProjectName = extractDdevProjectName(configContent) ?? projectName;
      } catch {
        ddevProjectName = projectName;
      }

      // Persist the site as "starting"
      const site = store.create({
        projectName,
        repoUrl,
        repoPath,
        ddevProjectName,
        httpUrl: undefined,
        httpsUrl: undefined,
        status: "starting",
        errorMessage: undefined,
        projectType: undefined,
      });

      // Start DDEV
      try {
        await ddevCli.start(ddevProjectName, repoPath);
        const info = await ddevCli.describe(ddevProjectName, repoPath);

        store.updateStatus(site.id, "running");
        if (info.httpUrl !== undefined && info.httpsUrl !== undefined) {
          store.updateUrls(site.id, info.httpUrl, info.httpsUrl);
        }
        store.updateActivity(site.id);

        // Return the updated site
        return store.findById(site.id) ?? site;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Unknown error during ddev start";
        store.updateStatus(site.id, "error", message);
        throw err;
      }
    },

    async start(siteId: string): Promise<void> {
      const site = requireSite(store, siteId);
      store.updateStatus(siteId, "starting");
      try {
        await ddevCli.start(site.ddevProjectName, site.repoPath);
        const info = await ddevCli.describe(site.ddevProjectName, site.repoPath);
        store.updateStatus(siteId, "running");
        if (info.httpUrl !== undefined && info.httpsUrl !== undefined) {
          store.updateUrls(siteId, info.httpUrl, info.httpsUrl);
        }
        store.updateActivity(siteId);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Unknown error during ddev start";
        store.updateStatus(siteId, "error", message);
        throw err;
      }
    },

    async stop(siteId: string): Promise<void> {
      const site = requireSite(store, siteId);
      try {
        await ddevCli.stop(site.ddevProjectName, site.repoPath);
        store.updateStatus(siteId, "stopped");
        store.updateActivity(siteId);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Unknown error during ddev stop";
        store.updateStatus(siteId, "error", message);
        throw err;
      }
    },

    async restart(siteId: string): Promise<void> {
      const site = requireSite(store, siteId);
      store.updateStatus(siteId, "starting");
      try {
        await ddevCli.restart(site.ddevProjectName, site.repoPath);
        const info = await ddevCli.describe(site.ddevProjectName, site.repoPath);
        store.updateStatus(siteId, "running");
        if (info.httpUrl !== undefined && info.httpsUrl !== undefined) {
          store.updateUrls(siteId, info.httpUrl, info.httpsUrl);
        }
        store.updateActivity(siteId);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Unknown error during ddev restart";
        store.updateStatus(siteId, "error", message);
        throw err;
      }
    },

    async remove(siteId: string, deleteRepo: boolean): Promise<void> {
      const site = requireSite(store, siteId);
      try {
        await ddevCli.delete(site.ddevProjectName, site.repoPath);
      } catch {
        // Best-effort: continue with cleanup even if ddev delete fails
      }
      if (deleteRepo) {
        await rmDirFn(site.repoPath);
      }
      store.softDelete(siteId);
    },

    async getResourceUsage(
      siteId: string,
    ): Promise<ResourceSnapshot | undefined> {
      const site = requireSite(store, siteId);
      return ddevCli.resourceSnapshot(site.ddevProjectName);
    },

    async syncAll(): Promise<void> {
      const sites = store.listAll();
      const ddevSites = await ddevCli.list();

      const statusByName = new Map<string, string>();
      for (const ds of ddevSites) {
        statusByName.set(ds.name, ds.status);
      }

      for (const site of sites) {
        const ddevStatus = statusByName.get(site.ddevProjectName);
        if (ddevStatus === undefined) {
          // Not in ddev list — treat as stopped
          if (site.status !== "stopped") {
            store.updateStatus(site.id, "stopped");
          }
          continue;
        }

        let newStatus: "running" | "stopped" | "starting" | "error";
        if (ddevStatus === "running") {
          newStatus = "running";
        } else if (ddevStatus === "starting") {
          newStatus = "starting";
        } else {
          newStatus = "stopped";
        }

        if (newStatus !== site.status) {
          store.updateStatus(site.id, newStatus);
        }
      }
    },

    listAll(): readonly LocalSite[] {
      return store.listAll();
    },

    close(): void {
      store.close();
    },
  };
}
