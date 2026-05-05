import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BranchRow } from "../../../src/ui/components/BranchRow";
import type { TaskBranch } from "../../../src/ui/components/TaskBranchCard";

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

describe("BranchRow", () => {
  it("renders mission label and branch name", () => {
    const html = renderToStaticMarkup(
      createElement(BranchRow, {
        branch: makeBranch(),
        onResume: noop,
        onDelete: noop,
        onOpenGitHub: noop,
        onDriftDismiss: noop,
        onDriftNewSession: noop,
      }),
    );
    expect(html).toContain("Add widget");
    expect(html).toContain("feat-x");
  });

  it("renders Active status for active branches", () => {
    const html = renderToStaticMarkup(
      createElement(BranchRow, {
        branch: makeBranch({ status: "active" }),
        onResume: noop,
        onDelete: noop,
        onOpenGitHub: noop,
        onDriftDismiss: noop,
        onDriftNewSession: noop,
      }),
    );
    expect(html).toContain("Active");
  });

  it("renders Resume button for active branches", () => {
    const html = renderToStaticMarkup(
      createElement(BranchRow, {
        branch: makeBranch({ status: "active" }),
        onResume: noop,
        onDelete: noop,
        onOpenGitHub: noop,
        onDriftDismiss: noop,
        onDriftNewSession: noop,
      }),
    );
    expect(html).toContain("Resume");
  });

  it("renders Resume button for stale branches", () => {
    const html = renderToStaticMarkup(
      createElement(BranchRow, {
        branch: makeBranch({ status: "stale" }),
        onResume: noop,
        onDelete: noop,
        onOpenGitHub: noop,
        onDriftDismiss: noop,
        onDriftNewSession: noop,
      }),
    );
    expect(html).toContain("Resume");
    expect(html).toContain("Inactive");
  });

  it("does not render Resume button for merged branches", () => {
    const html = renderToStaticMarkup(
      createElement(BranchRow, {
        branch: makeBranch({ status: "merged" }),
        onResume: noop,
        onDelete: noop,
        onOpenGitHub: noop,
        onDriftDismiss: noop,
        onDriftNewSession: noop,
      }),
    );
    expect(html).not.toContain("Resume");
    expect(html).toContain("Completed");
  });

  it("does not render Resume button for broken branches", () => {
    const html = renderToStaticMarkup(
      createElement(BranchRow, {
        branch: makeBranch({ status: "broken" }),
        onResume: noop,
        onDelete: noop,
        onOpenGitHub: noop,
        onDriftDismiss: noop,
        onDriftNewSession: noop,
      }),
    );
    expect(html).not.toContain("Resume");
    expect(html).toContain("Unavailable");
  });

  it("renders PR link when prUrl and prNumber are set", () => {
    const html = renderToStaticMarkup(
      createElement(BranchRow, {
        branch: makeBranch({ prUrl: "https://github.com/acme/web/pull/99", prNumber: 99 }),
        onResume: noop,
        onDelete: noop,
        onOpenGitHub: noop,
        onDriftDismiss: noop,
        onDriftNewSession: noop,
      }),
    );
    expect(html).toContain("PR #99");
    expect(html).toContain("https://github.com/acme/web/pull/99");
  });

  it("always renders GitHub and Remove buttons", () => {
    const html = renderToStaticMarkup(
      createElement(BranchRow, {
        branch: makeBranch(),
        onResume: noop,
        onDelete: noop,
        onOpenGitHub: noop,
        onDriftDismiss: noop,
        onDriftNewSession: noop,
      }),
    );
    expect(html).toContain("GitHub");
    expect(html).toContain("Remove");
  });
});
