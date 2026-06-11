import type { EnvironmentMonitor } from "@joyus/environment-monitor";
import type { ExecGit, OnPrCreatedCallback } from "@joyus/session-manager";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EventBridgeDeps {
  readonly environmentMonitor: EnvironmentMonitor;
  readonly execGit: ExecGit;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse owner and repo name from a git remote URL.
 * Supports both HTTPS and SSH formats:
 *   https://github.com/owner/repo.git
 *   git@github.com:owner/repo.git
 * Returns undefined when the URL cannot be parsed.
 */
export function parseGitHubOwnerRepo(
  remoteUrl: string,
): { owner: string; repo: string } | undefined {
  const trimmed = remoteUrl.trim();

  // HTTPS: https://github.com/owner/repo[.git]
  const httpsMatch = /https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(
    trimmed,
  );
  if (httpsMatch !== null) {
    return { owner: httpsMatch[1]!, repo: httpsMatch[2]! };
  }

  // SSH: git@github.com:owner/repo[.git]
  const sshMatch = /git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(
    trimmed,
  );
  if (sshMatch !== null) {
    return { owner: sshMatch[1]!, repo: sshMatch[2]! };
  }

  return undefined;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create an onPrCreated handler that bridges session-manager push/PR events
 * to environmentMonitor.onPrCreated(). Wire this into SessionCloser's deps:
 *
 *   const onPrCreated = createOnPrCreatedHandler({ environmentMonitor, execGit });
 *   const sessionCloser = createSessionCloser({ ..., onPrCreated });
 */
export function createOnPrCreatedHandler(
  deps: EventBridgeDeps,
): OnPrCreatedCallback {
  const { environmentMonitor, execGit } = deps;

  return async function onPrCreated(
    repoPath: string,
    _branchName: string,
    prNumber: number,
    taskBranchId: string,
  ): Promise<void> {
    // Resolve the GitHub owner/repo by reading the git remote URL
    let remoteUrl: string;
    try {
      const { stdout } = await execGit(
        ["remote", "get-url", "origin"],
        repoPath,
      );
      remoteUrl = stdout.trim();
    } catch {
      // Cannot determine remote — skip environment linking
      return;
    }

    const parsed = parseGitHubOwnerRepo(remoteUrl);
    if (parsed === undefined) {
      // Not a GitHub remote — skip environment linking
      return;
    }

    await environmentMonitor.onPrCreated(
      parsed.owner,
      parsed.repo,
      prNumber,
      taskBranchId,
    );
  };
}
