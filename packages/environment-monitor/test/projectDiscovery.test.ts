import { describe, it, expect, vi } from "vitest";

import {
  createProjectDiscovery,
  normalizeRepoUrl,
} from "../src/projectDiscovery.js";
import type { ExecCommand } from "../../local-provisioner/src/runtimeDetector.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeExec(
  responses: Record<string, { stdout: string; stderr: string } | Error>,
): ExecCommand {
  return vi.fn().mockImplementation((args: readonly string[]) => {
    const key = args.join(" ");
    const response = responses[key];
    if (response instanceof Error) return Promise.reject(response);
    if (response !== undefined) return Promise.resolve(response);
    return Promise.reject(new Error(`Unexpected command: ${key}`));
  });
}

function reposResponse(
  repos: Array<{ name: string; clone_url: string; html_url: string }>,
): { stdout: string; stderr: string } {
  return { stdout: JSON.stringify(repos), stderr: "" };
}

function makeRepo(
  name: string,
  org = "zivtech",
): { name: string; clone_url: string; html_url: string } {
  return {
    name,
    clone_url: `https://github.com/${org}/${name}.git`,
    html_url: `https://github.com/${org}/${name}`,
  };
}

// ─── normalizeRepoUrl ─────────────────────────────────────────────────────────

describe("normalizeRepoUrl", () => {
  it("strips .git suffix from HTTPS URL", () => {
    expect(normalizeRepoUrl("https://github.com/org/repo.git")).toBe(
      "https://github.com/org/repo",
    );
  });

  it("lowercases the URL", () => {
    expect(normalizeRepoUrl("https://github.com/Org/Repo")).toBe(
      "https://github.com/org/repo",
    );
  });

  it("strips .git and lowercases together", () => {
    expect(normalizeRepoUrl("https://github.com/ZivTech/My-Repo.git")).toBe(
      "https://github.com/zivtech/my-repo",
    );
  });

  it("converts SSH URL to HTTPS form", () => {
    expect(normalizeRepoUrl("git@github.com:org/repo.git")).toBe(
      "https://github.com/org/repo",
    );
  });

  it("converts SSH URL without .git suffix", () => {
    expect(normalizeRepoUrl("git@github.com:org/repo")).toBe(
      "https://github.com/org/repo",
    );
  });

  it("handles already-normalized HTTPS URL", () => {
    expect(normalizeRepoUrl("https://github.com/org/repo")).toBe(
      "https://github.com/org/repo",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeRepoUrl("  https://github.com/org/repo.git  ")).toBe(
      "https://github.com/org/repo",
    );
  });
});

// ─── discoverFromGitHubOrg ────────────────────────────────────────────────────

