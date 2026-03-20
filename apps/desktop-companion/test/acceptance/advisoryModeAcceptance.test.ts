/**
 * T045 — SC-005: Advisory Mode Exhaustive Acceptance
 *
 * Asserts zero automatic git operations in advisory mode across every
 * code path in the session lifecycle, and verifies that switching back
 * to managed mode restores normal behaviour.
 */
import { describe, it, expect, afterEach } from "vitest";
import { vi } from "vitest";
import {
  createTestRepo,
  createTestWiring,
  cleanupWiring,
} from "../integration/helpers.js";
import type { TestWiring } from "../integration/helpers.js";

describe("SC-005: Advisory mode — exhaustive acceptance", () => {
  let cleanups: Array<() => void> = [];
  let wirings: TestWiring[] = [];

  afterEach(async () => {
    for (const w of wirings) {
      await w.wiring.shutdown();
      w.wiring.store.close();
      cleanupWiring(w, w.dbDir);
    }
    for (const c of cleanups) {
      c();
    }
    cleanups = [];
    wirings = [];
  });

  it("zero TaskBranches auto-created when advisory mode set before any events", async () => {
    const repo = await createTestRepo();
    cleanups.push(repo.cleanup);

    const testWiring = await createTestWiring({ pollIntervalMs: 60_000 });
    wirings.push(testWiring);
    const { wiring, notifications } = testWiring;

    // Set advisory mode before any events fire
    wiring.sessionManager.setMode("advisory");
    expect(wiring.sessionManager.getMode()).toBe("advisory");

    // Fire 10 IPC events across varied domains and directories
    const paths = [
      "src/index.ts",
      "src/components/App.tsx",
      "docs/readme.md",
      "api/routes/users.ts",
      "auth/login.ts",
      "scripts/build.sh",
      "config/env.ts",
      "test/unit/foo.ts",
      "data/schema.sql",
      "lib/util.ts",
    ];
    for (const filePath of paths) {
      wiring.detector.handleIpcEvent({
        sessionId: "advisory-exhaustive-session",
        repoPath: repo.repoPath,
        filePath,
      });
    }

    // Allow async handlers to settle (they should all be no-ops in advisory mode)
    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    // No TaskBranches created
    expect(wiring.store.listAll()).toHaveLength(0);

    // No drift signals or session notifications emitted
    const sessionRelatedNotifications = notifications.filter(
      (n) => n.method === "state.driftSignal" || n.method === "state.sessionCreated",
    );
    expect(sessionRelatedNotifications).toHaveLength(0);
  });

  it("getMode() returns 'advisory' consistently; store reads are safe", async () => {
    const repo = await createTestRepo();
    cleanups.push(repo.cleanup);

    const testWiring = await createTestWiring({ pollIntervalMs: 60_000 });
    wirings.push(testWiring);
    const { wiring } = testWiring;

    wiring.sessionManager.setMode("advisory");

    expect(wiring.sessionManager.getMode()).toBe("advisory");
    // Reading store in advisory mode must not crash
    expect(wiring.store.listAll()).toHaveLength(0);
    // Reading mode again is stable
    expect(wiring.sessionManager.getMode()).toBe("advisory");
  });

  it("initialize() in advisory mode creates no TaskBranches from scratch", async () => {
    const repo = await createTestRepo();
    cleanups.push(repo.cleanup);

    const testWiring = await createTestWiring({ pollIntervalMs: 60_000 });
    wirings.push(testWiring);
    const { wiring } = testWiring;

    wiring.sessionManager.setMode("advisory");

    // initialize() runs scanIntegrity, applyStaleThreshold, detectMerged —
    // none of these should create new TaskBranches
    await wiring.sessionManager.initialize();
    expect(wiring.store.listAll()).toHaveLength(0);
  });

  it("explicit mode switch to managed causes next event to create a TaskBranch", async () => {
    const repo = await createTestRepo();
    cleanups.push(repo.cleanup);

    const testWiring = await createTestWiring({ pollIntervalMs: 60_000 });
    wirings.push(testWiring);
    const { wiring } = testWiring;

    // Start in advisory — event is suppressed
    wiring.sessionManager.setMode("advisory");
    wiring.detector.handleIpcEvent({
      sessionId: "before-switch",
      repoPath: repo.repoPath,
      filePath: "src/index.ts",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    expect(wiring.store.listAll()).toHaveLength(0);

    // Switch to managed
    wiring.sessionManager.setMode("managed");
    expect(wiring.sessionManager.getMode()).toBe("managed");

    // New event with a different sessionId → TaskBranch IS created
    wiring.detector.handleIpcEvent({
      sessionId: "after-switch",
      repoPath: repo.repoPath,
      filePath: "src/index.ts",
    });

    await vi.waitFor(
      () => {
        const b = wiring.store.findBySessionId("after-switch");
        if (b === undefined) throw new Error("not yet");
        return b;
      },
      { timeout: 15_000 },
    );

    const all = wiring.store.listAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.sessionId).toBe("after-switch");

    // The advisory-mode event never created a TaskBranch
    expect(wiring.store.findBySessionId("before-switch")).toBeUndefined();
  });
});
