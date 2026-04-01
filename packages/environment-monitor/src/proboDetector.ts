import { existsSync } from "node:fs";
import { join } from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProboDetector {
  /** Check if a repository has Probo enabled by looking for .probo.yaml or .probo.yml. */
  hasProbo(repoPath: string): boolean;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createProboDetector(): ProboDetector {
  return {
    hasProbo(repoPath: string): boolean {
      return (
        existsSync(join(repoPath, ".probo.yaml")) ||
        existsSync(join(repoPath, ".probo.yml"))
      );
    },
  };
}
