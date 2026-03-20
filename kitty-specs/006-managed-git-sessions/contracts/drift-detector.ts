/**
 * Contract: packages/drift-detector
 *
 * Defines the public API surface for session mission drift detection.
 * v1 implements heuristics-only. The DriftConfirmer interface is defined
 * but the LLM implementation is deferred to a follow-up work package.
 */

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

  /** Number of thresholds exceeded. Low confidence = 1; High confidence = 2+. */
  readonly thresholdsExceeded: number;
}

// ─── Drift Signal ─────────────────────────────────────────────────────────────

export type DriftConfidence = "low" | "high";

export interface DriftSignal {
  readonly taskBranchId: string;
  readonly confidence: DriftConfidence;
  readonly heuristics: DriftHeuristicResult;
  /** LLM-generated plain-language explanation. Always null in v1. */
  readonly explanation: string | null;
  readonly generatedAt: number;
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

export interface DriftThresholds {
  /** Minimum distinct top-level directories to trigger low confidence. Default: 3. */
  readonly directoryCount: number;
  /** Minimum distinct inferred topic domains to trigger low confidence. Default: 2. */
  readonly topicDomainCount: number;
  /** Minimum session duration in minutes to trigger low confidence. Default: 30. */
  readonly elapsedMinutes: number;
}

export const DEFAULT_DRIFT_THRESHOLDS: DriftThresholds = {
  directoryCount: 3,
  topicDomainCount: 2,
  elapsedMinutes: 30,
} as const;

// ─── Topic Domain Inference ───────────────────────────────────────────────────

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
  /** Infer the topic domain from a file path. */
  infer(filePath: string): TopicDomain;
}

// ─── Drift Session State ──────────────────────────────────────────────────────

export interface DriftSessionState {
  readonly taskBranchId: string;
  readonly sessionStartedAt: number;
  /** File paths observed so far in this session. */
  readonly observedPaths: ReadonlySet<string>;
  /** Dismissed signal fingerprints — prevents re-prompting for the same signal. */
  readonly dismissedFingerprints: ReadonlySet<string>;
}

// ─── LLM Confirmer (interface only — v1 stub always returns null) ─────────────

export interface DriftConfirmer {
  /**
   * Optionally confirm a heuristic drift signal with an LLM call.
   * Returns a plain-language explanation if confirmed, null if not confirmed
   * or if the LLM is unavailable.
   *
   * MUST NOT throw — graceful degradation is required by FR-004.
   */
  confirm(params: {
    taskBranchId: string;
    heuristics: DriftHeuristicResult;
    observedPaths: ReadonlySet<string>;
  }): Promise<string | null>;
}

/** v1 stub — always returns null, no LLM call. */
export class NoOpDriftConfirmer implements DriftConfirmer {
  async confirm(): Promise<null> {
    return null;
  }
}

// ─── Drift Detector ───────────────────────────────────────────────────────────

export interface DriftDetector {
  /**
   * Record a file observation for the session.
   * Evaluates heuristics after each observation.
   * If thresholds are exceeded and no dismissal is active, emits a DriftSignal.
   */
  observe(params: {
    taskBranchId: string;
    filePath: string;
    sessionStartedAt: number;
  }): Promise<DriftSignal | null>;

  /**
   * Record that the user dismissed a drift signal.
   * Prevents re-prompting for the same signal fingerprint.
   */
  dismiss(signal: DriftSignal): void;

  /** Return the current heuristic state for a session without evaluating thresholds. */
  getState(taskBranchId: string): DriftSessionState | undefined;

  /** Clear session state when a session ends. */
  clearSession(taskBranchId: string): void;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export interface DriftDetectorDeps {
  readonly thresholds?: Partial<DriftThresholds>;
  /** LLM confirmer. Defaults to NoOpDriftConfirmer in v1. */
  readonly confirmer?: DriftConfirmer;
}

export type CreateDriftDetector = (deps?: DriftDetectorDeps) => DriftDetector;
