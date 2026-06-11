import type { ExecCommand } from "../../local-provisioner/src/runtimeDetector.js";
import type { ProboDetector } from "./proboDetector.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DiscoveredProject {
  readonly repoUrl: string;
  readonly repoOwner: string;
  readonly repoName: string;
  readonly source: "github-org" | "admin-curated" | "manual";
  readonly hasProbo: boolean | undefined;
  readonly hasDdev: boolean | undefined;
}

export interface ProjectDiscovery {
  /** Discover projects from all sources, deduplicated by repo URL. */
  discoverAll(): Promise<readonly DiscoveredProject[]>;

  /** Discover from GitHub org only. */
  discoverFromGitHubOrg(orgName: string): Promise<readonly DiscoveredProject[]>;

  /** Add a manual project by URL. */
  addManual(repoUrl: string): DiscoveredProject;
}

export interface ProjectDiscoveryDeps {
  readonly execCommand: ExecCommand;
  readonly proboDetector?: ProboDetector;
  readonly defaultOrg?: string;
}

// ─── URL Normalization ────────────────────────────────────────────────────────

/**
 * Normalize a repo URL for deduplication.
 * Strips .git suffix, lowercases, converts SSH to HTTPS form.
 *
 * Examples:
 *   git@github.com:org/repo.git  → https://github.com/org/repo
 *   https://github.com/Org/Repo.git → https://github.com/org/repo
 */
export function normalizeRepoUrl(rawUrl: string): string {
  let url = rawUrl.trim();

  // Convert SSH format: git@github.com:org/repo.git → https://github.com/org/repo.git
  const sshMatch = /^git@([^:]+):(.+)$/.exec(url);
  if (sshMatch !== null) {
    url = `https://${sshMatch[1]}/${sshMatch[2]}`;
  }

  // Lowercase first so suffix stripping is case-insensitive (.GIT → .git)
  url = url.toLowerCase();

  // Strip trailing .git
  if (url.endsWith(".git")) {
    url = url.slice(0, -4);
  }

  return url;
}

/**
 * Parse owner and repo name from a normalized HTTPS URL.
 * Returns undefined if the URL cannot be parsed.
 */
function parseOwnerRepo(
  url: string,
): { owner: string; name: string } | undefined {
  const normalized = normalizeRepoUrl(url);
  // Match https://github.com/owner/repo or similar
  const match = /https?:\/\/[^/]+\/([^/]+)\/([^/]+)$/.exec(normalized);
  if (match === null) return undefined;
  /* v8 ignore next -- regex groups always defined when match succeeds */
  return { owner: match[1] ?? "", name: match[2] ?? "" };
}

// ─── GitHub API Types ─────────────────────────────────────────────────────────

interface GitHubRepo {
  name: string;
  clone_url: string;
  html_url: string;
}

// ─── Admin-Curated List Stub ──────────────────────────────────────────────────

/**
 * Placeholder returning empty array until the joyus-ai platform API is available.
 */
async function fetchAdminCuratedList(): Promise<readonly DiscoveredProject[]> {
  return [];
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createProjectDiscovery(
  deps: ProjectDiscoveryDeps,
): ProjectDiscovery {
  const { execCommand, proboDetector, defaultOrg = "zivtech" } = deps;

  const manualProjects: DiscoveredProject[] = [];

  return {
    async discoverFromGitHubOrg(
      orgName: string,
    ): Promise<readonly DiscoveredProject[]> {
      try {
        const { stdout } = await execCommand([
          "gh",
          "api",
          `/orgs/${orgName}/repos`,
          "--paginate",
        ]);
        const repos = JSON.parse(stdout) as GitHubRepo[];
        return repos.map((repo) => {
          const normalized = normalizeRepoUrl(repo.clone_url);
          return {
            repoUrl: normalized,
            repoOwner: orgName.toLowerCase(),
            repoName: repo.name.toLowerCase(),
            source: "github-org" as const,
            hasProbo: undefined,
            hasDdev: undefined,
          };
        });
      } catch {
        return [];
      }
    },

    addManual(repoUrl: string): DiscoveredProject {
      const normalized = normalizeRepoUrl(repoUrl);
      const parsed = parseOwnerRepo(normalized);

      const project: DiscoveredProject = {
        repoUrl: normalized,
        repoOwner: parsed?.owner ?? "",
        repoName: parsed?.name ?? "",
        source: "manual",
        hasProbo: undefined,
        hasDdev: undefined,
      };

      // Deduplicate by normalized URL
      const alreadyAdded = manualProjects.some(
        (p) => p.repoUrl === normalized,
      );
      if (!alreadyAdded) {
        manualProjects.push(project);
      }

      return project;
    },

    async discoverAll(): Promise<readonly DiscoveredProject[]> {
      const [orgProjects, adminProjects] = await Promise.all([
        this.discoverFromGitHubOrg(defaultOrg),
        fetchAdminCuratedList(),
      ]);

      // Combine all sources
      const all: DiscoveredProject[] = [
        ...orgProjects,
        ...adminProjects,
        ...manualProjects,
      ];

      // Deduplicate by normalized URL, first occurrence wins
      const seen = new Set<string>();
      const deduplicated: DiscoveredProject[] = [];
      for (const project of all) {
        if (!seen.has(project.repoUrl)) {
          seen.add(project.repoUrl);

          // proboDetector.hasProbo() requires a local path, not a URL — always undefined here
          const hasProbo = undefined;

          deduplicated.push({ ...project, hasProbo, hasDdev: undefined });
        }
      }

      return deduplicated;
    },
  };
}
