import { describe, expect, it, vi } from "vitest";
import {
  createOnPrCreatedHandler,
  parseGitHubOwnerRepo,
} from "../src/eventBridge";
import type { EnvironmentMonitor } from "@joyus/environment-monitor";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEnvironmentMonitor(
  overrides: Partial<EnvironmentMonitor> = {},
): EnvironmentMonitor {
  return {
    onPrCreated: vi.fn().mockResolvedValue(undefined),
    requestHostedEnvironment: vi.fn(),
    listAll: vi.fn().mockReturnValue([]),
    listByRepo: vi.fn().mockReturnValue([]),
    getActivityLog: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    ...overrides,
  };
}

// ─── parseGitHubOwnerRepo ─────────────────────────────────────────────────────

describe("parseGitHubOwnerRepo", () => {
  it("parses HTTPS remote URL with .git suffix", () => {
    expect(
      parseGitHubOwnerRepo("https://github.com/zivtech/my-site.git"),
    ).toEqual({ owner: "zivtech", repo: "my-site" });
  });

  it("parses HTTPS remote URL without .git suffix", () => {
    expect(
      parseGitHubOwnerRepo("https://github.com/zivtech/my-site"),
    ).toEqual({ owner: "zivtech", repo: "my-site" });
  });

  it("parses SSH remote URL with .git suffix", () => {
    expect(
      parseGitHubOwnerRepo("git@github.com:zivtech/my-site.git"),
    ).toEqual({ owner: "zivtech", repo: "my-site" });
  });

  it("parses SSH remote URL without .git suffix", () => {
    expect(
      parseGitHubOwnerRepo("git@github.com:zivtech/my-site"),
    ).toEqual({ owner: "zivtech", repo: "my-site" });
  });

  it("handles trailing whitespace/newline", () => {
    expect(
      parseGitHubOwnerRepo("https://github.com/owner/repo.git\n"),
    ).toEqual({ owner: "owner", repo: "repo" });
  });

  it("returns undefined for non-GitHub remote", () => {
    expect(
      parseGitHubOwnerRepo("https://gitlab.com/owner/repo.git"),
    ).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(parseGitHubOwnerRepo("")).toBeUndefined();
  });

  it("returns undefined for a plain path", () => {
    expect(parseGitHubOwnerRepo("/local/path/to/repo")).toBeUndefined();
  });
});

// ─── createOnPrCreatedHandler ─────────────────────────────────────────────────

describe("createOnPrCreatedHandler", () => {
  it("calls environmentMonitor.onPrCreated with parsed owner and repo", async () => {
    const monitor = makeEnvironmentMonitor();
    const execGit = vi.fn().mockResolvedValue({
      stdout: "https://github.com/zivtech/my-site.git\n",
      stderr: "",
    });

    const handler = createOnPrCreatedHandler({
      environmentMonitor: monitor,
      execGit,
    });

    await handler("/repo", "joyus/branch", 7, "branch-id-1");

    expect(execGit).toHaveBeenCalledWith(
      ["remote", "get-url", "origin"],
      "/repo",
    );
    expect(monitor.onPrCreated).toHaveBeenCalledWith(
      "zivtech",
      "my-site",
      7,
      "branch-id-1",
    );
  });

  it("skips environment linking when execGit throws", async () => {
    const monitor = makeEnvironmentMonitor();
    const execGit = vi.fn().mockRejectedValue(new Error("not a git repo"));

    const handler = createOnPrCreatedHandler({
      environmentMonitor: monitor,
      execGit,
    });

    await handler("/repo", "branch", 1, "id");

    expect(monitor.onPrCreated).not.toHaveBeenCalled();
  });

  it("skips environment linking when remote is not GitHub", async () => {
    const monitor = makeEnvironmentMonitor();
    const execGit = vi.fn().mockResolvedValue({
      stdout: "https://gitlab.com/org/repo.git",
      stderr: "",
    });

    const handler = createOnPrCreatedHandler({
      environmentMonitor: monitor,
      execGit,
    });

    await handler("/repo", "branch", 5, "id");

    expect(monitor.onPrCreated).not.toHaveBeenCalled();
  });

  it("works with SSH remote URL", async () => {
    const monitor = makeEnvironmentMonitor();
    const execGit = vi.fn().mockResolvedValue({
      stdout: "git@github.com:acme/awesome-project.git",
      stderr: "",
    });

    const handler = createOnPrCreatedHandler({
      environmentMonitor: monitor,
      execGit,
    });

    await handler("/repo", "feat-branch", 99, "task-123");

    expect(monitor.onPrCreated).toHaveBeenCalledWith(
      "acme",
      "awesome-project",
      99,
      "task-123",
    );
  });
});
