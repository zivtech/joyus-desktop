/**
 * WP06 Integration Tests — Session Lifecycle
 * SC-001 through SC-004
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFile as execFileCb } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);
import {
  createTestRepo,
  createTestWiring,
  cleanupWiring,
} from "./helpers.js";
import type { TestWiring } from "./helpers.js";

// ---------------------------------------------------------------------------
// SC-001: Worktree created on first file modification
// ---------------------------------------------------------------------------

describe("SC-001: Worktree created on first file modification", () => {
  let repoPath: string;
  let cleanup: () => void;
  let testWiring: TestWiring;

  beforeEach(async () => {
    const repo = await createTestRepo();
    repoPath = repo.repoPath;
    cleanup = repo.cleanup;
    testWiring = await createTestWiring();
  });

  afterEach(async () => {
    await testWiring.wiring.shutdown();
    testWiring.wiring.store.close();
    cleanup();
    cleanupWiring(testWiring, testWiring.dbDir);
  });

  it("creates a worktree and TaskBranch on first IPC event", async () => {
    const { wiring, notifications } = testWiring;

    wiring.detector.handleIpcEvent({
      sessionId: "session-001",
      repoPath,
      filePath: "src/index.ts",
    });

    const branch = await vi.waitFor(
      () => {
        const b = wiring.store.findBySessionId("session-001");
        if (b === undefined) throw new Error("not yet");
        return b;
      },
      { timeout: 10000 },
    );

    expect(branch.status).toBe("active");
    expect(existsSync(branch.worktreePath)).toBe(true);
    expect(branch.branchName.startsWith("joyus/")).toBe(true);
    expect(notifications.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SC-002: Drift signal fires for multi-domain sessions
// ---------------------------------------------------------------------------

describe("SC-002: Drift signal fires for multi-domain sessions", () => {
  let repoPath: string;
  let cleanup: () => void;
  let testWiring: TestWiring;

  beforeEach(async () => {
    const repo = await createTestRepo();
    repoPath = repo.repoPath;
    cleanup = repo.cleanup;
    testWiring = await createTestWiring();
  });

  afterEach(async () => {
    await testWiring.wiring.shutdown();
    testWiring.wiring.store.close();
    cleanup();
    cleanupWiring(testWiring, testWiring.dbDir);
  });

  it("emits state.driftSignal with high confidence after multi-domain edits", async () => {
    const { wiring, notifications } = testWiring;

    // Create the TaskBranch via first event
    wiring.detector.handleIpcEvent({
      sessionId: "session-002",
      repoPath,
      filePath: "src/components/Button.tsx",
    });

    // Wait for TaskBranch to be created
    const branch = await vi.waitFor(
      () => {
        const b = wiring.store.findBySessionId("session-002");
        if (b === undefined) throw new Error("not yet");
        return b;
      },
      { timeout: 10000 },
    );

    // Fire 5 more events across different domains
    const additionalPaths = [
      "src/components/Modal.tsx",
      "api/routes/users.ts",
      "api/routes/orders.ts",
      "docs/README.md",
      "config/env.ts",
    ];
    for (const filePath of additionalPaths) {
      wiring.detector.handleIpcEvent({
        sessionId: "session-002",
        repoPath,
        filePath,
      });
    }

    // Wait for high-confidence drift signal
    await vi.waitFor(
      () => {
        const hasSignal = notifications.some(
          (n) =>
            n.method === "state.driftSignal" &&
            (n.params as { confidence: string }).confidence === "high",
        );
        if (!hasSignal) throw new Error("no high-confidence drift signal yet");
      },
      { timeout: 10000 },
    );

    const signal = notifications.find(
      (n) =>
        n.method === "state.driftSignal" &&
        (n.params as { confidence: string }).confidence === "high",
    );
    expect(signal).toBeDefined();
    expect((signal!.params as { taskBranchId: string }).taskBranchId).toBe(
      branch.id,
    );
  });
});

// ---------------------------------------------------------------------------
// SC-003: Stale detection and cleanup
// ---------------------------------------------------------------------------

describe("SC-003: Stale detection and cleanup", () => {
  let repoPath: string;
  let cleanup: () => void;
  let testWiring: TestWiring;

  beforeEach(async () => {
    const repo = await createTestRepo();
    repoPath = repo.repoPath;
    cleanup = repo.cleanup;
    testWiring = await createTestWiring({ staleDays: 14 });
  });

  afterEach(async () => {
    await testWiring.wiring.shutdown();
    testWiring.wiring.store.close();
    cleanup();
    cleanupWiring(testWiring, testWiring.dbDir);
  });

  it("marks branch stale after threshold and removes worktree on delete", async () => {
    const { wiring } = testWiring;

    wiring.detector.handleIpcEvent({
      sessionId: "session-003",
      repoPath,
      filePath: "src/index.ts",
    });

    const branch = await vi.waitFor(
      () => {
        const b = wiring.store.findBySessionId("session-003");
        if (b === undefined) throw new Error("not yet");
        return b;
      },
      { timeout: 10000 },
    );

    // Set lastActivityAt to 15 days ago (past the 14-day threshold)
    wiring.store.updateActivity({
      taskBranchId: branch.id,
      lastActivityAt: Date.now() - 15 * 24 * 60 * 60 * 1000,
    });

    // Apply stale threshold directly (14-day cutoff)
    wiring.store.applyStaleThreshold(Date.now() - 14 * 24 * 60 * 60 * 1000);

    expect(wiring.store.findById(branch.id)!.status).toBe("stale");

    // Force-delete the stale session
    await wiring.sessionManager.delete(branch.id, { force: true });

    // Record is soft-deleted (findById filters deleted_at IS NULL)
    expect(wiring.store.findById(branch.id)).toBeUndefined();
    expect(wiring.store.listAll().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SC-004: Session resumption
// ---------------------------------------------------------------------------

describe("SC-004: Session resumption", () => {
  let repoPath: string;
  let cleanup: () => void;
  let testWiring: TestWiring;

  beforeEach(async () => {
    const repo = await createTestRepo();
    repoPath = repo.repoPath;
    cleanup = repo.cleanup;
    testWiring = await createTestWiring();
  });

  afterEach(async () => {
    await testWiring.wiring.shutdown();
    testWiring.wiring.store.close();
    cleanup();
    cleanupWiring(testWiring, testWiring.dbDir);
  });

  it("resumes an existing session without creating a new worktree", async () => {
    const { wiring } = testWiring;

    wiring.detector.handleIpcEvent({
      sessionId: "session-004",
      repoPath,
      filePath: "src/index.ts",
    });

    const branch = await vi.waitFor(
      () => {
        const b = wiring.store.findBySessionId("session-004");
        if (b === undefined) throw new Error("not yet");
        return b;
      },
      { timeout: 10000 },
    );

    const resumed = await wiring.sessionManager.resume(branch.id);

    expect(resumed.status).toBe("active");
    expect(resumed.worktreePath).toBe(branch.worktreePath);
    expect(wiring.store.listAll().length).toBe(1);
  });
});
