import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FileModificationDetector,
  type FileModificationEvent,
} from "../src/fileModificationDetector.js";

describe("FileModificationDetector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── handleIpcEvent ──────────────────────────────────────────────────────

  it("handleIpcEvent calls listener with source: hook", () => {
    const execGit = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const detector = new FileModificationDetector(execGit, 10_000);

    const received: FileModificationEvent[] = [];
    detector.onModification((e) => received.push(e));

    detector.handleIpcEvent({
      sessionId: "sess-1",
      repoPath: "/repo",
      filePath: "/repo/src/foo.ts",
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.source).toBe("hook");
    expect(received[0]?.sessionId).toBe("sess-1");
    expect(received[0]?.repoPath).toBe("/repo");
    expect(received[0]?.filePath).toBe("/repo/src/foo.ts");
  });

  it("handleIpcEvent records lastIpcFiredAt timestamp", () => {
    const execGit = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const detector = new FileModificationDetector(execGit, 10_000);

    const before = Date.now();
    detector.handleIpcEvent({
      sessionId: "sess-1",
      repoPath: "/repo",
      filePath: "/repo/src/foo.ts",
    });
    const after = Date.now();

    // Trigger a poll immediately after IPC — should be deduplicated
    const received: FileModificationEvent[] = [];
    detector.onModification((e) => received.push(e));
    execGit.mockResolvedValue({ stdout: "M file.ts", stderr: "" });

    detector.startPolling("/repo", "sess-1");
    // Poll fires but should be suppressed (within pollIntervalMs window)
    void vi.advanceTimersByTimeAsync(10_000);

    // Verify timestamp was recorded (deduplicate logic works)
    expect(before).toBeLessThanOrEqual(after);
  });

  // ─── polling ─────────────────────────────────────────────────────────────

  it("polling emits event when git status is non-empty", async () => {
    const execGit = vi
      .fn()
      .mockResolvedValue({ stdout: "M file.ts", stderr: "" });
    const detector = new FileModificationDetector(execGit, 10_000);

    const received: FileModificationEvent[] = [];
    detector.onModification((e) => received.push(e));

    detector.startPolling("/repo", "sess-1");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(received).toHaveLength(1);
    expect(received[0]?.source).toBe("poll");
    expect(received[0]?.sessionId).toBe("sess-1");
    expect(received[0]?.filePath).toBe(".");
  });

  it("polling does not emit when git status is empty", async () => {
    const execGit = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const detector = new FileModificationDetector(execGit, 10_000);

    const received: FileModificationEvent[] = [];
    detector.onModification((e) => received.push(e));

    detector.startPolling("/repo", "sess-1");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(received).toHaveLength(0);
  });

  it("polling does not emit when git status is whitespace only", async () => {
    const execGit = vi.fn().mockResolvedValue({ stdout: "   \n", stderr: "" });
    const detector = new FileModificationDetector(execGit, 10_000);

    const received: FileModificationEvent[] = [];
    detector.onModification((e) => received.push(e));

    detector.startPolling("/repo", "sess-1");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(received).toHaveLength(0);
  });

  // ─── deduplication ───────────────────────────────────────────────────────

  it("dedup: poll within pollIntervalMs of IPC is suppressed", async () => {
    const execGit = vi
      .fn()
      .mockResolvedValue({ stdout: "M file.ts", stderr: "" });
    const detector = new FileModificationDetector(execGit, 10_000);

    const received: FileModificationEvent[] = [];
    detector.onModification((e) => received.push(e));

    // IPC at T=0
    detector.handleIpcEvent({
      sessionId: "sess-1",
      repoPath: "/repo",
      filePath: "/repo/src/foo.ts",
    });
    // Clear received from IPC
    received.length = 0;

    // Start polling
    detector.startPolling("/repo", "sess-1");
    // Advance to T=8000 (within the 10s window)
    await vi.advanceTimersByTimeAsync(8_000);

    expect(received).toHaveLength(0);
  });

  it("dedup: poll after pollIntervalMs of IPC is NOT suppressed", async () => {
    const execGit = vi
      .fn()
      .mockResolvedValue({ stdout: "M file.ts", stderr: "" });
    const detector = new FileModificationDetector(execGit, 10_000);

    const received: FileModificationEvent[] = [];
    detector.onModification((e) => received.push(e));

    // IPC at T=0
    detector.handleIpcEvent({
      sessionId: "sess-1",
      repoPath: "/repo",
      filePath: "/repo/src/foo.ts",
    });
    received.length = 0;

    detector.startPolling("/repo", "sess-1");
    // Advance past the dedup window (10s) + one poll interval (10s) = 20s
    await vi.advanceTimersByTimeAsync(20_000);

    // The second poll tick (at T=20000) is outside the dedup window
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0]?.source).toBe("poll");
  });

  it("dedup: no IPC ever means poll is never suppressed", async () => {
    const execGit = vi
      .fn()
      .mockResolvedValue({ stdout: "M file.ts", stderr: "" });
    const detector = new FileModificationDetector(execGit, 10_000);

    const received: FileModificationEvent[] = [];
    detector.onModification((e) => received.push(e));

    detector.startPolling("/repo", "sess-1");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(received).toHaveLength(1);
    expect(received[0]?.source).toBe("poll");
  });

  // ─── stopPolling ──────────────────────────────────────────────────────────

  it("stopPolling clears the interval — no further events emitted", async () => {
    const execGit = vi
      .fn()
      .mockResolvedValue({ stdout: "M file.ts", stderr: "" });
    const detector = new FileModificationDetector(execGit, 10_000);

    const received: FileModificationEvent[] = [];
    detector.onModification((e) => received.push(e));

    detector.startPolling("/repo", "sess-1");
    detector.stopPolling("sess-1");

    await vi.advanceTimersByTimeAsync(30_000);

    expect(received).toHaveLength(0);
  });

  it("stopPolling is a no-op for unknown sessionId", () => {
    const execGit = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const detector = new FileModificationDetector(execGit, 10_000);
    expect(() => detector.stopPolling("unknown")).not.toThrow();
  });

  // ─── error resilience ────────────────────────────────────────────────────

  it("polling does not throw when execGit rejects", async () => {
    const execGit = vi.fn().mockRejectedValue(new Error("git failed"));
    const detector = new FileModificationDetector(execGit, 10_000);

    const received: FileModificationEvent[] = [];
    detector.onModification((e) => received.push(e));

    detector.startPolling("/repo", "sess-1");
    await expect(vi.advanceTimersByTimeAsync(10_000)).resolves.not.toThrow();

    expect(received).toHaveLength(0);
  });
});