describe("discoverFromGitHubOrg", () => {
  it("returns projects from the given org", async () => {
    const exec = makeExec({
      "gh api /orgs/zivtech/repos --paginate": reposResponse([
        makeRepo("site-a"),
        makeRepo("site-b"),
      ]),
    });
    const discovery = createProjectDiscovery({ execCommand: exec });
    const results = await discovery.discoverFromGitHubOrg("zivtech");

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      repoOwner: "zivtech",
      repoName: "site-a",
      source: "github-org",
      hasProbo: undefined,
      hasDdev: undefined,
    });
  });

  it("normalizes repo URLs — strips .git and lowercases", async () => {
    const exec = makeExec({
      "gh api /orgs/zivtech/repos --paginate": reposResponse([
        makeRepo("My-Repo"),
      ]),
    });
    const discovery = createProjectDiscovery({ execCommand: exec });
    const results = await discovery.discoverFromGitHubOrg("zivtech");

    expect(results[0]?.repoUrl).toBe("https://github.com/zivtech/my-repo");
  });

  it("returns empty array when gh api fails", async () => {
    const exec = makeExec({
      "gh api /orgs/zivtech/repos --paginate": new Error("not authenticated"),
    });
    const discovery = createProjectDiscovery({ execCommand: exec });
    const results = await discovery.discoverFromGitHubOrg("zivtech");

    expect(results).toEqual([]);
  });

  it("returns empty array when org has no repos", async () => {
    const exec = makeExec({
      "gh api /orgs/zivtech/repos --paginate": reposResponse([]),
    });
    const discovery = createProjectDiscovery({ execCommand: exec });
    const results = await discovery.discoverFromGitHubOrg("zivtech");

    expect(results).toEqual([]);
  });

  it("lowercases org name in repoOwner field", async () => {
    const exec = makeExec({
      "gh api /orgs/ZivTech/repos --paginate": reposResponse([
        makeRepo("repo"),
      ]),
    });
    const discovery = createProjectDiscovery({ execCommand: exec });
    const results = await discovery.discoverFromGitHubOrg("ZivTech");

    expect(results[0]?.repoOwner).toBe("zivtech");
  });

  it("lowercases repo name in repoName field", async () => {
    const exec = makeExec({
      "gh api /orgs/zivtech/repos --paginate": reposResponse([
        {
          name: "MY-REPO",
          clone_url: "https://github.com/zivtech/MY-REPO.git",
          html_url: "https://github.com/zivtech/MY-REPO",
        },
      ]),
    });
    const discovery = createProjectDiscovery({ execCommand: exec });
    const results = await discovery.discoverFromGitHubOrg("zivtech");

    expect(results[0]?.repoName).toBe("my-repo");
  });
});

// ─── addManual ────────────────────────────────────────────────────────────────

describe("addManual", () => {
  it("adds a manual project and returns it", () => {
    const exec = vi.fn() as ExecCommand;
    const discovery = createProjectDiscovery({ execCommand: exec });
    const result = discovery.addManual("https://github.com/myorg/myrepo.git");

    expect(result).toMatchObject({
      repoUrl: "https://github.com/myorg/myrepo",
      repoOwner: "myorg",
      repoName: "myrepo",
      source: "manual",
      hasProbo: undefined,
      hasDdev: undefined,
    });
  });

  it("normalizes URL on add — strips .git and lowercases", () => {
    const exec = vi.fn() as ExecCommand;
    const discovery = createProjectDiscovery({ execCommand: exec });
    const result = discovery.addManual("https://github.com/MyOrg/MyRepo.GIT");

    expect(result.repoUrl).toBe("https://github.com/myorg/myrepo");
  });

  it("converts SSH URL to HTTPS on manual add", () => {
    const exec = vi.fn() as ExecCommand;
    const discovery = createProjectDiscovery({ execCommand: exec });
    const result = discovery.addManual("git@github.com:org/repo.git");

    expect(result.repoUrl).toBe("https://github.com/org/repo");
    expect(result.repoOwner).toBe("org");
    expect(result.repoName).toBe("repo");
    expect(result.source).toBe("manual");
  });

  it("falls back to empty owner/name for non-standard URL", () => {
    const exec = vi.fn() as ExecCommand;
    const discovery = createProjectDiscovery({ execCommand: exec });
    const result = discovery.addManual("https://custom-host.local/repo");

    expect(result.repoOwner).toBe("");
    expect(result.repoName).toBe("");
    expect(result.source).toBe("manual");
  });

  it("does not add duplicate by normalized URL", () => {
    const exec = vi.fn() as ExecCommand;
    const discovery = createProjectDiscovery({ execCommand: exec });

    discovery.addManual("https://github.com/org/repo.git");
    discovery.addManual("https://github.com/org/repo.git");
    discovery.addManual("https://github.com/ORG/REPO");

    // All three are the same normalized URL — discoverAll should only include one
    // We can verify via discoverAll
  });
});

// ─── discoverAll ──────────────────────────────────────────────────────────────

