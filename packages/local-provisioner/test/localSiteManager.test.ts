import { describe, it, expect, vi } from "vitest";

import {
  createLocalSiteManager,
  extractDdevProjectName,
} from "../src/localSiteManager.js";
import type { LocalSiteManagerDeps } from "../src/localSiteManager.js";
import type { DdevCli, DdevEnvelope, DdevProjectInfo } from "../src/ddevCli.js";
import type { ExecCommand } from "../src/runtimeDetector.js";
import type { LocalSite, LocalSiteStore } from "../src/localSiteStore.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEnvelope(msg = "ok"): DdevEnvelope {
  return { msg, level: "info", raw: null };
}

function makeProjectInfo(overrides: Partial<DdevProjectInfo> = {}): DdevProjectInfo {
  return {
    name: "mysite",
    status: "running",
    httpUrl: "http://mysite.ddev.site",
    httpsUrl: "https://mysite.ddev.site",
    type: "drupal10",
    location: "/path/to/mysite",
    ...overrides,
  };
}

function makeSite(overrides: Partial<LocalSite> = {}): LocalSite {
  return {
    id: "site-id-1",
    projectName: "mysite",
    repoUrl: "https://github.com/org/mysite.git",
    repoPath: "/path/to/mysite",
    ddevProjectName: "mysite",
    httpUrl: undefined,
    httpsUrl: undefined,
    status: "stopped",
    errorMessage: undefined,
    projectType: undefined,
    createdAt: 1000,
    lastActivityAt: 1000,
    ...overrides,
  };
}

function makeMockStore(overrides: Partial<LocalSiteStore> = {}): LocalSiteStore {
  const sites: LocalSite[] = [];
  return {
    create: vi.fn().mockImplementation((input) => {
      const site: LocalSite = {
        id: "site-id-1",
        projectName: input.projectName,
        repoUrl: input.repoUrl,
        repoPath: input.repoPath,
        ddevProjectName: input.ddevProjectName,
        httpUrl: input.httpUrl,
        httpsUrl: input.httpsUrl,
        status: input.status,
        errorMessage: input.errorMessage,
        projectType: input.projectType,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      };
      sites.push(site);
      return site;
    }),
    findById: vi.fn().mockImplementation((id: string) =>
      sites.find((s) => s.id === id),
    ),
    findByRepoPath: vi.fn().mockReturnValue(undefined),
    listAll: vi.fn().mockImplementation(() => [...sites]),
    updateStatus: vi.fn().mockImplementation((id: string, status: LocalSite["status"], errorMessage?: string) => {
      const site = sites.find((s) => s.id === id);
      if (site !== undefined) {
        Object.assign(site, { status, errorMessage });
      }
    }),
    updateUrls: vi.fn(),
    updateActivity: vi.fn(),
    softDelete: vi.fn().mockImplementation((id: string) => {
      const idx = sites.findIndex((s) => s.id === id);
      if (idx !== -1) sites.splice(idx, 1);
    }),
    close: vi.fn(),
    ...overrides,
  };
}

