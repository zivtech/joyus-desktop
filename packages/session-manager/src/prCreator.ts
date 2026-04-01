// ─── Types ───────────────────────────────────────────────────────────────────

export type ExecCommand = (
  args: string[],
  cwd?: string,
) => Promise<{ stdout: string; stderr: string }>;

export interface PrCreationResult {
  readonly prNumber: number;
  readonly prUrl: string;
  readonly prTitle: string;
}

export interface PrCreator {
  /**
   * Create a draft PR via `gh pr create --draft`.
   * Returns the PR number, URL, and title.
   */
  createDraftPr(
    repoPath: string,
    branchName: string,
    title: string,
    body?: string,
  ): Promise<PrCreationResult>;
}

export interface PrCreatorDeps {
  readonly execCommand: ExecCommand;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse PR number from a GitHub pull request URL.
 * Handles: https://github.com/owner/repo/pull/123
 */
export function parsePrNumberFromUrl(url: string): number | undefined {
  const match = /\/pull\/(\d+)$/.exec(url.trim());
  if (match === null) return undefined;
  return parseInt(match[1]!, 10);
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createPrCreator(deps: PrCreatorDeps): PrCreator {
  const { execCommand } = deps;

  return {
    async createDraftPr(
      repoPath: string,
      branchName: string,
      title: string,
      body?: string,
    ): Promise<PrCreationResult> {
      const args = [
        "gh",
        "pr",
        "create",
        "--draft",
        "--head",
        branchName,
        "--title",
        title,
      ];

      if (body !== undefined && body.length > 0) {
        args.push("--body", body);
      } else {
        args.push("--body", "");
      }

      const { stdout } = await execCommand(args, repoPath);
      const prUrl = stdout.trim();

      const prNumber = parsePrNumberFromUrl(prUrl);
      if (prNumber === undefined) {
        throw new Error(
          `Failed to parse PR number from gh output: ${JSON.stringify(prUrl)}`,
        );
      }

      return { prNumber, prUrl, prTitle: title };
    },
  };
}
