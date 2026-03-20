/**
 * Drift Detector contracts — shared types and constants for the
 * 006-managed-git-sessions feature spec.
 */

// ─── Topic Domain ─────────────────────────────────────────────────────────────

export type TopicDomain =
  | "frontend"
  | "backend"
  | "testing"
  | "documentation"
  | "configuration"
  | "data"
  | "tooling"
  | "security"
  | "other";

export interface TopicDomainInferrer {
  infer(filePath: string): TopicDomain;
}

// ─── Confidence ───────────────────────────────────────────────────────────────

export type DriftConfidence = "low" | "high";

// ─── Heuristic Result ────────────────────────────────────────────────────────

export interface DriftHeuristicResult {
  readonly directoryCount: number;
  readonly directoryThreshold: number;
  readonly directoryExceeded: boolean;
  readonly topicDomainCount: number;
  readonly topicDomainThreshold: number;
  readonly topicDomainExceeded: boolean;
  readonly elapsedMinutes: number;
  readonly elapsedThresholdMinutes: number;
  readonly elapsedExceeded: boolean;
  readonly thresholdsExceeded: number;
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

export interface DriftThresholds {
  readonly directoryCount: number;
  readonly topicDomainCount: number;
  readonly elapsedMinutes: number;
}

export const DEFAULT_DRIFT_THRESHOLDS: DriftThresholds = {
  directoryCount: 3,
  topicDomainCount: 2,
  elapsedMinutes: 30,
};

// ─── Signal ───────────────────────────────────────────────────────────────────

export interface DriftSignal {
  readonly taskBranchId: string;
  readonly confidence: DriftConfidence;
  readonly heuristics: DriftHeuristicResult;
  readonly explanation: string | null;
  readonly generatedAt: number;
}

// ─── Session State ────────────────────────────────────────────────────────────

export interface DriftSessionState {
  readonly taskBranchId: string;
  readonly sessionStartedAt: number;
  readonly observedPaths: ReadonlySet<string>;
  readonly dismissedFingerprints: ReadonlySet<string>;
}

// ─── Confirmer ────────────────────────────────────────────────────────────────

export interface DriftConfirmParams {
  readonly taskBranchId: string;
  readonly heuristics: DriftHeuristicResult;
  readonly observedPaths: ReadonlySet<string>;
}

export interface DriftConfirmer {
  confirm(params: DriftConfirmParams): Promise<string | null>;
}

// ─── Detector ─────────────────────────────────────────────────────────────────

export interface DriftDetector {
  observe(params: {
    taskBranchId: string;
    filePath: string;
    sessionStartedAt: number;
  }): Promise<DriftSignal | null>;
  dismiss(signal: DriftSignal): void;
  getState(taskBranchId: string): DriftSessionState | undefined;
  clearSession(taskBranchId: string): void;
}

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface DriftDetectorDeps {
  readonly thresholds?: Partial<DriftThresholds>;
  readonly confirmer?: DriftConfirmer;
}

// ─── Factory type ─────────────────────────────────────────────────────────────

export type CreateDriftDetector = (deps?: DriftDetectorDeps) => DriftDetector;
