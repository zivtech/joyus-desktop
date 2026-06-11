import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Mock node:child_process for execGit tests ───────────────────────────────

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));
vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockStore = {
  create: vi.fn(),
  findById: vi.fn(),
  findBySessionId: vi.fn(),
  findByRepoPath: vi.fn().mockReturnValue([]),
  listAll: vi.fn().mockReturnValue([]),
  countsByRepo: vi.fn().mockReturnValue({}),
  updateStatus: vi.fn(),
  updateActivity: vi.fn(),
  updatePrAssociation: vi.fn(),
  softDelete: vi.fn(),
  applyStaleThreshold: vi.fn(),
  detectMerged: vi.fn(),
  scanIntegrity: vi.fn(),
  close: vi.fn(),
};

const mockDetector = {
  handleIpcEvent: vi.fn(),
  onModification: vi.fn(),
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
};

const mockSessionManager = {
  resume: vi.fn(),
  delete: vi.fn(),
  hasUncommittedChanges: vi.fn(),
  getMode: vi.fn().mockReturnValue("managed"),
  setMode: vi.fn(),
  initialize: vi.fn().mockResolvedValue(undefined),
  onFileModification: vi.fn(),
};

const mockDriftDetector = {
  observe: vi.fn().mockResolvedValue(null),
  dismiss: vi.fn(),
  getState: vi.fn(),
  clearSession: vi.fn(),
};

vi.mock("@joyus/session-manager", () => ({
  openTaskBranchStore: vi.fn(() => mockStore),
  FileModificationDetector: vi.fn(() => mockDetector),
  createWorktreeManager: vi.fn(() => ({})),
  createSessionManager: vi.fn(() => mockSessionManager),
  SessionBrokenError: class SessionBrokenError extends Error {
    constructor(public taskBranchId: string) {
      super(`Session worktree is broken: ${taskBranchId}`);
      this.name = "SessionBrokenError";
    }
  },
  UncommittedChangesError: class UncommittedChangesError extends Error {
    constructor(public taskBranchId: string) {
      super(`Session has uncommitted changes: ${taskBranchId}`);
      this.name = "UncommittedChangesError";
    }
  },
}));

vi.mock("@joyus/drift-detector", () => ({
  createDriftDetector: vi.fn(() => mockDriftDetector),
}));

// ─── Import under test (after mocks are hoisted) ─────────────────────────────

import {
  createSessionWiring,
  execGit,
  SessionBrokenError,
  UncommittedChangesError,
} from "../../src/sidecar/sessionWiring";
import { registerSessionMethods } from "../../src/sidecar/services";
import type { IpcHandler } from "../../src/sidecar/ipc-handler";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeIpc(): {
  ipc: IpcHandler;
  handlers: Map<string, (params: unknown) => Promise<unknown>>;
} {
  const handlers = new Map<string, (params: unknown) => Promise<unknown>>();
  const ipc: IpcHandler = {
    handleRequest: vi.fn() as never,
    registerMethod: vi.fn((name: string, handler: (params: unknown) => Promise<unknown>) => {
      handlers.set(name, handler);
    }),
    sendNotification: vi.fn() as never,
  };
  return { ipc, handlers };
}

