import type {
  DriftHeuristicResult,
  DriftThresholds,
} from "../../../kitty-specs/006-managed-git-sessions/contracts/drift-detector.js";
import { inferTopicDomain } from "./topicDomainInferrer.js";

export interface EvaluationParams {
  readonly observedPaths: ReadonlySet<string>;
  readonly sessionStartedAt: number;
  readonly nowMs: number;
}

export function evaluateHeuristics(
  params: EvaluationParams,
  thresholds: DriftThresholds
): DriftHeuristicResult {
  const { observedPaths, sessionStartedAt, nowMs } = params;

  // Directory count: top-level directory from each path
  const directories = new Set<string>();
  for (const p of observedPaths) {
    const firstSegment = p.split("/")[0];
    if (firstSegment !== undefined && firstSegment.length > 0) {
      directories.add(firstSegment);
    }
  }
  const directoryCount = directories.size;
  const directoryExceeded = directoryCount >= thresholds.directoryCount;

  // Topic domain count: distinct non-"other" domains
  const domains = new Set<string>();
  for (const p of observedPaths) {
    const domain = inferTopicDomain(p);
    if (domain !== "other") {
      domains.add(domain);
    }
  }
  const topicDomainCount = domains.size;
  const topicDomainExceeded = topicDomainCount >= thresholds.topicDomainCount;

  // Elapsed minutes
  const elapsedMinutes = (nowMs - sessionStartedAt) / 60_000;
  const elapsedExceeded = elapsedMinutes >= thresholds.elapsedMinutes;

  const thresholdsExceeded = [directoryExceeded, topicDomainExceeded, elapsedExceeded].filter(
    Boolean
  ).length;

  return {
    directoryCount,
    directoryThreshold: thresholds.directoryCount,
    directoryExceeded,
    topicDomainCount,
    topicDomainThreshold: thresholds.topicDomainCount,
    topicDomainExceeded,
    elapsedMinutes,
    elapsedThresholdMinutes: thresholds.elapsedMinutes,
    elapsedExceeded,
    thresholdsExceeded,
  };
}
