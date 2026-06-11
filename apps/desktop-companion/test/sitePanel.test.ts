import { describe, expect, it, vi } from "vitest";
import { createSitePanel } from "../src/sitePanel";
import type { LocalSiteManager, LocalSite } from "@joyus/local-provisioner";
import type {
  EnvironmentMonitor,
  RemoteEnvironment,
} from "@joyus/environment-monitor";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLocalSite(overrides: Partial<LocalSite> = {}): LocalSite {
  return {
    id: "site-1",
    projectName: "my-drupal-site",
    repoUrl: "https://github.com/zivtech/my-drupal-site.git",
    repoPath: "/home/user/.joyus/sites/my-drupal-site",
    ddevProjectName: "my-drupal-site",
    httpUrl: "http://my-drupal-site.ddev.site",
    httpsUrl: "https://my-drupal-site.ddev.site",
    status: "running",
    errorMessage: undefined,
    projectType: "drupal10",
    createdAt: 1000,
    lastActivityAt: 2000,
    ...overrides,
  };
}

function makeRemoteEnvironment(
  overrides: Partial<RemoteEnvironment> = {},
): RemoteEnvironment {
  return {
    id: "env-1",
    repoOwner: "zivtech",
    repoName: "my-drupal-site",
    environmentType: "probo",
    prNumber: 42,
    prUrl: "https://github.com/zivtech/my-drupal-site/pull/42",
    prTitle: "QA: layout fix",
    deploymentId: 999,
    environmentUrl: "https://pr-42.probo.ci",
    status: "ready",
    taskBranchId: "branch-1",
    errorMessage: undefined,
    lastCheckedAt: 3000,
    createdAt: 1000,
    ...overrides,
  };
}

function makeLocalSiteManager(
  sites: LocalSite[] = [],
): LocalSiteManager {
  return {
    provision: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    remove: vi.fn(),
    getResourceUsage: vi.fn(),
    syncAll: vi.fn(),
    listAll: vi.fn().mockReturnValue(sites),
    close: vi.fn(),
  };
}

function makeEnvironmentMonitor(
  envs: RemoteEnvironment[] = [],
): EnvironmentMonitor {
  return {
    onPrCreated: vi.fn().mockResolvedValue(undefined),
    requestHostedEnvironment: vi.fn(),
    listAll: vi.fn().mockReturnValue(envs),
    listByRepo: vi.fn().mockReturnValue([]),
    getActivityLog: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createSitePanel", () => {
  it("returns local + remote entries for internal users", () => {
    const localSite = makeLocalSite();
    const remoteEnv = makeRemoteEnvironment();
    const panel = createSitePanel({
      localSiteManager: makeLocalSiteManager([localSite]),
      environmentMonitor: makeEnvironmentMonitor([remoteEnv]),
    });

    const entries = panel.listAll("internal");

    expect(entries).toHaveLength(2);
    const local = entries.find((e) => e.type === "local");
    const remote = entries.find((e) => e.type === "remote");
    expect(local?.type).toBe("local");
    expect(remote?.type).toBe("remote");
    if (local?.type === "local") expect(local.site.id).toBe("site-1");
    if (remote?.type === "remote") expect(remote.env.id).toBe("env-1");
  });

  it("returns only remote entries for client users", () => {
    const localSite = makeLocalSite();
    const remoteEnv = makeRemoteEnvironment();
    const panel = createSitePanel({
      localSiteManager: makeLocalSiteManager([localSite]),
      environmentMonitor: makeEnvironmentMonitor([remoteEnv]),
    });

    const entries = panel.listAll("client");

    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe("remote");
  });

  it("returns empty array when there are no sites for client", () => {
    const panel = createSitePanel({
      localSiteManager: makeLocalSiteManager([]),
      environmentMonitor: makeEnvironmentMonitor([]),
    });

    const entries = panel.listAll("client");
    expect(entries).toHaveLength(0);
  });

  it("returns only local entries for internal when no remote envs", () => {
    const localSite = makeLocalSite();
    const panel = createSitePanel({
      localSiteManager: makeLocalSiteManager([localSite]),
      environmentMonitor: makeEnvironmentMonitor([]),
    });

    const entries = panel.listAll("internal");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe("local");
  });

  it("local entries precede remote entries for internal users", () => {
    const localSite = makeLocalSite();
    const remoteEnv = makeRemoteEnvironment();
    const panel = createSitePanel({
      localSiteManager: makeLocalSiteManager([localSite]),
      environmentMonitor: makeEnvironmentMonitor([remoteEnv]),
    });

    const entries = panel.listAll("internal");
    expect(entries[0]?.type).toBe("local");
    expect(entries[1]?.type).toBe("remote");
  });

  it("remote entry exposes env with lastCheckedAt for offline caching", () => {
    const remoteEnv = makeRemoteEnvironment({ lastCheckedAt: 9999 });
    const panel = createSitePanel({
      localSiteManager: makeLocalSiteManager([]),
      environmentMonitor: makeEnvironmentMonitor([remoteEnv]),
    });

    const entries = panel.listAll("client");
    const remote = entries[0];
    expect(remote?.type).toBe("remote");
    if (remote?.type === "remote") {
      expect(remote.env.lastCheckedAt).toBe(9999);
    }
  });
});
