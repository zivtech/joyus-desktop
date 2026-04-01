import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { openLocalSiteStore, mapRowToLocalSite } from "../src/localSiteStore.js";
import type { LocalSiteStore, LocalSite } from "../src/localSiteStore.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSiteInput(
  overrides: Partial<Omit<LocalSite, "id" | "createdAt" | "lastActivityAt">> = {},
): Omit<LocalSite, "id" | "createdAt" | "lastActivityAt"> {
  return {
    projectName: "mysite",
    repoUrl: "https://github.com/org/mysite.git",
    repoPath: "/Users/dev/sites/mysite",
    ddevProjectName: "mysite",
    httpUrl: undefined,
    httpsUrl: undefined,
    status: "stopped",
    errorMessage: undefined,
    projectType: undefined,
    ...overrides,
  };
}

// ─── mapRowToLocalSite ────────────────────────────────────────────────────────

describe("mapRowToLocalSite", () => {
  it("maps all fields correctly", () => {
    const row = {
      id: "abc-123",
      project_name: "mysite",
      repo_url: "https://github.com/org/mysite.git",
      repo_path: "/path/to/mysite",
      ddev_project_name: "mysite",
      http_url: "http://mysite.ddev.site",
      https_url: "https://mysite.ddev.site",
      status: "running",
      error_message: null,
      project_type: "drupal10",
      created_at: 1000,
      last_activity_at: 2000,
      deleted_at: null,
    };

    const site = mapRowToLocalSite(row);

    expect(site.id).toBe("abc-123");
    expect(site.projectName).toBe("mysite");
    expect(site.repoUrl).toBe("https://github.com/org/mysite.git");
    expect(site.repoPath).toBe("/path/to/mysite");
    expect(site.ddevProjectName).toBe("mysite");
    expect(site.httpUrl).toBe("http://mysite.ddev.site");
    expect(site.httpsUrl).toBe("https://mysite.ddev.site");
    expect(site.status).toBe("running");
    expect(site.errorMessage).toBeUndefined();
    expect(site.projectType).toBe("drupal10");
    expect(site.createdAt).toBe(1000);
    expect(site.lastActivityAt).toBe(2000);
  });

  it("converts null http_url and https_url to undefined", () => {
    const row = {
      id: "x",
      project_name: "s",
      repo_url: "u",
      repo_path: "/p",
      ddev_project_name: "s",
      http_url: null,
      https_url: null,
      status: "stopped",
      error_message: null,
      project_type: null,
      created_at: 1,
      last_activity_at: 1,
      deleted_at: null,
    };

    const site = mapRowToLocalSite(row);
    expect(site.httpUrl).toBeUndefined();
    expect(site.httpsUrl).toBeUndefined();
    expect(site.errorMessage).toBeUndefined();
    expect(site.projectType).toBeUndefined();
  });

  it("converts null error_message and project_type to undefined", () => {
    const row = {
      id: "x",
      project_name: "s",
      repo_url: "u",
      repo_path: "/p",
      ddev_project_name: "s",
      http_url: null,
      https_url: null,
      status: "error",
      error_message: null,
      project_type: null,
      created_at: 1,
      last_activity_at: 1,
      deleted_at: null,
    };

    const site = mapRowToLocalSite(row);
    expect(site.errorMessage).toBeUndefined();
    expect(site.projectType).toBeUndefined();
  });
});

// ─── openLocalSiteStore ───────────────────────────────────────────────────────

