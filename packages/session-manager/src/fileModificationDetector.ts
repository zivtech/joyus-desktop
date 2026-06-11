import type { ExecGit } from "./taskBranchStore.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileModificationEvent {
  readonly sessionId: string;
  readonly repoPath: string;
  readonly filePath: string;
  readonly detectedAt: number;
  readonly source: "hook" | "poll";
}

// ─── FileModificationDetector ────────────────────────────────────────────────

export class FileModificationDetector {
  private readonly listeners: Array<(event: FileModificationEvent) => void> =
    [];
  private readonly lastIpcFiredAt: Map<string, number> = new Map();
  private readonly pollTimers: Map<
    string,
    ReturnType<typeof setInterval>
  > = new Map();

  constructor(
    private readonly execGit: ExecGit,
    private readonly pollIntervalMs: number = 10_000,
  ) {}

  handleIpcEvent(
    raw: Omit<FileModificationEvent, "detectedAt" | "source">,
  ): void {
    const event: FileModificationEvent = {
      ...raw,
      detectedAt: Date.now(),
      source: "hook",
    };
    this.lastIpcFiredAt.set(raw.sessionId, event.detectedAt);
    this.emit(event);
  }

  onModification(handler: (event: FileModificationEvent) => void): void {
    this.listeners.push(handler);
  }

  startPolling(repoPath: string, sessionId: string): void {
    // Clear any existing timer for this session before starting a new one
    this.stopPolling(sessionId);
    const timer = setInterval(() => {
      void this.pollOnce(repoPath, sessionId);
    }, this.pollIntervalMs);
    this.pollTimers.set(sessionId, timer);
  }

  stopPolling(sessionId: string): void {
    const timer = this.pollTimers.get(sessionId);
    if (timer !== undefined) {
      clearInterval(timer);
      this.pollTimers.delete(sessionId);
    }
    this.lastIpcFiredAt.delete(sessionId);
  }

  private async pollOnce(repoPath: string, sessionId: string): Promise<void> {
    try {
      const { stdout } = await this.execGit(
        ["status", "--porcelain"],
        repoPath,
      );
      if (stdout.trim().length === 0) return;
      const nowMs = Date.now();
      if (this.isDuplicateOfIpc(sessionId, nowMs)) return;
      this.emit({
        sessionId,
        repoPath,
        filePath: ".",
        detectedAt: nowMs,
        source: "poll",
      });
    } catch {
      // Git errors must not crash the polling loop
    }
  }

  private isDuplicateOfIpc(sessionId: string, nowMs: number): boolean {
    const lastIpc = this.lastIpcFiredAt.get(sessionId);
    if (lastIpc === undefined) return false;
    return nowMs - lastIpc < this.pollIntervalMs;
  }

  private emit(event: FileModificationEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
