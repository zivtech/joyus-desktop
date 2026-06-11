import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  openTaskBranchStore,
  FileModificationDetector,
  createWorktreeManager,
  createSessionManager,
  SessionBrokenError,
  UncommittedChangesError,
} from "@joyus/session-manager";
import type { TaskBranchStore, SessionManager } from "@joyus/session-manager";
import { createDriftDetector } from "@joyus/drift-detector";
import type { DriftDetector } from "@joyus/drift-detector";

const execFileAsync = promisify(execFile);

export async function execGit(
  args: string[],
  cwd?: string,
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync("git", args, { cwd });
  return { stdout: result.stdout, stderr: result.stderr };
}

// ─── Public surface ───────────────────────────────────────────────────────────

export interface SessionWiringDeps {
  sendNotification: (method: string, params: unknown) => void;
  dbPath?: string;
  pollIntervalMs?: number;
  staleDays?: number;
}

export interface SessionWiring {
  sessionManager: SessionManager;
  store: TaskBranchStore;
  detector: FileModificationDetector;
  driftDetector: DriftDetector;
  shutdown: () => Promise<void>;
}

// Re-export errors so services.ts can use them without importing session-manager directly
export { SessionBrokenError, UncommittedChangesError };

// ─── Factory ──────────────────────────────────────────────────────────────────

export async function createSessionWiring(
  deps: SessionWiringDeps,
): Promise<SessionWiring> {
  const store = openTaskBranchStore(deps.dbPath);

  const detector = new FileModificationDetector(
    execGit,
    deps.pollIntervalMs,
  );

  const driftDetector = createDriftDetector();

  const sessionManager = createSessionManager({
    store,
    worktreeManager: createWorktreeManager(execGit),
    detector,
    execGit,
    ...(deps.staleDays !== undefined && { staleDays: deps.staleDays }),
  });

  // T025 — wire drift signals → sendNotification
  detector.onModification(async (event) => {
    const existing = store.findBySessionId(event.sessionId);
    if (existing === undefined) return;
    const signal = await driftDetector.observe({
      taskBranchId: existing.id,
      filePath: event.filePath,
      sessionStartedAt: existing.createdAt,
    });
    if (signal !== null) {
      deps.sendNotification("state.driftSignal", {
        taskBranchId: signal.taskBranchId,
        confidence: signal.confidence,
        heuristics: signal.heuristics,
        explanation: signal.explanation,
      });
    }
  });

  await sessionManager.initialize();

  // T026 — shutdown handler
  async function shutdown(): Promise<void> {
    const branches = store.listAll();
    for (const branch of branches.filter((b) => b.status === "active")) {
      detector.stopPolling(branch.sessionId);
    }
    store.close();
  }

  return { sessionManager, store, detector, driftDetector, shutdown };
}
