import { JSDOM } from "jsdom";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TaskBranchCard,
  type TaskBranch,
} from "../../../src/ui/components/TaskBranchCard";

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

function renderCard(branch: TaskBranch, pendingDelete = false): string {
  return renderToStaticMarkup(
    createElement(TaskBranchCard, {
      branch,
      pendingDelete,
      onResume: noop,
      onDelete: noop,
      onConfirmDelete: noop,
      onCancelDelete: noop,
      onOpenGitHub: noop,
    }),
  );
}

describe("TaskBranchCard", () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    globalThis.document = dom.window.document;
    container = dom.window.document.getElementById("root")!;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (root !== undefined) {
      act(() => {
        root?.unmount();
      });
      root = undefined;
    }
    dom.window.close();
  });

  it("renders active branch actions and metadata", () => {
    const html = renderCard(makeBranch());

    expect(html).toContain("Add widget");
    expect(html).toContain("Active");
    expect(html).toContain("Resume");
    expect(html).toContain("Open in GitHub Desktop");
  });

  it("shows warning copy for broken branches and hides resume", () => {
    const html = renderCard(makeBranch({ status: "broken" }));

    expect(html).toContain("Unavailable");
    expect(html).toContain("This workspace is unavailable");
    expect(html).not.toContain("Resume");
  });

  it("renders inline delete confirmation when pending", () => {
    const html = renderCard(makeBranch(), true);

    expect(html).toContain("Really remove this task?");
    expect(html).toContain("Yes, remove");
    expect(html).toContain("Cancel");
  });

  it("routes actions through callbacks and shows GitHub opening feedback", () => {
    const onResume = vi.fn();
    const onDelete = vi.fn();
    const onConfirmDelete = vi.fn();
    const onCancelDelete = vi.fn();
    const onOpenGitHub = vi.fn();

    act(() => {
      root = createRoot(container);
      root.render(createElement(TaskBranchCard, {
        branch: makeBranch(),
        pendingDelete: false,
        onResume,
        onDelete,
        onConfirmDelete,
        onCancelDelete,
        onOpenGitHub,
      }));
    });

    const click = (label: string) => {
      const target = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === label)!;
      act(() => {
        target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      });
    };

    click("Resume");
    click("Remove");
    click("Open in GitHub Desktop");

    expect(onResume).toHaveBeenCalledWith("tb-1");
    expect(onDelete).toHaveBeenCalledWith("tb-1");
    expect(onOpenGitHub).toHaveBeenCalledWith("/repos/acme", "feat-x");
    expect(container.textContent).toContain("Opening GitHub Desktop");

    act(() => {
      root?.render(createElement(TaskBranchCard, {
        branch: makeBranch(),
        pendingDelete: true,
        onResume,
        onDelete,
        onConfirmDelete,
        onCancelDelete,
        onOpenGitHub,
      }));
    });

    click("Yes, remove");
    click("Cancel");

    expect(onConfirmDelete).toHaveBeenCalledWith("tb-1");
    expect(onCancelDelete).toHaveBeenCalledTimes(1);
  });

  it("clears GitHub opening feedback after the timeout", () => {
    vi.useFakeTimers();
    const onOpenGitHub = vi.fn();

    act(() => {
      root = createRoot(container);
      root.render(createElement(TaskBranchCard, {
        branch: makeBranch(),
        pendingDelete: false,
        onResume: noop,
        onDelete: noop,
        onConfirmDelete: noop,
        onCancelDelete: noop,
        onOpenGitHub,
      }));
    });

    const open = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent === "Open in GitHub Desktop"
    )!;
    act(() => {
      open.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("Opening GitHub Desktop");

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(container.textContent).not.toContain("Opening GitHub Desktop");
    vi.useRealTimers();
  });

  it("shows GitHub Desktop fallback when the callback throws", () => {
    act(() => {
      root = createRoot(container);
      root.render(createElement(TaskBranchCard, {
        branch: makeBranch(),
        pendingDelete: false,
        onResume: noop,
        onDelete: noop,
        onConfirmDelete: noop,
        onCancelDelete: noop,
        onOpenGitHub: () => {
          throw new Error("missing");
        },
      }));
    });

    const open = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent === "Open in GitHub Desktop"
    )!;
    act(() => {
      open.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("GitHub Desktop does not appear to be installed");
  });
});