describe("openLocalSiteStore", () => {
  let tmpDir: string;
  let store: LocalSiteStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "local-site-store-test-"));
    store = openLocalSiteStore(join(tmpDir, "test.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe("create", () => {
    it("creates a site and returns it with generated id and timestamps", () => {
      const input = makeSiteInput();
      const site = store.create(input);

      expect(site.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(site.projectName).toBe("mysite");
      expect(site.repoUrl).toBe("https://github.com/org/mysite.git");
      expect(site.repoPath).toBe("/Users/dev/sites/mysite");
      expect(site.ddevProjectName).toBe("mysite");
      expect(site.status).toBe("stopped");
      expect(site.httpUrl).toBeUndefined();
      expect(site.httpsUrl).toBeUndefined();
      expect(site.errorMessage).toBeUndefined();
      expect(site.projectType).toBeUndefined();
      expect(site.createdAt).toBeGreaterThan(0);
      expect(site.lastActivityAt).toBe(site.createdAt);
    });

    it("creates a site with optional fields populated", () => {
      const input = makeSiteInput({
        httpUrl: "http://mysite.ddev.site",
        httpsUrl: "https://mysite.ddev.site",
        status: "running",
        projectType: "drupal10",
      });
      const site = store.create(input);

      expect(site.httpUrl).toBe("http://mysite.ddev.site");
      expect(site.httpsUrl).toBe("https://mysite.ddev.site");
      expect(site.status).toBe("running");
      expect(site.projectType).toBe("drupal10");
    });

    it("creates sites with unique ids", () => {
      const a = store.create(makeSiteInput({ repoPath: "/a" }));
      const b = store.create(makeSiteInput({ repoPath: "/b" }));

      expect(a.id).not.toBe(b.id);
    });
  });

  // ── findById ──────────────────────────────────────────────────────────────

  describe("findById", () => {
    it("returns the site by id", () => {
      const created = store.create(makeSiteInput());
      const found = store.findById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.projectName).toBe("mysite");
    });

    it("returns undefined for unknown id", () => {
      expect(store.findById("nonexistent")).toBeUndefined();
    });

    it("returns undefined for soft-deleted site", () => {
      const site = store.create(makeSiteInput());
      store.softDelete(site.id);

      expect(store.findById(site.id)).toBeUndefined();
    });
  });

  // ── findByRepoPath ────────────────────────────────────────────────────────

  describe("findByRepoPath", () => {
    it("returns the site by repo path", () => {
      store.create(makeSiteInput({ repoPath: "/path/to/mysite" }));
      const found = store.findByRepoPath("/path/to/mysite");

      expect(found).toBeDefined();
      expect(found?.repoPath).toBe("/path/to/mysite");
    });

    it("returns undefined for unknown repo path", () => {
      expect(store.findByRepoPath("/nonexistent")).toBeUndefined();
    });

    it("returns undefined for soft-deleted site", () => {
      const site = store.create(makeSiteInput({ repoPath: "/path/to/mysite" }));
      store.softDelete(site.id);

      expect(store.findByRepoPath("/path/to/mysite")).toBeUndefined();
    });
  });

  // ── listAll ───────────────────────────────────────────────────────────────

  describe("listAll", () => {
    it("returns empty array when no sites exist", () => {
      expect(store.listAll()).toEqual([]);
    });

    it("returns all non-deleted sites", () => {
      store.create(makeSiteInput({ repoPath: "/a" }));
      store.create(makeSiteInput({ repoPath: "/b" }));
      store.create(makeSiteInput({ repoPath: "/c" }));

      expect(store.listAll()).toHaveLength(3);
    });

    it("excludes soft-deleted sites", () => {
      const a = store.create(makeSiteInput({ repoPath: "/a" }));
      store.create(makeSiteInput({ repoPath: "/b" }));
      store.softDelete(a.id);

      expect(store.listAll()).toHaveLength(1);
    });

    it("orders by last_activity_at desc", () => {
      const a = store.create(makeSiteInput({ repoPath: "/a" }));
      const b = store.create(makeSiteInput({ repoPath: "/b" }));

      store.updateActivity(b.id);
      // b was touched after a, so b should come first
      const list = store.listAll();
      expect(list[0]?.id).toBe(b.id);
      expect(list[1]?.id).toBe(a.id);
    });
  });

  // ── updateStatus ──────────────────────────────────────────────────────────

  describe("updateStatus", () => {
    it("updates status to running", () => {
      const site = store.create(makeSiteInput());
      store.updateStatus(site.id, "running");

      expect(store.findById(site.id)?.status).toBe("running");
    });

    it("updates status to error with error message", () => {
      const site = store.create(makeSiteInput());
      store.updateStatus(site.id, "error", "Port conflict on :443");

      const found = store.findById(site.id);
      expect(found?.status).toBe("error");
      expect(found?.errorMessage).toBe("Port conflict on :443");
    });

    it("clears error message when transitioning out of error (undefined)", () => {
      const site = store.create(makeSiteInput());
      store.updateStatus(site.id, "error", "some error");
      store.updateStatus(site.id, "running");

      const found = store.findById(site.id);
      expect(found?.status).toBe("running");
      expect(found?.errorMessage).toBeUndefined();
    });

    it("supports all valid status transitions", () => {
      const statuses: Array<"running" | "stopped" | "starting" | "error"> = [
        "running",
        "stopped",
        "starting",
        "error",
      ];
      for (const status of statuses) {
        const site = store.create(makeSiteInput({ repoPath: `/p-${status}` }));
        store.updateStatus(site.id, status);
        expect(store.findById(site.id)?.status).toBe(status);
      }
    });
  });

  // ── updateUrls ────────────────────────────────────────────────────────────

  describe("updateUrls", () => {
    it("updates http and https urls", () => {
      const site = store.create(makeSiteInput());
      store.updateUrls(
        site.id,
        "http://mysite.ddev.site",
        "https://mysite.ddev.site",
      );

      const found = store.findById(site.id);
      expect(found?.httpUrl).toBe("http://mysite.ddev.site");
      expect(found?.httpsUrl).toBe("https://mysite.ddev.site");
    });
  });

  // ── updateActivity ────────────────────────────────────────────────────────

  describe("updateActivity", () => {
    it("updates last_activity_at to current time", () => {
      const site = store.create(makeSiteInput());
      const before = site.lastActivityAt;

      store.updateActivity(site.id);

      const found = store.findById(site.id);
      expect(found?.lastActivityAt).toBeGreaterThanOrEqual(before);
    });
  });

  // ── softDelete ────────────────────────────────────────────────────────────

  describe("softDelete", () => {
    it("soft-deletes a site — findById returns undefined", () => {
      const site = store.create(makeSiteInput());
      store.softDelete(site.id);

      expect(store.findById(site.id)).toBeUndefined();
    });

    it("soft-deleted site is excluded from listAll", () => {
      const site = store.create(makeSiteInput());
      store.softDelete(site.id);

      expect(store.listAll()).toHaveLength(0);
    });

    it("soft-deleted site is excluded from findByRepoPath", () => {
      const site = store.create(makeSiteInput({ repoPath: "/my/path" }));
      store.softDelete(site.id);

      expect(store.findByRepoPath("/my/path")).toBeUndefined();
    });

    it("allows creating a new site at the same repo path after soft delete", () => {
      const site = store.create(makeSiteInput({ repoPath: "/same/path" }));
      store.softDelete(site.id);

      const newSite = store.create(makeSiteInput({ repoPath: "/same/path" }));
      expect(newSite.id).not.toBe(site.id);
      expect(store.findByRepoPath("/same/path")).toBeDefined();
    });
  });

  // ── close ─────────────────────────────────────────────────────────────────

  describe("close", () => {
    it("can be closed without error", () => {
      const s = openLocalSiteStore(join(tmpDir, "close-test.db"));
      expect(() => s.close()).not.toThrow();
    });

    it("calling close twice does not throw", () => {
      const s = openLocalSiteStore(join(tmpDir, "close-twice.db"));
      s.close();
      expect(() => s.close()).not.toThrow();
    });
  });

  // ── default db path ───────────────────────────────────────────────────────

  describe("schema idempotency", () => {
    it("opening the same db path twice (schema re-runs) does not throw", () => {
      const dbPath = join(tmpDir, "idempotent.db");
      const s1 = openLocalSiteStore(dbPath);
      s1.create(makeSiteInput());
      s1.close();

      const s2 = openLocalSiteStore(dbPath);
      expect(s2.listAll()).toHaveLength(1);
      s2.close();
    });
  });

});