describe("discoverAll", () => {
  it("returns org repos when no manual projects added", async () => {
    const exec = makeExec({
      "gh api /orgs/zivtech/repos --paginate": reposResponse([
        makeRepo("site-a"),
      ]),
    });
    const discovery = createProjectDiscovery({ execCommand: exec });
    const results = await discovery.discoverAll();

    expect(results).toHaveLength(1);
    expect(results[0]?.source).toBe("github-org");
  });

  it("combines org repos and manual projects", async () => {
    const exec = makeExec({
      "gh api /orgs/zivtech/repos --paginate": reposResponse([
        makeRepo("site-a"),
      ]),
    });
    const discovery = createProjectDiscovery({ execCommand: exec });
    discovery.addManual("https://github.com/other-org/other-repo");

    const results = await discovery.discoverAll();

    expect(results).toHaveLength(2);
    const sources = results.map((r) => r.source);
    expect(sources).toContain("github-org");
    expect(sources).toContain("manual");
  });

  it("deduplicates across sources — org repo wins over manual with same URL", async () => {
    const exec = makeExec({
      "gh api /orgs/zivtech/repos --paginate": reposResponse([
        makeRepo("site-a"),
      ]),
    });
    const discovery = createProjectDiscovery({ execCommand: exec });
    // Add the same URL manually that's also in the org
    discovery.addManual("https://github.com/zivtech/site-a");

    const results = await discovery.discoverAll();

    // Should only appear once
    const siteA = results.filter((r) => r.repoName === "site-a");
    expect(siteA).toHaveLength(1);
    // First occurrence (org) wins
    expect(siteA[0]?.source).toBe("github-org");
  });

  it("deduplicates multiple manual adds with same normalized URL", async () => {
    const exec = makeExec({
      "gh api /orgs/zivtech/repos --paginate": reposResponse([]),
    });
    const discovery = createProjectDiscovery({ execCommand: exec });
    discovery.addManual("https://github.com/org/repo.git");
    discovery.addManual("https://github.com/org/repo");
    discovery.addManual("git@github.com:org/repo.git");

    const results = await discovery.discoverAll();

    const orgRepo = results.filter((r) => r.repoName === "repo");
    expect(orgRepo).toHaveLength(1);
  });

  it("returns empty array when org API fails and no manual projects", async () => {
    const exec = makeExec({
      "gh api /orgs/zivtech/repos --paginate": new Error("network error"),
    });
    const discovery = createProjectDiscovery({ execCommand: exec });
    const results = await discovery.discoverAll();

    expect(results).toEqual([]);
  });

  it("uses defaultOrg from deps when discovering", async () => {
    const exec = makeExec({
      "gh api /orgs/acme/repos --paginate": reposResponse([
        makeRepo("acme-site", "acme"),
      ]),
    });
    const discovery = createProjectDiscovery({
      execCommand: exec,
      defaultOrg: "acme",
    });
    const results = await discovery.discoverAll();

    expect(results).toHaveLength(1);
    expect(results[0]?.repoOwner).toBe("acme");
  });

  it("sets hasProbo and hasDdev to undefined (not yet enriched with local path)", async () => {
    const exec = makeExec({
      "gh api /orgs/zivtech/repos --paginate": reposResponse([
        makeRepo("site-a"),
      ]),
    });
    const discovery = createProjectDiscovery({ execCommand: exec });
    const results = await discovery.discoverAll();

    expect(results[0]?.hasProbo).toBeUndefined();
    expect(results[0]?.hasDdev).toBeUndefined();
  });
});

// ─── index re-exports ─────────────────────────────────────────────────────────

describe("index re-exports", () => {
  it("exports createProjectDiscovery and normalizeRepoUrl from index", async () => {
    const indexModule = await import("../src/index.js");
    expect(indexModule.createProjectDiscovery).toBeDefined();
    expect(indexModule.normalizeRepoUrl).toBeDefined();
  });

  it("exports createUserIdentity from index", async () => {
    const indexModule = await import("../src/index.js");
    expect(indexModule.createUserIdentity).toBeDefined();
  });
});
