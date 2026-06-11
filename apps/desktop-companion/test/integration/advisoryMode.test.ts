/**
 * WP06 Integration Tests — Advisory Mode
 * SC-005: Advisory mode zero auto-ops
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionNotFoundError } from "@joyus/session-manager";
import {
  createTestRepo,
  createTestWiring,
  cleanupWiring,
} from "./helpers.js";
import type { TestWiring } from "./helpers.js";

describe("SC-005: Advisory mode zero auto-ops", () => {
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

  it("does not create TaskBranches or fire notifications in advisory mode", async () => {
    const { wiring, notifications } = testWiring;

    wiring.sessionManager.setMode("advisory");

    const paths = [
      "src/index.ts",
      "src/app.ts",
      "api/routes/users.ts",
      "api/routes/orders.ts",
      "api/routes/products.ts",
      "docs/README.md",
      "config/env.ts",
      "config/database.ts",
      "tests/unit/app.test.ts",
      "scripts/build.sh",
    ];

    for (const filePath of paths) {
      wiring.detector.handleIpcEvent({
        sessionId: "advisory-session",
        repoPath,
        filePath,
      });
    }

    // Allow any async work to settle
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(wiring.store.listAll().length).toBe(0);
    expect(wiring.store.findBySessionId("advisory-session")).toBeUndefined();
    expect(notifications.length).toBe(0);
    expect(wiring.sessionManager.getMode()).toBe("advisory");
  });

  it("throws SessionNotFoundError when resuming a nonexistent session in advisory mode", async () => {
    const { wiring } = testWiring;

    wiring.sessionManager.setMode("advisory");

    await expect(
      wiring.sessionManager.resume("nonexistent"),
    ).rejects.toThrow(SessionNotFoundError);
  });
});
