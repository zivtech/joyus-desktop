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
    store.create(
      makeInput({
        sessionId: "sess-integrity-healthy",
        worktreePath: "/repo/.joyus-worktrees/healthy",
        repoPath: "/repo",
      }),
    );

    const execGit: ExecGit = vi.fn().mockResolvedValue({
      stdout:
        "worktree /repo\n\nworktree /repo/.joyus-worktrees/healthy\n\n",
      stderr: "",
    });

    await store.scanIntegrity(execGit);

    const found = store.findBySessionId("sess-integrity-healthy");
    expect(found?.status).toBe("active");
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
    store.create(
      makeInput({
        sessionId: "sess-integrity-error",
        worktreePath: "/repo/.joyus-worktrees/error-wt",
        repoPath: "/repo",
      }),
    );

    const execGit: ExecGit = vi
      .fn()
      .mockRejectedValue(new Error("git error"));

    await store.scanIntegrity(execGit);

    // When execGit fails, isWorktreeHealthy returns false → broken
    const found = store.findBySessionId("sess-integrity-error");
    expect(found?.status).toBe("broken");
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
