import { JSDOM } from "jsdom";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SiteCardExpanded } from "../../../src/ui/components/SiteCardExpanded";
import type { TaskBranch } from "../../../src/ui/components/TaskBranchCard";
import type { DriftSignalPayload } from "../../../src/ui/components/DriftBanner";

const noop = () => {};
let dom: JSDOM;
let root: Root | undefined;
let container: HTMLElement;

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
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    globalThis.document = dom.window.document;
    container = dom.window.document.getElementById("root")!;
  });

  afterEach(() => {
    if (root !== undefined) {
      act(() => {
        root?.unmount();
      });
      root = undefined;
    }
    dom.window.close();
  });

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

  it("reveals hidden branches after Show more is clicked", () => {
    const branches = Array.from({ length: 12 }, (_, i) =>
      makeBranch({ id: `tb-${i}`, missionLabel: `Task ${i}` }),
    );

    act(() => {
      root = createRoot(container);
      root.render(createElement(SiteCardExpanded, { ...defaultProps, branches }));
    });

    expect(container.textContent).not.toContain("Task 10");
    const showMore = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Show 2 more")
    )!;
    act(() => {
      showMore.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Task 10");
    expect(container.textContent).toContain("Task 11");
  });
});
