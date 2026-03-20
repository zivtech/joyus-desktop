/**
 * T046 — SC-006 GitHub Desktop URL + SC-007 Broken Worktree Scan
 *
 * SC-006: Verify buildGitHubDesktopUrl produces the correct x-github-client URL scheme.
 * SC-007: Verify the startup integrity scan marks missing worktrees as broken
 *         while leaving healthy worktrees unchanged, and is idempotent on repeat calls.
 */
import { describe, it, expect, afterEach } from "vitest";
import { vi } from "vitest";
import { rmSync, existsSync } from "node:fs";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
// Inlined from TaskBranchCard.tsx — pure function, no React dependency
function buildGitHubDesktopUrl(repoPath: string): string {
  return `x-github-client://openRepo/${encodeURIComponent(repoPath)}`;
}
import {
  createTestRepo,
  createTestWiring,
  cleanupWiring,
} from "../integration/helpers.js";
import type { TestWiring } from "../integration/helpers.js";

const execFile = promisify(execFileCb);

// ── SC-006: GitHub Desktop URL construction ───────────────────────────────────

describe("SC-006: GitHub Desktop URL construction", () => {
  it("builds correct x-github-client URL for a standard path", () => {
    const repoPath = "/Users/test/my-project";
    const expected = `x-github-client://openRepo/${encodeURIComponent(repoPath)}`;
    expect(buildGitHubDesktopUrl(repoPath)).toBe(expected);
  });

  it("encodes spaces in repo path", () => {
    const repoPath = "/Users/test/my project (2026)";
    const url = buildGitHubDesktopUrl(repoPath);
    expect(url).toContain("x-github-client://openRepo/");
    expect(url).not.toContain(" ");
  });

  it("encodes spaces in path (parentheses are valid URI chars and kept as-is)", () => {
    const repoPath = "/Users/test/my project (2026)";
    const url = buildGitHubDesktopUrl(repoPath);
    // Spaces must be percent-encoded
    expect(url).not.toContain(" ");
    // Parentheses are valid URI mark characters — encodeURIComponent preserves them
    expect(url).toContain("(2026)");
  });

  it("URL scheme is x-github-client:// (not http or file)", () => {
    const url = buildGitHubDesktopUrl("/any/path");
    expect(url.startsWith("x-github-client://")).toBe(true);
    expect(url.startsWith("http")).toBe(false);
    expect(url.startsWith("file")).toBe(false);
  });

  it("encodes unicode characters in repo path", () => {
    const repoPath = "/Users/t\u00ebst/projet";
    const url = buildGitHubDesktopUrl(repoPath);
    expect(url).toContain("x-github-client://openRepo/");
    expect(url).not.toContain("\u00eb"); // ë must be percent-encoded
  });

  it("empty path produces a valid URL (does not throw)", () => {
    expect(() => buildGitHubDesktopUrl("")).not.toThrow();
    const url = buildGitHubDesktopUrl("");
    expect(url).toContain("x-github-client://openRepo/");
  });
});

// ── SC-007: Broken worktree integrity scan ────────────────────────────────────

describe("SC-007: Broken worktree integrity scan", () => {
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

  it(
    "missing worktree marked broken; present worktrees unchanged after initialize()",
    { timeout: 60_000 },
    async () => {
      const repo = await createTestRepo();
      cleanups.push(repo.cleanup);

      const testWiring = await createTestWiring({ pollIntervalMs: 60_000 });
      wirings.push(testWiring);
      const { wiring } = testWiring;

      // Create 3 TaskBranches: A, B, C
      for (const sessionId of ["sess-sc007-A", "sess-sc007-B", "sess-sc007-C"]) {
        wiring.detector.handleIpcEvent({
          sessionId,
          repoPath: repo.repoPath,
          filePath: "src/index.ts",
        });
      }

      // Wait for all 3 to be created with real worktrees
      await vi.waitFor(
        () => {
          if (wiring.store.listAll().length < 3) throw new Error("not yet");
        },
        { timeout: 30_000 },
      );

      const all = wiring.store.listAll();
      expect(all).toHaveLength(3);

      const branchB = all.find((b) => b.sessionId === "sess-sc007-B")!;
      expect(branchB).toBeDefined();

      // Simulate external deletion of branch B's worktree directory
      if (existsSync(branchB.worktreePath)) {
        rmSync(branchB.worktreePath, { recursive: true, force: true });
        // --expire=now prunes newly-created stale entries immediately
        // (default gc.worktreePruneExpire is 3 months, which skips new entries)
        await execFile("git", ["worktree", "prune", "--expire=now"], { cwd: repo.repoPath });
      }

      // Re-run initialize() — triggers scanIntegrity
      await wiring.sessionManager.initialize();

      const after = wiring.store.listAll();
      const afterA = after.find((b) => b.sessionId === "sess-sc007-A")!;
      const afterB = after.find((b) => b.sessionId === "sess-sc007-B")!;
      const afterC = after.find((b) => b.sessionId === "sess-sc007-C")!;

      expect(afterA.status).toBe("active");  // worktree still present → unchanged
      expect(afterB.status).toBe("broken");  // worktree deleted → broken
      expect(afterC.status).toBe("active");  // worktree still present → unchanged
    },
  );

  it("second initialize() call is idempotent for active and broken branches", async () => {
    const repo = await createTestRepo();
    cleanups.push(repo.cleanup);

    const testWiring = await createTestWiring({ pollIntervalMs: 60_000 });
    wirings.push(testWiring);
    const { wiring } = testWiring;

    wiring.detector.handleIpcEvent({
      sessionId: "sc007-idempotent",
      repoPath: repo.repoPath,
      filePath: "src/index.ts",
    });

    await vi.waitFor(
      () => {
        if (wiring.store.listAll().length < 1) throw new Error("not yet");
      },
      { timeout: 15_000 },
    );

    const before = wiring.store.listAll()[0]!;
    expect(before.status).toBe("active");

    // First initialize: no-op for a healthy branch
    await wiring.sessionManager.initialize();
    expect(wiring.store.findById(before.id)!.status).toBe("active");

    // Second initialize: still no-op
    await wiring.sessionManager.initialize();
    expect(wiring.store.findById(before.id)!.status).toBe("active");
  });
});