function makeMockDdevCli(overrides: Partial<DdevCli> = {}): DdevCli {
  return {
    start: vi.fn().mockResolvedValue(makeEnvelope()),
    stop: vi.fn().mockResolvedValue(makeEnvelope()),
    restart: vi.fn().mockResolvedValue(makeEnvelope()),
    delete: vi.fn().mockResolvedValue(makeEnvelope()),
    describe: vi.fn().mockResolvedValue(makeProjectInfo()),
    list: vi.fn().mockResolvedValue([]),
    version: vi.fn().mockResolvedValue(makeEnvelope()),
    resourceSnapshot: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeExecCommand(
  responses: Record<string, { stdout: string; stderr: string } | Error> = {},
): ExecCommand {
  return vi.fn().mockImplementation((args: readonly string[]) => {
    const key = args.join(" ");
    const r = responses[key];
    if (r instanceof Error) return Promise.reject(r);
    if (r !== undefined) return Promise.resolve(r);
    return Promise.resolve({ stdout: "", stderr: "" });
  });
}

function makeDeps(overrides: Partial<LocalSiteManagerDeps> = {}): LocalSiteManagerDeps & {
  store: LocalSiteStore;
  ddevCli: DdevCli;
  execCommand: ExecCommand;
} {
  const store = makeMockStore();
  const ddevCli = makeMockDdevCli();
  const execCommand = makeExecCommand();
  return {
    store,
    ddevCli,
    execCommand,
    readFileFn: vi.fn().mockReturnValue("name: mysite\ntype: drupal10\n"),
    rmDirFn: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ─── extractDdevProjectName ───────────────────────────────────────────────────

describe("extractDdevProjectName", () => {
  it("extracts name from simple config", () => {
    expect(extractDdevProjectName("name: mysite\ntype: drupal10\n")).toBe("mysite");
  });

  it("extracts name with extra whitespace", () => {
    expect(extractDdevProjectName("  name:   myproject  \n")).toBe("myproject");
  });

  it("returns undefined when name field is missing", () => {
    expect(extractDdevProjectName("type: drupal10\ndocroot: web\n")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(extractDdevProjectName("")).toBeUndefined();
  });

  it("handles name as first line", () => {
    expect(extractDdevProjectName("name: first-project")).toBe("first-project");
  });

  it("handles name with hyphens", () => {
    expect(extractDdevProjectName("name: my-drupal-site\n")).toBe("my-drupal-site");
  });
});

// ─── createLocalSiteManager ───────────────────────────────────────────────────

describe("createLocalSiteManager", () => {
  // ── provision ────────────────────────────────────────────────────────────

  describe("provision", () => {
    it("clones repo, starts ddev, persists site, returns updated site", async () => {
      const deps = makeDeps();
      const manager = createLocalSiteManager(deps);

      const site = await manager.provision({
        repoUrl: "https://github.com/org/mysite.git",
        clonePath: "/clones",
      });

      expect(deps.execCommand).toHaveBeenCalledWith(
        ["git", "clone", "https://github.com/org/mysite.git", "/clones/mysite"],
      );
      expect(deps.ddevCli.start).toHaveBeenCalledWith("mysite", "/clones/mysite");
      expect(deps.ddevCli.describe).toHaveBeenCalledWith("mysite", "/clones/mysite");
      expect(deps.store.create).toHaveBeenCalledWith(
        expect.objectContaining({
          repoUrl: "https://github.com/org/mysite.git",
          repoPath: "/clones/mysite",
          status: "starting",
        }),
      );
      expect(deps.store.updateStatus).toHaveBeenCalledWith("site-id-1", "running");
      expect(deps.store.updateUrls).toHaveBeenCalledWith(
        "site-id-1",
        "http://mysite.ddev.site",
        "https://mysite.ddev.site",
      );
      expect(site.status).toBe("running");
    });

    it("reads ddev project name from .ddev/config.yaml", async () => {
      const readFileFn = vi.fn().mockReturnValue("name: custom-project\n");
      const deps = makeDeps({ readFileFn });
      const manager = createLocalSiteManager(deps);

      await manager.provision({
        repoUrl: "https://github.com/org/mysite.git",
        clonePath: "/clones",
      });

      expect(deps.store.create).toHaveBeenCalledWith(
        expect.objectContaining({ ddevProjectName: "custom-project" }),
      );
      expect(deps.ddevCli.start).toHaveBeenCalledWith("custom-project", "/clones/mysite");
    });

    it("falls back to repo name when .ddev/config.yaml cannot be read", async () => {
      const readFileFn = vi.fn().mockImplementation(() => {
        throw new Error("ENOENT");
      });
      const deps = makeDeps({ readFileFn });
      const manager = createLocalSiteManager(deps);

      await manager.provision({
        repoUrl: "https://github.com/org/mysite.git",
        clonePath: "/clones",
      });

      expect(deps.store.create).toHaveBeenCalledWith(
        expect.objectContaining({ ddevProjectName: "mysite" }),
      );
    });

    it("falls back to repo name when config.yaml has no name field", async () => {
      const readFileFn = vi.fn().mockReturnValue("type: drupal10\n");
      const deps = makeDeps({ readFileFn });
      const manager = createLocalSiteManager(deps);

      await manager.provision({
        repoUrl: "https://github.com/org/mysite.git",
        clonePath: "/clones",
      });

      expect(deps.store.create).toHaveBeenCalledWith(
        expect.objectContaining({ ddevProjectName: "mysite" }),
      );
    });

    it("strips .git suffix from repo URL when deriving project name", async () => {
      const deps = makeDeps();
      const manager = createLocalSiteManager(deps);

      await manager.provision({
        repoUrl: "https://github.com/org/no-git-suffix",
        clonePath: "/clones",
      });

      expect(deps.store.create).toHaveBeenCalledWith(
        expect.objectContaining({ projectName: "no-git-suffix" }),
      );
    });

    it("sets status to error and rethrows when ddev start fails", async () => {
      const startError = new Error("Docker not running");
      const deps = makeDeps({
        ddevCli: makeMockDdevCli({
          start: vi.fn().mockRejectedValue(startError),
        }),
      });
      const manager = createLocalSiteManager(deps);

      await expect(
        manager.provision({
          repoUrl: "https://github.com/org/mysite.git",
          clonePath: "/clones",
        }),
      ).rejects.toThrow("Docker not running");

      expect(deps.store.updateStatus).toHaveBeenCalledWith(
        "site-id-1",
        "error",
        "Docker not running",
      );
    });

    it("does not update URLs when describe returns undefined URLs", async () => {
      const deps = makeDeps({
        ddevCli: makeMockDdevCli({
          describe: vi.fn().mockResolvedValue(
            makeProjectInfo({ httpUrl: undefined, httpsUrl: undefined }),
          ),
        }),
      });
      const manager = createLocalSiteManager(deps);

      await manager.provision({
        repoUrl: "https://github.com/org/mysite.git",
        clonePath: "/clones",
      });

      expect(deps.store.updateUrls).not.toHaveBeenCalled();
    });

    it("uses default clone base when clonePath not provided", async () => {
      const deps = makeDeps({ defaultCloneBase: "/default/base" });
      const manager = createLocalSiteManager(deps);

      await manager.provision({ repoUrl: "https://github.com/org/repo.git" });

      expect(deps.execCommand).toHaveBeenCalledWith(
        ["git", "clone", "https://github.com/org/repo.git", "/default/base/repo"],
      );
    });
  });

  // ── start ─────────────────────────────────────────────────────────────────

  describe("start", () => {
    it("calls ddev start and updates status to running", async () => {
      const site = makeSite({ status: "stopped" });
      const store = makeMockStore({
        findById: vi.fn().mockReturnValue(site),
      });
      const deps = makeDeps({ store });
      const manager = createLocalSiteManager(deps);

      await manager.start("site-id-1");

      expect(deps.ddevCli.start).toHaveBeenCalledWith("mysite", "/path/to/mysite");
      expect(store.updateStatus).toHaveBeenCalledWith("site-id-1", "starting");
      expect(store.updateStatus).toHaveBeenCalledWith("site-id-1", "running");
      expect(store.updateUrls).toHaveBeenCalledWith(
        "site-id-1",
        "http://mysite.ddev.site",
        "https://mysite.ddev.site",
      );
      expect(store.updateActivity).toHaveBeenCalledWith("site-id-1");
    });

    it("throws when site not found", async () => {
      const store = makeMockStore({
        findById: vi.fn().mockReturnValue(undefined),
      });
      const deps = makeDeps({ store });
      const manager = createLocalSiteManager(deps);

      await expect(manager.start("nonexistent")).rejects.toThrow("Site not found: nonexistent");
    });

    it("sets status to error and rethrows when ddev start fails", async () => {
      const site = makeSite();
      const store = makeMockStore({
        findById: vi.fn().mockReturnValue(site),
      });
      const startError = new Error("port conflict");
      const deps = makeDeps({
        store,
        ddevCli: makeMockDdevCli({
          start: vi.fn().mockRejectedValue(startError),
        }),
      });
      const manager = createLocalSiteManager(deps);

      await expect(manager.start("site-id-1")).rejects.toThrow("port conflict");
      expect(store.updateStatus).toHaveBeenCalledWith("site-id-1", "error", "port conflict");
    });

    it("does not update URLs when describe returns undefined URLs", async () => {
      const site = makeSite();
      const store = makeMockStore({ findById: vi.fn().mockReturnValue(site) });
      const deps = makeDeps({
        store,
        ddevCli: makeMockDdevCli({
          describe: vi.fn().mockResolvedValue(
            makeProjectInfo({ httpUrl: undefined, httpsUrl: undefined }),
          ),
        }),
      });
      const manager = createLocalSiteManager(deps);

      await manager.start("site-id-1");

      expect(store.updateUrls).not.toHaveBeenCalled();
    });
  });

  // ── stop ──────────────────────────────────────────────────────────────────

  describe("stop", () => {
    it("calls ddev stop and updates status to stopped", async () => {
      const site = makeSite({ status: "running" });
      const store = makeMockStore({ findById: vi.fn().mockReturnValue(site) });
      const deps = makeDeps({ store });
      const manager = createLocalSiteManager(deps);

      await manager.stop("site-id-1");

      expect(deps.ddevCli.stop).toHaveBeenCalledWith("mysite", "/path/to/mysite");
      expect(store.updateStatus).toHaveBeenCalledWith("site-id-1", "stopped");
      expect(store.updateActivity).toHaveBeenCalledWith("site-id-1");
    });

    it("throws when site not found", async () => {
      const store = makeMockStore({ findById: vi.fn().mockReturnValue(undefined) });
      const deps = makeDeps({ store });
      const manager = createLocalSiteManager(deps);

      await expect(manager.stop("nonexistent")).rejects.toThrow("Site not found: nonexistent");
    });

    it("sets status to error and rethrows when ddev stop fails", async () => {
      const site = makeSite({ status: "running" });
      const store = makeMockStore({ findById: vi.fn().mockReturnValue(site) });
      const stopError = new Error("docker error");
      const deps = makeDeps({
        store,
        ddevCli: makeMockDdevCli({
          stop: vi.fn().mockRejectedValue(stopError),
        }),
      });
      const manager = createLocalSiteManager(deps);

      await expect(manager.stop("site-id-1")).rejects.toThrow("docker error");
      expect(store.updateStatus).toHaveBeenCalledWith("site-id-1", "error", "docker error");
    });
  });

  // ── restart ───────────────────────────────────────────────────────────────

  describe("restart", () => {
    it("calls ddev restart and updates status to running", async () => {
      const site = makeSite({ status: "running" });
      const store = makeMockStore({ findById: vi.fn().mockReturnValue(site) });
      const deps = makeDeps({ store });
      const manager = createLocalSiteManager(deps);

      await manager.restart("site-id-1");

      expect(deps.ddevCli.restart).toHaveBeenCalledWith("mysite", "/path/to/mysite");
      expect(store.updateStatus).toHaveBeenCalledWith("site-id-1", "starting");
      expect(store.updateStatus).toHaveBeenCalledWith("site-id-1", "running");
      expect(store.updateActivity).toHaveBeenCalledWith("site-id-1");
    });

    it("throws when site not found", async () => {
      const store = makeMockStore({ findById: vi.fn().mockReturnValue(undefined) });
      const deps = makeDeps({ store });
      const manager = createLocalSiteManager(deps);

      await expect(manager.restart("nonexistent")).rejects.toThrow("Site not found: nonexistent");
    });

    it("sets status to error and rethrows when ddev restart fails", async () => {
      const site = makeSite();
      const store = makeMockStore({ findById: vi.fn().mockReturnValue(site) });
      const restartError = new Error("restart failed");
      const deps = makeDeps({
        store,
        ddevCli: makeMockDdevCli({
          restart: vi.fn().mockRejectedValue(restartError),
        }),
      });
      const manager = createLocalSiteManager(deps);

      await expect(manager.restart("site-id-1")).rejects.toThrow("restart failed");
      expect(store.updateStatus).toHaveBeenCalledWith("site-id-1", "error", "restart failed");
    });

    it("does not update URLs when describe returns undefined URLs on restart", async () => {
      const site = makeSite();
      const store = makeMockStore({ findById: vi.fn().mockReturnValue(site) });
      const deps = makeDeps({
        store,
        ddevCli: makeMockDdevCli({
          describe: vi.fn().mockResolvedValue(
            makeProjectInfo({ httpUrl: undefined, httpsUrl: undefined }),
          ),
        }),
      });
      const manager = createLocalSiteManager(deps);

      await manager.restart("site-id-1");
      expect(store.updateUrls).not.toHaveBeenCalled();
    });
  });

  // ── remove ────────────────────────────────────────────────────────────────

  describe("remove", () => {
    it("calls ddev delete and soft-deletes the site", async () => {
      const site = makeSite();
      const store = makeMockStore({ findById: vi.fn().mockReturnValue(site) });
      const rmDirFn = vi.fn().mockResolvedValue(undefined);
      const deps = makeDeps({ store, rmDirFn });
      const manager = createLocalSiteManager(deps);

      await manager.remove("site-id-1", false);

      expect(deps.ddevCli.delete).toHaveBeenCalledWith("mysite", "/path/to/mysite");
      expect(store.softDelete).toHaveBeenCalledWith("site-id-1");
      expect(rmDirFn).not.toHaveBeenCalled();
    });

    it("deletes repo directory when deleteRepo=true", async () => {
      const site = makeSite();
      const store = makeMockStore({ findById: vi.fn().mockReturnValue(site) });
      const rmDirFn = vi.fn().mockResolvedValue(undefined);
      const deps = makeDeps({ store, rmDirFn });
      const manager = createLocalSiteManager(deps);

      await manager.remove("site-id-1", true);

      expect(rmDirFn).toHaveBeenCalledWith("/path/to/mysite");
      expect(store.softDelete).toHaveBeenCalledWith("site-id-1");
    });

    it("continues with soft delete even when ddev delete fails", async () => {
      const site = makeSite();
      const store = makeMockStore({ findById: vi.fn().mockReturnValue(site) });
      const deps = makeDeps({
        store,
        ddevCli: makeMockDdevCli({
          delete: vi.fn().mockRejectedValue(new Error("project not found")),
        }),
      });
      const manager = createLocalSiteManager(deps);

      await expect(manager.remove("site-id-1", false)).resolves.toBeUndefined();
      expect(store.softDelete).toHaveBeenCalledWith("site-id-1");
    });

    it("throws when site not found", async () => {
      const store = makeMockStore({ findById: vi.fn().mockReturnValue(undefined) });
      const deps = makeDeps({ store });
      const manager = createLocalSiteManager(deps);

      await expect(manager.remove("nonexistent", false)).rejects.toThrow("Site not found: nonexistent");
    });
  });

  // ── getResourceUsage ──────────────────────────────────────────────────────

  describe("getResourceUsage", () => {
    it("returns resource snapshot from ddevCli", async () => {
      const snapshot = {
        cpuPercent: 12.5,
        memoryUsageBytes: 52428800,
        memoryLimitBytes: 8589934592,
      };
      const site = makeSite({ status: "running" });
      const store = makeMockStore({ findById: vi.fn().mockReturnValue(site) });
      const deps = makeDeps({
        store,
        ddevCli: makeMockDdevCli({
          resourceSnapshot: vi.fn().mockResolvedValue(snapshot),
        }),
      });
      const manager = createLocalSiteManager(deps);

      const result = await manager.getResourceUsage("site-id-1");

      expect(result).toEqual(snapshot);
      expect(deps.ddevCli.resourceSnapshot).toHaveBeenCalledWith("mysite");
    });

    it("returns undefined when no containers are running", async () => {
      const site = makeSite();
      const store = makeMockStore({ findById: vi.fn().mockReturnValue(site) });
      const deps = makeDeps({ store });
      const manager = createLocalSiteManager(deps);

      expect(await manager.getResourceUsage("site-id-1")).toBeUndefined();
    });

    it("throws when site not found", async () => {
      const store = makeMockStore({ findById: vi.fn().mockReturnValue(undefined) });
      const deps = makeDeps({ store });
      const manager = createLocalSiteManager(deps);

      await expect(manager.getResourceUsage("nonexistent")).rejects.toThrow(
        "Site not found: nonexistent",
      );
    });
  });

  // ── syncAll ───────────────────────────────────────────────────────────────

  describe("syncAll", () => {
    it("updates running sites that are now stopped in ddev", async () => {
      const site = makeSite({ status: "running" });
      const store = makeMockStore({ listAll: vi.fn().mockReturnValue([site]) });
      const deps = makeDeps({
        store,
        ddevCli: makeMockDdevCli({
          list: vi.fn().mockResolvedValue([
            makeProjectInfo({ name: "mysite", status: "stopped" }),
          ]),
        }),
      });
      const manager = createLocalSiteManager(deps);

      await manager.syncAll();

      expect(store.updateStatus).toHaveBeenCalledWith("site-id-1", "stopped");
    });

    it("updates stopped sites that are now running in ddev", async () => {
      const site = makeSite({ status: "stopped" });
      const store = makeMockStore({ listAll: vi.fn().mockReturnValue([site]) });
      const deps = makeDeps({
        store,
        ddevCli: makeMockDdevCli({
          list: vi.fn().mockResolvedValue([
            makeProjectInfo({ name: "mysite", status: "running" }),
          ]),
        }),
      });
      const manager = createLocalSiteManager(deps);

      await manager.syncAll();

      expect(store.updateStatus).toHaveBeenCalledWith("site-id-1", "running");
    });

    it("marks site as stopped when not in ddev list", async () => {
      const site = makeSite({ status: "running" });
      const store = makeMockStore({ listAll: vi.fn().mockReturnValue([site]) });
      const deps = makeDeps({
        store,
        ddevCli: makeMockDdevCli({ list: vi.fn().mockResolvedValue([]) }),
      });
      const manager = createLocalSiteManager(deps);

      await manager.syncAll();

      expect(store.updateStatus).toHaveBeenCalledWith("site-id-1", "stopped");
    });

    it("does not call updateStatus when status is already correct", async () => {
      const site = makeSite({ status: "running" });
      const store = makeMockStore({ listAll: vi.fn().mockReturnValue([site]) });
      const deps = makeDeps({
        store,
        ddevCli: makeMockDdevCli({
          list: vi.fn().mockResolvedValue([
            makeProjectInfo({ name: "mysite", status: "running" }),
          ]),
        }),
      });
      const manager = createLocalSiteManager(deps);

      await manager.syncAll();

      expect(store.updateStatus).not.toHaveBeenCalled();
    });

    it("handles already-stopped site not in ddev list without extra update", async () => {
      const site = makeSite({ status: "stopped" });
      const store = makeMockStore({ listAll: vi.fn().mockReturnValue([site]) });
      const deps = makeDeps({
        store,
        ddevCli: makeMockDdevCli({ list: vi.fn().mockResolvedValue([]) }),
      });
      const manager = createLocalSiteManager(deps);

      await manager.syncAll();

      // stopped -> not in list -> should NOT call updateStatus (already stopped)
      expect(store.updateStatus).not.toHaveBeenCalled();
    });

    it("maps ddev 'starting' status to starting", async () => {
      const site = makeSite({ status: "stopped" });
      const store = makeMockStore({ listAll: vi.fn().mockReturnValue([site]) });
      const deps = makeDeps({
        store,
        ddevCli: makeMockDdevCli({
          list: vi.fn().mockResolvedValue([
            makeProjectInfo({ name: "mysite", status: "starting" }),
          ]),
        }),
      });
      const manager = createLocalSiteManager(deps);

      await manager.syncAll();

      expect(store.updateStatus).toHaveBeenCalledWith("site-id-1", "starting");
    });

    it("maps unknown ddev statuses to stopped", async () => {
      const site = makeSite({ status: "running" });
      const store = makeMockStore({ listAll: vi.fn().mockReturnValue([site]) });
      const deps = makeDeps({
        store,
        ddevCli: makeMockDdevCli({
          list: vi.fn().mockResolvedValue([
            makeProjectInfo({ name: "mysite", status: "paused" }),
          ]),
        }),
      });
      const manager = createLocalSiteManager(deps);

      await manager.syncAll();

      expect(store.updateStatus).toHaveBeenCalledWith("site-id-1", "stopped");
    });

    it("does nothing when no sites are stored", async () => {
      const store = makeMockStore({ listAll: vi.fn().mockReturnValue([]) });
      const deps = makeDeps({ store });
      const manager = createLocalSiteManager(deps);

      await manager.syncAll();

      expect(store.updateStatus).not.toHaveBeenCalled();
    });
  });

  // ── listAll ───────────────────────────────────────────────────────────────

  describe("listAll", () => {
    it("delegates to store.listAll", () => {
      const sites = [makeSite(), makeSite({ id: "site-2", repoPath: "/b" })];
      const store = makeMockStore({ listAll: vi.fn().mockReturnValue(sites) });
      const deps = makeDeps({ store });
      const manager = createLocalSiteManager(deps);

      expect(manager.listAll()).toBe(sites);
      expect(store.listAll).toHaveBeenCalled();
    });
  });

  // ── close ─────────────────────────────────────────────────────────────────

  describe("close", () => {
    it("calls store.close", () => {
      const store = makeMockStore();
      const deps = makeDeps({ store });
      const manager = createLocalSiteManager(deps);

      manager.close();

      expect(store.close).toHaveBeenCalled();
    });
  });

  // ── default rmDirFn ───────────────────────────────────────────────────────

  describe("default rmDirFn", () => {
    it("uses node:fs/promises rm when rmDirFn not injected", async () => {
      // Create a real temporary directory so the default rm can actually remove it
      const { mkdtempSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const tmpPath = mkdtempSync(`${tmpdir()}/lsm-default-rm-`);

      const site = makeSite({ repoPath: tmpPath });
      const store = makeMockStore({ findById: vi.fn().mockReturnValue(site) });
      // Do not inject rmDirFn — exercises the default branch
      const manager = createLocalSiteManager({
        store,
        ddevCli: makeMockDdevCli(),
        execCommand: makeExecCommand(),
        readFileFn: vi.fn().mockReturnValue("name: mysite\n"),
      });

      await manager.remove("site-id-1", true);

      expect(store.softDelete).toHaveBeenCalledWith("site-id-1");
    });
  });

  // ── error message fallback ────────────────────────────────────────────────

  describe("non-Error thrown values", () => {
    it("provision: uses 'Unknown error' message when non-Error thrown", async () => {
      const deps = makeDeps({
        ddevCli: makeMockDdevCli({
          start: vi.fn().mockRejectedValue("string error"),
        }),
      });
      const manager = createLocalSiteManager(deps);

      await expect(
        manager.provision({
          repoUrl: "https://github.com/org/mysite.git",
          clonePath: "/clones",
        }),
      ).rejects.toBe("string error");

      expect(deps.store.updateStatus).toHaveBeenCalledWith(
        "site-id-1",
        "error",
        "Unknown error during ddev start",
      );
    });

    it("start: uses 'Unknown error' message when non-Error thrown", async () => {
      const site = makeSite();
      const store = makeMockStore({ findById: vi.fn().mockReturnValue(site) });
      const deps = makeDeps({
        store,
        ddevCli: makeMockDdevCli({
          start: vi.fn().mockRejectedValue(42),
        }),
      });
      const manager = createLocalSiteManager(deps);

      await expect(manager.start("site-id-1")).rejects.toBe(42);
      expect(store.updateStatus).toHaveBeenCalledWith(
        "site-id-1",
        "error",
        "Unknown error during ddev start",
      );
    });

    it("stop: uses 'Unknown error' message when non-Error thrown", async () => {
      const site = makeSite({ status: "running" });
      const store = makeMockStore({ findById: vi.fn().mockReturnValue(site) });
      const deps = makeDeps({
        store,
        ddevCli: makeMockDdevCli({
          stop: vi.fn().mockRejectedValue(null),
        }),
      });
      const manager = createLocalSiteManager(deps);

      await expect(manager.stop("site-id-1")).rejects.toBeNull();
      expect(store.updateStatus).toHaveBeenCalledWith(
        "site-id-1",
        "error",
        "Unknown error during ddev stop",
      );
    });

    it("restart: uses 'Unknown error' message when non-Error thrown", async () => {
      const site = makeSite();
      const store = makeMockStore({ findById: vi.fn().mockReturnValue(site) });
      const deps = makeDeps({
        store,
        ddevCli: makeMockDdevCli({
          restart: vi.fn().mockRejectedValue(undefined),
        }),
      });
      const manager = createLocalSiteManager(deps);

      await expect(manager.restart("site-id-1")).rejects.toBeUndefined();
      expect(store.updateStatus).toHaveBeenCalledWith(
        "site-id-1",
        "error",
        "Unknown error during ddev restart",
      );
    });
  });

  // ── default readFileFn ────────────────────────────────────────────────────

  describe("default readFileFn", () => {
    it("uses readFileSync when readFileFn not injected and falls back to repo name on ENOENT", async () => {
      const store = makeMockStore();
      // Do not inject readFileFn — exercises the default branch (readFileSync throws ENOENT for non-existent path)
      const manager = createLocalSiteManager({
        store,
        ddevCli: makeMockDdevCli(),
        execCommand: makeExecCommand(),
        rmDirFn: vi.fn().mockResolvedValue(undefined),
        // clonePath points to a non-existent dir so readFileSync will throw
        defaultCloneBase: "/nonexistent-path-for-test",
      });

      await manager.provision({
        repoUrl: "https://github.com/org/fallback-site.git",
        clonePath: "/nonexistent-path-for-test",
      });

      // Should fall back to repo name as ddevProjectName when config.yaml is unreadable
      expect(store.create).toHaveBeenCalledWith(
        expect.objectContaining({ ddevProjectName: "fallback-site" }),
      );
    });
  });

  // ── provision findById fallback ───────────────────────────────────────────

  describe("provision findById fallback", () => {
    it("returns original site object when findById returns undefined after provision", async () => {
      const store = makeMockStore({
        // findById returns undefined to exercise the ?? site fallback on line 164
        findById: vi.fn().mockReturnValue(undefined),
      });
      const deps = makeDeps({ store });
      const manager = createLocalSiteManager(deps);

      const result = await manager.provision({
        repoUrl: "https://github.com/org/mysite.git",
        clonePath: "/clones",
      });

      // The fallback `?? site` returns the originally-created site
      expect(result).toBeDefined();
      expect(result.repoUrl).toBe("https://github.com/org/mysite.git");
    });
  });
});
