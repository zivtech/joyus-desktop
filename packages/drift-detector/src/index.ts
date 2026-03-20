export { createDriftDetector, NoOpDriftConfirmer, DEFAULT_DRIFT_THRESHOLDS } from "./driftDetector.js";
export { inferTopicDomain, TopicDomainInferrer } from "./topicDomainInferrer.js";
export { evaluateHeuristics } from "./heuristicsEngine.js";
export type { EvaluationParams } from "./heuristicsEngine.js";

export type {
  DriftHeuristicResult,
  DriftSignal,
  DriftConfidence,
  DriftThresholds,
  TopicDomain,
  TopicDomainInferrer as TopicDomainInferrerInterface,
  DriftSessionState,
  DriftConfirmer,
  DriftDetector,
  DriftDetectorDeps,
  CreateDriftDetector,
} from "../../../kitty-specs/006-managed-git-sessions/contracts/drift-detector.js";
