import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  openTaskBranchStore,
  mapRowToTaskBranch,
} from "../src/taskBranchStore";
import type { TaskBranchStore, ExecGit } from "../src/taskBranchStore";

function makeTmpDbPath(): string {
  return join(
    tmpdir(),
    `session-manager-test-${randomUUID()}`,
    "session-manager.db",
  );
}

function cleanupPath(dbPath: string): void {
  try {
    rmSync(join(dbPath, ".."), { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function makeInput(overrides?: Partial<{
  sessionId: string;
  repoPath: string;
  worktreePath: string;
  branchName: string;
  missionLabel: string;
  missionSource: "declared" | "inferred";
  mode: "managed" | "advisory";
}>) {
  return {
    sessionId: overrides?.sessionId ?? `session-${randomUUID()}`,
    repoPath: overrides?.repoPath ?? "/repo/path",
    worktreePath: overrides?.worktreePath ?? "/repo/.joyus-worktrees/test",
    branchName: overrides?.branchName ?? "joyus/2026-03-19-test",
    missionLabel: overrides?.missionLabel ?? "test-mission",
    missionSource: overrides?.missionSource ?? ("inferred" as const),
    mode: overrides?.mode ?? ("managed" as const),
  };
}

describe("openTaskBranchStore", () => {
  it("creates DB at custom path", () => {
    const dbPath = makeTmpDbPath();
    const store = openTaskBranchStore(dbPath);
    expect(store).toBeDefined();
    store.close();
    cleanupPath(dbPath);
  });

  it("close() is idempotent — calling twice does not throw", () => {
    const dbPath = makeTmpDbPath();
    const store = openTaskBranchStore(dbPath);
    store.close();
    expect(() => store.close()).not.toThrow();
    cleanupPath(dbPath);
  });

  it("creates parent directory if missing", () => {
    const dbPath = makeTmpDbPath();
    const store = openTaskBranchStore(dbPath);
    store.close();
    cleanupPath(dbPath);
  });

  it("creates DB at default path when no args given", () => {
    const fakeHome = join(tmpdir(), `fake-home-sm-${randomUUID()}`);
    mkdirSync(fakeHome, { recursive: true });
    vi.stubEnv("HOME", fakeHome);

    try {
      const store = openTaskBranchStore();
      expect(store).toBeDefined();
      store.close();
    } finally {
      vi.unstubAllEnvs();
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("schema is idempotent — opening twice works", () => {
    const dbPath = makeTmpDbPath();
    const store1 = openTaskBranchStore(dbPath);
    store1.close();
    const store2 = openTaskBranchStore(dbPath);
    store2.close();
    cleanupPath(dbPath);
  });
});

describe("create + findBySessionId", () => {
  let store: TaskBranchStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    store = openTaskBranchStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("round-trips a TaskBranch", () => {
    const input = makeInput({ sessionId: "sess-round-trip" });
    const created = store.create(input);

    expect(created.sessionId).toBe("sess-round-trip");
    expect(created.status).toBe("active");
    expect(created.id).toBeTruthy();
    expect(created.createdAt).toBeGreaterThan(0);
    expect(created.lastActivityAt).toBeGreaterThan(0);

    const found = store.findBySessionId("sess-round-trip");
    expect(found).toBeDefined();
    expect(found?.id).toBe(created.id);
    expect(found?.repoPath).toBe(input.repoPath);
    expect(found?.worktreePath).toBe(input.worktreePath);
    expect(found?.branchName).toBe(input.branchName);
    expect(found?.missionLabel).toBe(input.missionLabel);
    expect(found?.missionSource).toBe(input.missionSource);
    expect(found?.mode).toBe(input.mode);
    expect(found?.status).toBe("active");
  });

  it("returns undefined for missing session", () => {
    const found = store.findBySessionId("nonexistent");
    expect(found).toBeUndefined();
  });

  it("returns undefined for soft-deleted session", () => {
    const created = store.create(makeInput({ sessionId: "sess-deleted" }));
    store.softDelete(created.id);
    const found = store.findBySessionId("sess-deleted");
    expect(found).toBeUndefined();
  });
});

describe("findById", () => {
  let store: TaskBranchStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    store = openTaskBranchStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("returns TaskBranch by id", () => {
    const created = store.create(makeInput({ sessionId: "sess-findbyid" }));
    const found = store.findById(created.id);
    expect(found).toBeDefined();
    expect(found?.id).toBe(created.id);
    expect(found?.sessionId).toBe("sess-findbyid");
  });

  it("returns undefined for unknown id", () => {
    expect(store.findById("no-such-id")).toBeUndefined();
  });

  it("returns undefined for soft-deleted branch", () => {
    const created = store.create(makeInput({ sessionId: "sess-del-byid" }));
    store.softDelete(created.id);
    expect(store.findById(created.id)).toBeUndefined();
  });
});

describe("listAll", () => {
  let store: TaskBranchStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    store = openTaskBranchStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("returns empty array when no records", () => {
    const all = store.listAll();
    expect(all).toEqual([]);
  });

  it("excludes soft-deleted records", () => {
    const created = store.create(makeInput());
    store.softDelete(created.id);
    const all = store.listAll();
    expect(all).toHaveLength(0);
  });

  it("orders by last_activity_at DESC", () => {
    const older = store.create(makeInput({ sessionId: "older" }));
    const newer = store.create(makeInput({ sessionId: "newer" }));

    // Bump newer's activity to ensure it's first
    store.updateActivity({
      taskBranchId: newer.id,
      lastActivityAt: Date.now() + 10000,
    });

    const all = store.listAll();
    expect(all).toHaveLength(2);
    expect(all.at(0)?.sessionId).toBe("newer");
    expect(all.at(1)?.sessionId).toBe("older");
  });
});

describe("findByRepoPath", () => {
  let store: TaskBranchStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    store = openTaskBranchStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("returns branches matching the repo path", () => {
    store.create(makeInput({ repoPath: "/repo/a", sessionId: "s1" }));
    store.create(makeInput({ repoPath: "/repo/a", sessionId: "s2" }));
    store.create(makeInput({ repoPath: "/repo/b", sessionId: "s3" }));

    const results = store.findByRepoPath("/repo/a");
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.repoPath === "/repo/a")).toBe(true);
  });

  it("returns empty array when no branches match", () => {
    store.create(makeInput({ repoPath: "/repo/x", sessionId: "s1" }));
    expect(store.findByRepoPath("/repo/none")).toEqual([]);
  });

  it("excludes soft-deleted branches", () => {
    const created = store.create(makeInput({ repoPath: "/repo/del", sessionId: "s1" }));
    store.softDelete(created.id);
    expect(store.findByRepoPath("/repo/del")).toEqual([]);
  });

  it("orders by last_activity_at DESC", () => {
    const older = store.create(makeInput({ repoPath: "/repo/ord", sessionId: "older" }));
    const newer = store.create(makeInput({ repoPath: "/repo/ord", sessionId: "newer" }));
    store.updateActivity({ taskBranchId: newer.id, lastActivityAt: Date.now() + 10000 });

    const results = store.findByRepoPath("/repo/ord");
    expect(results).toHaveLength(2);
    expect(results.at(0)?.sessionId).toBe("newer");
    expect(results.at(1)?.sessionId).toBe("older");
  });
});

describe("countsByRepo", () => {
  let store: TaskBranchStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    store = openTaskBranchStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("returns empty object when no branches exist", () => {
    expect(store.countsByRepo()).toEqual({});
  });

  it("counts active and total branches per repo", () => {
    store.create(makeInput({ repoPath: "/repo/a", sessionId: "s1" }));
    store.create(makeInput({ repoPath: "/repo/a", sessionId: "s2" }));
    store.create(makeInput({ repoPath: "/repo/b", sessionId: "s3" }));

    const staleA = store.create(makeInput({ repoPath: "/repo/a", sessionId: "s4" }));
    store.updateStatus(staleA.id, "stale");

    const counts = store.countsByRepo();
    expect(counts["/repo/a"]).toBeDefined();
    expect(counts["/repo/a"]!.total).toBe(3);
    expect(counts["/repo/a"]!.active).toBe(2);
    expect(counts["/repo/b"]).toBeDefined();
    expect(counts["/repo/b"]!.total).toBe(1);
    expect(counts["/repo/b"]!.active).toBe(1);
  });

  it("excludes soft-deleted branches", () => {
    const created = store.create(makeInput({ repoPath: "/repo/del", sessionId: "s1" }));
    store.softDelete(created.id);
    expect(store.countsByRepo()).toEqual({});
  });

  it("returns lastActivityAt as the max across branches", () => {
    const b1 = store.create(makeInput({ repoPath: "/repo/t", sessionId: "s1" }));
    store.create(makeInput({ repoPath: "/repo/t", sessionId: "s2" }));
    const futureTs = Date.now() + 50000;
    store.updateActivity({ taskBranchId: b1.id, lastActivityAt: futureTs });

    const counts = store.countsByRepo();
    expect(counts["/repo/t"]!.lastActivityAt).toBe(futureTs);
  });

  it("returns number types (not bigint) for all numeric fields", () => {
    store.create(makeInput({ repoPath: "/repo/num", sessionId: "s1" }));
    const counts = store.countsByRepo();
    const entry = counts["/repo/num"]!;
    expect(typeof entry.active).toBe("number");
    expect(typeof entry.total).toBe("number");
    expect(typeof entry.lastActivityAt).toBe("number");
  });
});

describe("updateStatus", () => {
  let store: TaskBranchStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    store = openTaskBranchStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("transitions status", () => {
    const created = store.create(makeInput({ sessionId: "sess-status" }));
    expect(created.status).toBe("active");

    store.updateStatus(created.id, "stale");
    const found = store.findBySessionId("sess-status");
    expect(found?.status).toBe("stale");
  });
});

describe("updateActivity", () => {
  let store: TaskBranchStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    store = openTaskBranchStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("updates lastActivityAt", () => {
    const created = store.create(makeInput({ sessionId: "sess-activity" }));
    const newTime = Date.now() + 99999;

    store.updateActivity({
      taskBranchId: created.id,
      lastActivityAt: newTime,
    });

    const found = store.findBySessionId("sess-activity");
    expect(found?.lastActivityAt).toBe(newTime);
  });
});

describe("softDelete", () => {
  let store: TaskBranchStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    store = openTaskBranchStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("sets deleted_at and excludes from findBySessionId", () => {
    const created = store.create(makeInput({ sessionId: "sess-soft-del" }));
    store.softDelete(created.id);

    const found = store.findBySessionId("sess-soft-del");
    expect(found).toBeUndefined();
  });

  it("sets deleted_at and excludes from listAll", () => {
    const created = store.create(makeInput());
    store.softDelete(created.id);

    const all = store.listAll();
    expect(all).toHaveLength(0);
  });
});

describe("applyStaleThreshold", () => {
  let store: TaskBranchStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    store = openTaskBranchStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("transitions active to stale when lastActivityAt is below threshold", () => {
    const created = store.create(makeInput({ sessionId: "sess-stale" }));

    // Set activity far in the past
    store.updateActivity({
      taskBranchId: created.id,
      lastActivityAt: 1000,
    });

    store.applyStaleThreshold(Date.now());

    const found = store.findBySessionId("sess-stale");
    expect(found?.status).toBe("stale");
  });

  it("does not transition merged records", () => {
    const created = store.create(makeInput({ sessionId: "sess-merged" }));
    store.updateStatus(created.id, "merged");

    store.updateActivity({
      taskBranchId: created.id,
      lastActivityAt: 1000,
    });

    store.applyStaleThreshold(Date.now());

    const found = store.findBySessionId("sess-merged");
    expect(found?.status).toBe("merged");
  });

  it("does not transition broken records", () => {
    const created = store.create(makeInput({ sessionId: "sess-broken" }));
    store.updateStatus(created.id, "broken");

    store.updateActivity({
      taskBranchId: created.id,
      lastActivityAt: 1000,
    });

    store.applyStaleThreshold(Date.now());

    const found = store.findBySessionId("sess-broken");
    expect(found?.status).toBe("broken");
  });

  it("does not transition active records above threshold", () => {
    const created = store.create(makeInput({ sessionId: "sess-recent" }));

    // Activity is recent (set by create), threshold is far in the past
    store.applyStaleThreshold(1000);

    const found = store.findBySessionId("sess-recent");
    expect(found?.status).toBe("active");
  });
});

describe("detectMerged", () => {
  let store: TaskBranchStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    store = openTaskBranchStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("marks branch as merged when git reports it merged", async () => {
    const created = store.create(
      makeInput({
        sessionId: "sess-detect-merged",
        branchName: "joyus/2026-03-19-feature",
        repoPath: "/repo",
      }),
    );

    const execGit: ExecGit = vi.fn().mockResolvedValue({
      stdout: "  main\n  joyus/2026-03-19-feature\n",
      stderr: "",
    });

    await store.detectMerged(execGit);

    const found = store.findBySessionId("sess-detect-merged");
    expect(found?.status).toBe("merged");
  });

  it("does not mark unmerged branches", async () => {
    store.create(
      makeInput({
        sessionId: "sess-not-merged",
        branchName: "joyus/2026-03-19-other",
        repoPath: "/repo",
      }),
    );

    const execGit: ExecGit = vi.fn().mockResolvedValue({
      stdout: "  main\n  some-other-branch\n",
      stderr: "",
    });

    await store.detectMerged(execGit);

    const found = store.findBySessionId("sess-not-merged");
    expect(found?.status).toBe("active");
  });

  it("skips repos where execGit throws", async () => {
    store.create(
      makeInput({
        sessionId: "sess-git-error",
        branchName: "joyus/2026-03-19-broken",
        repoPath: "/missing-repo",
      }),
    );

    const execGit: ExecGit = vi
      .fn()
      .mockRejectedValue(new Error("git not found"));

    await store.detectMerged(execGit);

    const found = store.findBySessionId("sess-git-error");
    expect(found?.status).toBe("active");
  });

  it("checks stale branches too", async () => {
    const created = store.create(
      makeInput({
        sessionId: "sess-stale-merged",
        branchName: "joyus/2026-03-19-stale-feat",
        repoPath: "/repo",
      }),
    );
    store.updateStatus(created.id, "stale");

    const execGit: ExecGit = vi.fn().mockResolvedValue({
      stdout: "  main\n  joyus/2026-03-19-stale-feat\n",
      stderr: "",
    });

    await store.detectMerged(execGit);

    const found = store.findBySessionId("sess-stale-merged");
    expect(found?.status).toBe("merged");
  });
});

describe("scanIntegrity", () => {
  let store: TaskBranchStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    store = openTaskBranchStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("marks missing worktree as broken", async () => {
    store.create(
      makeInput({
        sessionId: "sess-integrity-missing",
        worktreePath: "/repo/.joyus-worktrees/missing",
        repoPath: "/repo",
      }),
    );

    const execGit: ExecGit = vi.fn().mockResolvedValue({
      stdout: "worktree /repo\n\n",
      stderr: "",
    });

    await store.scanIntegrity(execGit);

    const found = store.findBySessionId("sess-integrity-missing");
    expect(found?.status).toBe("broken");
  });

  it("leaves healthy worktree unchanged", async () => {
    const healthyDir = join(tmpdir(), `healthy-worktree-${randomUUID()}`);
    mkdirSync(healthyDir, { recursive: true });
    try {
      store.create(
        makeInput({
          sessionId: "sess-integrity-healthy",
          worktreePath: healthyDir,
          repoPath: "/repo",
        }),
      );

      const execGit: ExecGit = vi.fn().mockResolvedValue({
        stdout: `worktree /repo\n\nworktree ${healthyDir}\n\n`,
        stderr: "",
      });

      await store.scanIntegrity(execGit);

      const found = store.findBySessionId("sess-integrity-healthy");
      expect(found?.status).toBe("active");
    } finally {
      rmSync(healthyDir, { recursive: true, force: true });
    }
  });

  it("skips already-broken records", async () => {
    const created = store.create(
      makeInput({
        sessionId: "sess-already-broken",
        worktreePath: "/repo/.joyus-worktrees/already-broken",
        repoPath: "/repo",
      }),
    );
    store.updateStatus(created.id, "broken");

    const execGit: ExecGit = vi.fn();

    await store.scanIntegrity(execGit);

    // execGit should not be called for already-broken records
    expect(execGit).not.toHaveBeenCalled();
  });

  it("handles execGit errors gracefully", async () => {
    const errorDir = join(tmpdir(), `error-worktree-${randomUUID()}`);
    mkdirSync(errorDir, { recursive: true });
    try {
      store.create(
        makeInput({
          sessionId: "sess-integrity-error",
          worktreePath: errorDir,
          repoPath: "/repo",
        }),
      );

      const execGit: ExecGit = vi
        .fn()
        .mockRejectedValue(new Error("git error"));

      await store.scanIntegrity(execGit);

      // When execGit throws, isWorktreeHealthy returns false → broken
      const found = store.findBySessionId("sess-integrity-error");
      expect(found?.status).toBe("broken");
    } finally {
      rmSync(errorDir, { recursive: true, force: true });
    }
  });
});

describe("mapRowToTaskBranch", () => {
  it("maps a StoredRow to TaskBranch", () => {
    const row = {
      id: "id-1",
      session_id: "sess-1",
      repo_path: "/repo",
      worktree_path: "/repo/.joyus-worktrees/test",
      branch_name: "joyus/2026-03-19-test",
      mission_label: "test-mission",
      mission_source: "inferred",
      mode: "managed",
      status: "active",
      created_at: 1000,
      last_activity_at: 2000,
      deleted_at: null,
    };

    const result = mapRowToTaskBranch(row);

    expect(result).toEqual({
      id: "id-1",
      sessionId: "sess-1",
      repoPath: "/repo",
      worktreePath: "/repo/.joyus-worktrees/test",
      branchName: "joyus/2026-03-19-test",
      missionLabel: "test-mission",
      missionSource: "inferred",
      mode: "managed",
      status: "active",
      createdAt: 1000,
      lastActivityAt: 2000,
    });
  });
});

describe("close", () => {
  it("closes without error", () => {
    const dbPath = makeTmpDbPath();
    const store = openTaskBranchStore(dbPath);
    expect(() => store.close()).not.toThrow();
    cleanupPath(dbPath);
  });
});

describe("updatePrAssociation", () => {
  let store: TaskBranchStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = makeTmpDbPath();
    store = openTaskBranchStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // already closed
    }
    cleanupPath(dbPath);
  });

  it("persists PR fields and round-trips via findById", () => {
    const input = makeInput({ sessionId: "sess-pr-assoc" });
    const created = store.create(input);

    expect(created.prNumber).toBeUndefined();
    expect(created.prUrl).toBeUndefined();
    expect(created.prTitle).toBeUndefined();

    store.updatePrAssociation({
      taskBranchId: created.id,
      prNumber: 99,
      prUrl: "https://github.com/org/repo/pull/99",
      prTitle: "My draft PR",
    });

    const updated = store.findById(created.id);
    expect(updated?.prNumber).toBe(99);
    expect(updated?.prUrl).toBe("https://github.com/org/repo/pull/99");
    expect(updated?.prTitle).toBe("My draft PR");
  });

  it("stores null prTitle when undefined is passed", () => {
    const created = store.create(makeInput({ sessionId: "sess-pr-notitle" }));

    store.updatePrAssociation({
      taskBranchId: created.id,
      prNumber: 5,
      prUrl: "https://github.com/org/repo/pull/5",
      prTitle: undefined,
    });

    const updated = store.findById(created.id);
    expect(updated?.prNumber).toBe(5);
    expect(updated?.prTitle).toBeUndefined();
  });
});

describe("schema migration — PR columns added to existing DB", () => {
  it("migrates an existing database that is missing PR columns", () => {
    const dbPath = makeTmpDbPath();
    mkdirSync(join(dbPath, ".."), { recursive: true });

    // Simulate an old-style database by creating it without PR columns
    const { DatabaseSync } = require("node:sqlite");
    const oldDb = new DatabaseSync(dbPath);
    oldDb.exec(`
      CREATE TABLE IF NOT EXISTS task_branches (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        repo_path TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        branch_name TEXT NOT NULL,
        mission_label TEXT NOT NULL,
        mission_source TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_task_branches_session_id
        ON task_branches (session_id) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_task_branches_repo_path ON task_branches (repo_path);
      CREATE INDEX IF NOT EXISTS idx_task_branches_status ON task_branches (status) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_task_branches_last_activity ON task_branches (last_activity_at) WHERE deleted_at IS NULL;
    `);
    oldDb.close();

    // Opening with openTaskBranchStore should apply migration
    const store = openTaskBranchStore(dbPath);
    const created = store.create(makeInput({ sessionId: "sess-migrate" }));
    store.updatePrAssociation({
      taskBranchId: created.id,
      prNumber: 1,
      prUrl: "https://github.com/org/repo/pull/1",
      prTitle: "Migrated PR",
    });

    const found = store.findById(created.id);
    expect(found?.prNumber).toBe(1);
    expect(found?.prTitle).toBe("Migrated PR");

    store.close();
    cleanupPath(dbPath);
  });
});

describe("index re-exports", () => {
  it("exports all public API from index", async () => {
    const indexModule = await import("../src/index");
    expect(indexModule.openTaskBranchStore).toBeDefined();
    expect(indexModule.mapRowToTaskBranch).toBeDefined();
    expect(indexModule.createWorktreeManager).toBeDefined();
    expect(indexModule.inferMissionLabel).toBeDefined();
    expect(indexModule.slugify).toBeDefined();
  });
});
