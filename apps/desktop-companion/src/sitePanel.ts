import type { LocalSite, LocalSiteManager } from "@joyus/local-provisioner";
import type {
  EnvironmentMonitor,
  RemoteEnvironment,
  UserType,
} from "@joyus/environment-monitor";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LocalSiteEntry {
  readonly type: "local";
  readonly site: LocalSite;
}

export interface RemoteSiteEntry {
  readonly type: "remote";
  readonly env: RemoteEnvironment;
}

/** A unified view-model entry shown in the site manager panel. */
export type SiteEntry = LocalSiteEntry | RemoteSiteEntry;

export interface SitePanel {
  /**
   * List all site entries for the given user type.
   * - internal users: local sites + remote environments
   * - client users: remote environments only
   */
  listAll(userType: UserType): readonly SiteEntry[];
}

export interface SitePanelDeps {
  readonly localSiteManager: LocalSiteManager;
  readonly environmentMonitor: EnvironmentMonitor;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createSitePanel(deps: SitePanelDeps): SitePanel {
  const { localSiteManager, environmentMonitor } = deps;

  return {
    listAll(userType: UserType): readonly SiteEntry[] {
      const remoteEntries: RemoteSiteEntry[] = environmentMonitor
        .listAll()
        .map((env) => ({ type: "remote" as const, env }));

      if (userType === "client") {
        return remoteEntries;
      }

      const localEntries: LocalSiteEntry[] = localSiteManager
        .listAll()
        .map((site) => ({ type: "local" as const, site }));

      return [...localEntries, ...remoteEntries];
    },
  };
}