async function makeWiring(sendNotification = vi.fn()) {
  return createSessionWiring({ sendNotification });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("createSessionWiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.listAll.mockReturnValue([]);
    mockSessionManager.initialize.mockResolvedValue(undefined);
    mockDriftDetector.observe.mockResolvedValue(null);
    mockDetector.onModification.mockImplementation(() => {});
  });

  it("returns all components", async () => {
    const wiring = await makeWiring();
    expect(wiring.sessionManager).toBeDefined();
    expect(wiring.store).toBeDefined();
    expect(wiring.detector).toBeDefined();
    expect(wiring.driftDetector).toBeDefined();
    expect(typeof wiring.shutdown).toBe("function");
  });

  it("calls sessionManager.initialize during construction", async () => {
    await makeWiring();
    expect(mockSessionManager.initialize).toHaveBeenCalledOnce();
  });

  it("registers a drift signal listener on the detector", async () => {
    await makeWiring();
    expect(mockDetector.onModification).toHaveBeenCalledOnce();
    expect(mockDetector.onModification).toHaveBeenCalledWith(expect.any(Function));
  });

  it("passes staleDays to createSessionManager when provided", async () => {
    const { createSessionManager: mockCSM } = await import("@joyus/session-manager");
    await createSessionWiring({ sendNotification: vi.fn(), staleDays: 7 });
    expect(mockCSM).toHaveBeenCalledWith(
      expect.objectContaining({ staleDays: 7 }),
    );
  });
});

