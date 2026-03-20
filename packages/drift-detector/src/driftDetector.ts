import type {
  DriftConfirmer,
  DriftDetector,
  DriftDetectorDeps,
  DriftSessionState,
  DriftSignal,
  DriftThresholds,
} from "../../../kitty-specs/006-managed-git-sessions/contracts/drift-detector.js";
import { DEFAULT_DRIFT_THRESHOLDS } from "../../../kitty-specs/006-managed-git-sessions/contracts/drift-detector.js";
import { evaluateHeuristics } from "./heuristicsEngine.js";

export { DEFAULT_DRIFT_THRESHOLDS };

export class NoOpDriftConfirmer implements DriftConfirmer {
  async confirm(): Promise<null> {
    return null;
  }
}

interface MutableSessionState {
  readonly taskBranchId: string;
  sessionStartedAt: number;
  observedPaths: Set<string>;
  dismissedFingerprints: Set<string>;
}

class DriftDetectorImpl implements DriftDetector {
  private readonly sessions = new Map<string, MutableSessionState>();
  private readonly thresholds: DriftThresholds;
  private readonly confirmer: DriftConfirmer;

  constructor(thresholds: DriftThresholds, confirmer: DriftConfirmer) {
    this.thresholds = thresholds;
    this.confirmer = confirmer;
  }

  async observe(params: {
    taskBranchId: string;
    filePath: string;
    sessionStartedAt: number;
  }): Promise<DriftSignal | null> {
    const { taskBranchId, filePath, sessionStartedAt } = params;

    let state = this.sessions.get(taskBranchId);
    if (state === undefined) {
      state = {
        taskBranchId,
        sessionStartedAt,
        observedPaths: new Set<string>(),
        dismissedFingerprints: new Set<string>(),
      };
      this.sessions.set(taskBranchId, state);
    }
    state.observedPaths.add(filePath);

    const result = evaluateHeuristics(
      {
        observedPaths: state.observedPaths,
        sessionStartedAt: state.sessionStartedAt,
        nowMs: Date.now(),
      },
      this.thresholds
    );

    if (result.thresholdsExceeded === 0) {
      return null;
    }

    const fingerprint = JSON.stringify({
      directoryCount: result.directoryCount,
      topicDomainCount: result.topicDomainCount,
      elapsedMinutes: Math.floor(result.elapsedMinutes),
    });

    if (state.dismissedFingerprints.has(fingerprint)) {
      return null;
    }

    const explanation = await this.confirmer.confirm({
      taskBranchId,
      heuristics: result,
      observedPaths: state.observedPaths,
    });

    const signal: DriftSignal = {
      taskBranchId,
      confidence: result.thresholdsExceeded >= 2 ? "high" : "low",
      heuristics: result,
      explanation,
      generatedAt: Date.now(),
    };

    return signal;
  }

  dismiss(signal: DriftSignal): void {
    const state = this.sessions.get(signal.taskBranchId);
    if (state === undefined) {
      return;
    }
    const fingerprint = JSON.stringify({
      directoryCount: signal.heuristics.directoryCount,
      topicDomainCount: signal.heuristics.topicDomainCount,
      elapsedMinutes: Math.floor(signal.heuristics.elapsedMinutes),
    });
    state.dismissedFingerprints.add(fingerprint);
  }

  getState(taskBranchId: string): DriftSessionState | undefined {
    const state = this.sessions.get(taskBranchId);
    if (state === undefined) {
      return undefined;
    }
    return {
      taskBranchId: state.taskBranchId,
      sessionStartedAt: state.sessionStartedAt,
      observedPaths: state.observedPaths,
      dismissedFingerprints: state.dismissedFingerprints,
    };
  }

  clearSession(taskBranchId: string): void {
    this.sessions.delete(taskBranchId);
  }
}

export function createDriftDetector(deps?: DriftDetectorDeps): DriftDetector {
  const baseThresholds = DEFAULT_DRIFT_THRESHOLDS;
  const thresholds: DriftThresholds =
    deps?.thresholds !== undefined
      ? {
          directoryCount: deps.thresholds.directoryCount ?? baseThresholds.directoryCount,
          topicDomainCount: deps.thresholds.topicDomainCount ?? baseThresholds.topicDomainCount,
          elapsedMinutes: deps.thresholds.elapsedMinutes ?? baseThresholds.elapsedMinutes,
        }
      : baseThresholds;

  const confirmer = deps?.confirmer ?? new NoOpDriftConfirmer();
  return new DriftDetectorImpl(thresholds, confirmer);
}
