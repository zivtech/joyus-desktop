import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteCardExpanded } from "../../../src/ui/components/SiteCardExpanded";
import type { TaskBranch } from "../../../src/ui/components/TaskBranchCard";
import type { DriftSignalPayload } from "../../../src/ui/components/DriftBanner";

const noop = () => {};

function makeBranch(overrides: Partial<TaskBranch> = {}): TaskBranch {
  return {
    id: "tb-1",
    sessionId: "sess-1",
    repoPath: "/repos/acme",
    worktreePath: "/repos/acme/.worktrees/feat-x",
    branchName: "feat-x",
    missionLabel: "Add widget",
    missionSource: "declared",
    mode: "managed",
    status: "active",
    createdAt: Date.now() - 3_600_000,
    lastActivityAt: Date.now() - 60_000,
    prNumber: undefined,
    prUrl: undefined,
    prTitle: undefined,
    ...overrides,
  };
}

const defaultProps = {
  branches: undefined as readonly TaskBranch[] | undefined,
  remoteEnvs: [],
  loading: false,
  error: undefined as string | undefined,
  driftSignals: new Map<string, DriftSignalPayload>(),
  onResume: noop,
  onDelete: noop,
  onOpenGitHub: noop,
  onDriftDismiss: noop,
  onDriftNewSession: noop,
};

describe("SiteCardExpanded", () => {
  it("renders loading skeleton when loading is true", () => {
    const html = renderToStaticMarkup(
      createElement(SiteCardExpanded, { ...defaultProps, loading: true }),
    );
    expect(html).toContain("pulse");
    expect(html).not.toContain("No active tasks");
  });

  it("renders error message when error is set", () => {
    const html = renderToStaticMarkup(
      createElement(SiteCardExpanded, { ...defaultProps, error: "Something went wrong" }),
    );
    expect(html).toContain("Could not load tasks for this site.");
  });

  it("renders empty state when branches is empty array", () => {
    const html = renderToStaticMarkup(
      createElement(SiteCardExpanded, { ...defaultProps, branches: [] }),
    );
    expect(html).toContain("No active tasks for this site.");
  });

  it("renders branch rows when branches are provided", () => {
    const branches = [
      makeBranch({ id: "tb-1", missionLabel: "First task" }),
      makeBranch({ id: "tb-2", missionLabel: "Second task" }),
    ];
    const html = renderToStaticMarkup(
      createElement(SiteCardExpanded, { ...defaultProps, branches }),
    );
    expect(html).toContain("First task");
    expect(html).toContain("Second task");
  });

  it("renders Task Branches section heading", () => {
    const html = renderToStaticMarkup(
      createElement(SiteCardExpanded, { ...defaultProps, branches: [] }),
    );
    expect(html).toContain("Task Branches");
  });

  it("renders Remote Environments heading when remoteEnvs are provided", () => {
    const envs = [{
      id: "env-1",
      repoOwner: "acme",
      repoName: "web",
      environmentType: "probo" as const,
      status: "active",
    }];
    const html = renderToStaticMarkup(
      createElement(SiteCardExpanded, { ...defaultProps, branches: [], remoteEnvs: envs }),
    );
    expect(html).toContain("Remote Environments");
  });

  it("omits Remote Environments section when list is empty", () => {
    const html = renderToStaticMarkup(
      createElement(SiteCardExpanded, { ...defaultProps, branches: [] }),
    );
    expect(html).not.toContain("Remote Environments");
  });

  it("limits visible branches to 10 and shows 'Show more' button", () => {
    const branches = Array.from({ length: 12 }, (_, i) =>
      makeBranch({ id: `tb-${i}`, missionLabel: `Task ${i}` }),
    );
    const html = renderToStaticMarkup(
      createElement(SiteCardExpanded, { ...defaultProps, branches }),
    );
    expect(html).toContain("Task 0");
    expect(html).toContain("Task 9");
    expect(html).not.toContain("Task 10");
    expect(html).toContain("Show 2 more");
  });
});