describe("drift signal wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.listAll.mockReturnValue([]);
    mockSessionManager.initialize.mockResolvedValue(undefined);
    mockDriftDetector.observe.mockResolvedValue(null);
  });

  it("emits state.driftSignal when drift detector returns a signal", async () => {
    const sendNotification = vi.fn();
    let capturedListener: ((event: unknown) => Promise<void>) | undefined;
    mockDetector.onModification.mockImplementation((fn: (event: unknown) => Promise<void>) => {
      capturedListener = fn;
    });

    const fakeBranch = { id: "branch-1", createdAt: 1000, sessionId: "sess-1", status: "active" };
    mockStore.findBySessionId.mockReturnValue(fakeBranch);

    const fakeSignal = {
      taskBranchId: "branch-1",
      confidence: "high",
      heuristics: { directoryCount: 4, topicDomainCount: 3, elapsedMinutes: 35, thresholdsExceeded: 2, directoryThreshold: 3, directoryExceeded: true, topicDomainThreshold: 2, topicDomainExceeded: true, elapsedThresholdMinutes: 30, elapsedExceeded: true },
      explanation: null,
      generatedAt: Date.now(),
    };
    mockDriftDetector.observe.mockResolvedValue(fakeSignal);

    await createSessionWiring({ sendNotification });

    expect(capturedListener).toBeDefined();
    await capturedListener!({ sessionId: "sess-1", repoPath: "/repo", filePath: "src/foo.ts", detectedAt: Date.now(), source: "hook" });

    expect(sendNotification).toHaveBeenCalledWith("state.driftSignal", {
      taskBranchId: "branch-1",
      confidence: "high",
      heuristics: fakeSignal.heuristics,
      explanation: null,
    });
  });

  it("does not emit sendNotification when drift detector returns null", async () => {
    const sendNotification = vi.fn();
    let capturedListener: ((event: unknown) => Promise<void>) | undefined;
    mockDetector.onModification.mockImplementation((fn: (event: unknown) => Promise<void>) => {
      capturedListener = fn;
    });

    const fakeBranch = { id: "branch-1", createdAt: 1000, sessionId: "sess-1", status: "active" };
    mockStore.findBySessionId.mockReturnValue(fakeBranch);
    mockDriftDetector.observe.mockResolvedValue(null);

    await createSessionWiring({ sendNotification });

    await capturedListener!({ sessionId: "sess-1", repoPath: "/repo", filePath: "src/foo.ts", detectedAt: Date.now(), source: "hook" });

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("skips drift observation when session is not in store", async () => {
    const sendNotification = vi.fn();
    let capturedListener: ((event: unknown) => Promise<void>) | undefined;
    mockDetector.onModification.mockImplementation((fn: (event: unknown) => Promise<void>) => {
      capturedListener = fn;
    });

    mockStore.findBySessionId.mockReturnValue(undefined);

    await createSessionWiring({ sendNotification });

    await capturedListener!({ sessionId: "unknown", repoPath: "/repo", filePath: "src/foo.ts", detectedAt: Date.now(), source: "hook" });

    expect(mockDriftDetector.observe).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe("shutdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionManager.initialize.mockResolvedValue(undefined);
    mockDriftDetector.observe.mockResolvedValue(null);
    mockDetector.onModification.mockImplementation(() => {});
  });

  it("calls detector.stopPolling for all active branches", async () => {
    const activeBranches = [
      { id: "b1", sessionId: "s1", status: "active" },
      { id: "b2", sessionId: "s2", status: "active" },
    ];
    mockStore.listAll.mockReturnValue(activeBranches);

    const wiring = await makeWiring();
    await wiring.shutdown();

    expect(mockDetector.stopPolling).toHaveBeenCalledWith("s1");
    expect(mockDetector.stopPolling).toHaveBeenCalledWith("s2");
    expect(mockDetector.stopPolling).toHaveBeenCalledTimes(2);
  });

  it("skips stopPolling for non-active branches", async () => {
    const branches = [
      { id: "b1", sessionId: "s1", status: "stale" },
      { id: "b2", sessionId: "s2", status: "merged" },
      { id: "b3", sessionId: "s3", status: "active" },
    ];
    mockStore.listAll.mockReturnValue(branches);

    const wiring = await makeWiring();
    await wiring.shutdown();

    expect(mockDetector.stopPolling).toHaveBeenCalledTimes(1);
    expect(mockDetector.stopPolling).toHaveBeenCalledWith("s3");
  });

  it("completes without throwing when no active branches", async () => {
    mockStore.listAll.mockReturnValue([]);
    const wiring = await makeWiring();
    await expect(wiring.shutdown()).resolves.toBeUndefined();
    expect(mockDetector.stopPolling).not.toHaveBeenCalled();
  });
});

describe("registerSessionMethods", () => {
  let ipc: IpcHandler;
  let handlers: Map<string, (params: unknown) => Promise<unknown>>;
  let sendNotification: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockStore.listAll.mockReturnValue([]);
    mockSessionManager.initialize.mockResolvedValue(undefined);
    mockDriftDetector.observe.mockResolvedValue(null);
    mockDetector.onModification.mockImplementation(() => {});

    const made = makeIpc();
    ipc = made.ipc;
    handlers = made.handlers;
    sendNotification = vi.fn();

    const wiring = await createSessionWiring({ sendNotification });
    registerSessionMethods(ipc, wiring);
  });

  // --- session.fileModified ---

  it("session.fileModified: valid payload calls handleIpcEvent and returns ok", async () => {
    const handler = handlers.get("session.fileModified")!;
    const result = await handler({ sessionId: "s1", repoPath: "/repo", filePath: "src/a.ts" });
    expect(mockDetector.handleIpcEvent).toHaveBeenCalledWith({ sessionId: "s1", repoPath: "/repo", filePath: "src/a.ts" });
    expect(result).toEqual({ ok: true });
  });

  it("session.fileModified: missing sessionId throws", async () => {
    const handler = handlers.get("session.fileModified")!;
    await expect(handler({ repoPath: "/repo", filePath: "src/a.ts" })).rejects.toThrow(
      "session.fileModified: missing required field: sessionId",
    );
  });

  it("session.fileModified: missing repoPath throws", async () => {
    const handler = handlers.get("session.fileModified")!;
    await expect(handler({ sessionId: "s1", filePath: "src/a.ts" })).rejects.toThrow(
      "session.fileModified: missing required field: repoPath",
    );
  });

  it("session.fileModified: missing filePath throws", async () => {
    const handler = handlers.get("session.fileModified")!;
    await expect(handler({ sessionId: "s1", repoPath: "/repo" })).rejects.toThrow(
      "session.fileModified: missing required field: filePath",
    );
  });

  it("session.fileModified: non-object params throws", async () => {
    const handler = handlers.get("session.fileModified")!;
    await expect(handler("not an object")).rejects.toThrow(
      "session.fileModified: params must be an object",
    );
  });

  // --- session.list ---

  it("session.list: returns store.listAll result", async () => {
    const branches = [{ id: "b1" }, { id: "b2" }];
    mockStore.listAll.mockReturnValue(branches);
    const handler = handlers.get("session.list")!;
    const result = await handler(undefined);
    expect(result).toEqual(branches);
  });

  // --- session.resume ---

  it("session.resume: returns updated branch on success", async () => {
    const branch = { id: "b1", sessionId: "s1", status: "active" };
    mockSessionManager.resume.mockResolvedValue(branch);
    const handler = handlers.get("session.resume")!;
    const result = await handler({ taskBranchId: "b1" });
    expect(result).toEqual(branch);
  });

  it("session.resume: SessionBrokenError returns structured error response", async () => {
    mockSessionManager.resume.mockRejectedValue(new SessionBrokenError("b1"));
    const handler = handlers.get("session.resume")!;
    const result = await handler({ taskBranchId: "b1" });
    expect(result).toEqual({ error: "broken", message: expect.stringContaining("b1") });
  });

  it("session.resume: missing taskBranchId throws", async () => {
    const handler = handlers.get("session.resume")!;
    await expect(handler({})).rejects.toThrow("Missing required param: taskBranchId");
  });

  // --- session.delete ---

  it("session.delete: returns ok on success", async () => {
    mockSessionManager.delete.mockResolvedValue(undefined);
    const handler = handlers.get("session.delete")!;
    const result = await handler({ taskBranchId: "b1", force: false });
    expect(mockSessionManager.delete).toHaveBeenCalledWith("b1", { force: false });
    expect(result).toEqual({ ok: true });
  });

  it("session.delete: UncommittedChangesError returns structured error response", async () => {
    mockSessionManager.delete.mockRejectedValue(new UncommittedChangesError("b1"));
    const handler = handlers.get("session.delete")!;
    const result = await handler({ taskBranchId: "b1", force: false });
    expect(result).toEqual({ error: "uncommitted_changes" });
  });

  it("session.delete: force:true passed through to sessionManager", async () => {
    mockSessionManager.delete.mockResolvedValue(undefined);
    const handler = handlers.get("session.delete")!;
    await handler({ taskBranchId: "b1", force: true });
    expect(mockSessionManager.delete).toHaveBeenCalledWith("b1", { force: true });
  });

  it("session.delete: missing taskBranchId throws", async () => {
    const handler = handlers.get("session.delete")!;
    await expect(handler({})).rejects.toThrow("Missing required param: taskBranchId");
  });

  // --- session.hasUncommittedChanges ---

  it("session.hasUncommittedChanges: returns result from sessionManager", async () => {
    mockSessionManager.hasUncommittedChanges.mockResolvedValue(true);
    const handler = handlers.get("session.hasUncommittedChanges")!;
    const result = await handler({ taskBranchId: "b1" });
    expect(result).toEqual({ hasUncommittedChanges: true });
  });

  // --- session.getMode ---

  it("session.getMode: returns mode from sessionManager", async () => {
    mockSessionManager.getMode.mockReturnValue("advisory");
    const handler = handlers.get("session.getMode")!;
    const result = await handler({ repoPath: "/repo" });
    expect(mockSessionManager.getMode).toHaveBeenCalledWith("/repo");
    expect(result).toEqual({ mode: "advisory" });
  });

  it("session.getMode: returns global mode when no repoPath", async () => {
    mockSessionManager.getMode.mockReturnValue("managed");
    const handler = handlers.get("session.getMode")!;
    const result = await handler({});
    expect(mockSessionManager.getMode).toHaveBeenCalledWith(undefined);
    expect(result).toEqual({ mode: "managed" });
  });

  // --- session.setMode ---

  it("session.setMode: sets mode and returns ok", async () => {
    const handler = handlers.get("session.setMode")!;
    const result = await handler({ mode: "advisory", repoPath: "/repo" });
    expect(mockSessionManager.setMode).toHaveBeenCalledWith("advisory", "/repo");
    expect(result).toEqual({ ok: true });
  });

  it("session.setMode: managed mode sets global when no repoPath", async () => {
    const handler = handlers.get("session.setMode")!;
    await handler({ mode: "managed" });
    expect(mockSessionManager.setMode).toHaveBeenCalledWith("managed", undefined);
  });

  it("session.setMode: invalid mode throws", async () => {
    const handler = handlers.get("session.setMode")!;
    await expect(handler({ mode: "invalid" })).rejects.toThrow(
      `session.setMode: invalid mode "invalid". Must be 'managed' or 'advisory'`,
    );
  });

  it("session.resume: non-SessionBrokenError is re-thrown", async () => {
    mockSessionManager.resume.mockRejectedValue(new Error("unexpected error"));
    const handler = handlers.get("session.resume")!;
    await expect(handler({ taskBranchId: "b1" })).rejects.toThrow("unexpected error");
  });

  it("session.delete: non-UncommittedChangesError is re-thrown", async () => {
    mockSessionManager.delete.mockRejectedValue(new Error("delete failed"));
    const handler = handlers.get("session.delete")!;
    await expect(handler({ taskBranchId: "b1", force: false })).rejects.toThrow("delete failed");
  });

  // --- session.listByRepo ---

  it("session.listByRepo: returns branches for given repoPath", async () => {
    const branches = [{ id: "b1", repoPath: "/repo/a" }];
    mockStore.findByRepoPath.mockReturnValue(branches);
    const handler = handlers.get("session.listByRepo")!;
    const result = await handler({ repoPath: "/repo/a" });
    expect(mockStore.findByRepoPath).toHaveBeenCalledWith("/repo/a");
    expect(result).toEqual(branches);
  });

  it("session.listByRepo: missing repoPath throws", async () => {
    const handler = handlers.get("session.listByRepo")!;
    await expect(handler({})).rejects.toThrow("Missing required param: repoPath");
  });

  it("session.listByRepo: non-object params throws", async () => {
    const handler = handlers.get("session.listByRepo")!;
    await expect(handler(null)).rejects.toThrow("Missing required param: repoPath");
  });

  // --- session.countsByRepo ---

  it("session.countsByRepo: returns aggregated counts", async () => {
    const counts = { "/repo/a": { active: 2, total: 3, lastActivityAt: 1000 } };
    mockStore.countsByRepo.mockReturnValue(counts);
    const handler = handlers.get("session.countsByRepo")!;
    const result = await handler({});
    expect(mockStore.countsByRepo).toHaveBeenCalled();
    expect(result).toEqual(counts);
  });
});

