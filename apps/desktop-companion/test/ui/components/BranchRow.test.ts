import { JSDOM } from "jsdom";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BranchRow } from "../../../src/ui/components/BranchRow";
import type { TaskBranch } from "../../../src/ui/components/TaskBranchCard";

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

describe("BranchRow", () => {
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

  it("stops propagation when the PR link is clicked", () => {
    const onParentClick = vi.fn();

    act(() => {
      root = createRoot(container);
      root.render(createElement("div", { onClick: onParentClick },
        createElement(BranchRow, {
          branch: makeBranch({ prUrl: "https://github.com/acme/web/pull/99", prNumber: 99 }),
          onResume: noop,
          onDelete: noop,
          onOpenGitHub: noop,
          onDriftDismiss: noop,
          onDriftNewSession: noop,
        }),
      ));
    });

    const prLink = container.querySelector("a")!;
    act(() => {
      prLink.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });

    expect(onParentClick).not.toHaveBeenCalled();
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

  it("shows a resume error when resume rejects", async () => {
    const onResume = vi.fn().mockRejectedValue(new Error("no session"));

    await act(async () => {
      root = createRoot(container);
      root.render(createElement(BranchRow, {
        branch: makeBranch(),
        onResume,
        onDelete: noop,
        onOpenGitHub: noop,
        onDriftDismiss: noop,
        onDriftNewSession: noop,
      }));
    });

    const resume = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Resume")!;
    await act(async () => {
      resume.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onResume).toHaveBeenCalledWith("tb-1");
    expect(container.textContent).toContain("Could not resume this session.");
  });

  it("resumes without showing an error when resume resolves", async () => {
    const onResume = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root = createRoot(container);
      root.render(createElement(BranchRow, {
        branch: makeBranch(),
        onResume,
        onDelete: noop,
        onOpenGitHub: noop,
        onDriftDismiss: noop,
        onDriftNewSession: noop,
      }));
    });

    const resume = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Resume")!;
    await act(async () => {
      resume.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onResume).toHaveBeenCalledWith("tb-1");
    expect(container.textContent).not.toContain("Could not resume this session.");
  });

  it("confirms and cancels removal inline", () => {
    const onDelete = vi.fn();

    act(() => {
      root = createRoot(container);
      root.render(createElement(BranchRow, {
        branch: makeBranch(),
        onResume: noop,
        onDelete,
        onOpenGitHub: noop,
        onDriftDismiss: noop,
        onDriftNewSession: noop,
      }));
    });

    const remove = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Remove")!;
    act(() => {
      remove.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("Confirm");

    const cancel = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Cancel")!;
    act(() => {
      cancel.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("Remove");

    const removeAgain = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Remove")!;
    act(() => {
      removeAgain.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    const confirm = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Confirm")!;
    act(() => {
      confirm.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });

    expect(onDelete).toHaveBeenCalledWith("tb-1");
  });

  it("routes GitHub and drift actions to their callbacks", () => {
    const onOpenGitHub = vi.fn();
    const onDriftDismiss = vi.fn();
    const onDriftNewSession = vi.fn();

    act(() => {
      root = createRoot(container);
      root.render(createElement(BranchRow, {
        branch: makeBranch(),
        driftSignal: {
          taskBranchId: "tb-1",
          confidence: "high",
          heuristics: { directoryCount: 2, topicDomainCount: 3, elapsedMinutes: 90 },
          explanation: "Wide-ranging task",
        },
        onResume: noop,
        onDelete: noop,
        onOpenGitHub,
        onDriftDismiss,
        onDriftNewSession,
      }));
    });

    const clickButton = (label: string) => {
      const target = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === label)!;
      act(() => {
        target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      });
    };

    clickButton("GitHub");
    clickButton("Start Fresh Task");
    clickButton("Keep Going");

    expect(onOpenGitHub).toHaveBeenCalledWith("/repos/acme", "feat-x");
    expect(onDriftNewSession).toHaveBeenCalledWith("tb-1");
    expect(onDriftDismiss).toHaveBeenCalledWith("tb-1");
  });
});