// ─── execGit ─────────────────────────────────────────────────────────────────

describe("execGit", () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it("calls git with provided args and returns stdout/stderr", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, callback: (err: null, result: { stdout: string; stderr: string }) => void) => {
        callback(null, { stdout: "main\n", stderr: "" });
      },
    );
    const result = await execGit(["branch", "--show-current"]);
    expect(mockExecFile).toHaveBeenCalledWith(
      "git",
      ["branch", "--show-current"],
      expect.objectContaining({}),
      expect.any(Function),
    );
    expect(result).toEqual({ stdout: "main\n", stderr: "" });
  });

  it("passes cwd option when provided", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], opts: { cwd?: string }, callback: (err: null, result: { stdout: string; stderr: string }) => void) => {
        callback(null, { stdout: "", stderr: "" });
        void opts;
      },
    );
    await execGit(["status"], "/some/repo");
    expect(mockExecFile).toHaveBeenCalledWith(
      "git",
      ["status"],
      expect.objectContaining({ cwd: "/some/repo" }),
      expect.any(Function),
    );
  });

  it("rejects when git command fails", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, callback: (err: Error) => void) => {
        callback(new Error("git error"));
      },
    );
    await expect(execGit(["invalid-cmd"])).rejects.toThrow("git error");
  });
});
