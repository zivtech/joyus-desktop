import { JSDOM } from "jsdom";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sessions } from "../../src/ui/pages/Sessions";
import type { TaskBranch } from "../../src/ui/components/TaskBranchCard";
import { installTauriInternals } from "./tauriInternals";

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

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 80; i++) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  throw new Error("Timed out waiting for condition");
}

function click(label: string): void {
  const target = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === label);
  if (target === undefined) {
    throw new Error(`Button not found: ${label}`);
  }
  act(() => {
    target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
}

function mountSessions() {
  act(() => {
    root = createRoot(container);
    root.render(createElement(MemoryRouter, null, createElement(Sessions)));
  });
}

describe("Sessions page", () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    globalThis.document = dom.window.document;
    container = dom.window.document.getElementById("root")!;
  });

  afterEach(async () => {
    if (root !== undefined) {
      act(() => {
        root?.unmount();
      });
      root = undefined;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    dom.window.close();
    vi.restoreAllMocks();
  });

  it("loads tasks, toggles mode, handles drift, opens GitHub Desktop, and cleans stale tasks", async () => {
    let mode: "managed" | "advisory" = "managed";
    let branches = [
      makeBranch({ id: "tb-active", missionLabel: "Active task", status: "active" }),
      makeBranch({ id: "tb-stale", missionLabel: "Stale task", status: "stale" }),
    ];
    const tauri = installTauriInternals(dom.window, (cmd, args) => {
      switch (cmd) {
        case "session_list":
          return branches;
        case "session_get_mode":
          return { mode };
        case "session_set_mode":
          mode = args["mode"] as typeof mode;
          return undefined;
        case "session_delete":
          branches = branches.filter((branch) => branch.id !== args["taskBranchId"]);
          return undefined;
        case "session_has_uncommitted_changes":
          return { hasUncommittedChanges: false };
        case "open_url":
        case "session_resume":
          return undefined;
        default:
          return undefined;
      }
    });

    mountSessions();
    expect(container.textContent).toContain("Loading your tasks");
    await waitFor(() => container.textContent?.includes("Active task") === true);

    expect(container.textContent).toContain("My Tasks");
    expect(container.textContent).toContain("Stale task");
    expect(container.textContent).toContain("Clean up inactive tasks");

    click("Advisory");
    await waitFor(() => tauri.invoke.mock.calls.some(([cmd]) => cmd === "session_set_mode"));
    expect(tauri.invoke).toHaveBeenCalledWith("session_set_mode", { mode: "advisory" }, undefined);
    expect(container.textContent).toContain("Affects new tasks only");

    act(() => {
      tauri.emit("state.driftSignal", {
        taskBranchId: "tb-active",
        confidence: "high",
        heuristics: { directoryCount: 2, topicDomainCount: 3, elapsedMinutes: 75 },
        explanation: "This task crosses several areas.",
      });
    });
    await waitFor(() => container.textContent?.includes("This task crosses several areas.") === true);
    click("Keep Going");
    await waitFor(() => container.textContent?.includes("This task crosses several areas.") === false);

    act(() => {
      tauri.emit("state.driftSignal", {
        taskBranchId: "tb-active",
        confidence: "high",
        heuristics: { directoryCount: 2, topicDomainCount: 3, elapsedMinutes: 75 },
        explanation: "This task still crosses several areas.",
      });
    });
    await waitFor(() => container.textContent?.includes("This task still crosses several areas.") === true);
    click("Start Fresh Task");
    await waitFor(() => container.textContent?.includes("This task still crosses several areas.") === false);

    click("Resume");
    await waitFor(() => tauri.invoke.mock.calls.some(([cmd]) => cmd === "session_resume"));
    expect(tauri.invoke).toHaveBeenCalledWith("session_resume", { taskBranchId: "tb-active" }, undefined);

    click("Open in GitHub Desktop");
    await waitFor(() => tauri.invoke.mock.calls.some(([cmd]) => cmd === "open_url"));
    expect(tauri.invoke).toHaveBeenCalledWith("open_url", {
      url: "x-github-client://openRepo/%2Frepos%2Facme",
    }, undefined);

    click("Remove");
    await waitFor(() => container.textContent?.includes("Really remove this task?") === true);
    click("Yes, remove");
    await waitFor(() => container.textContent?.includes("Active task") === false);
    expect(tauri.invoke).toHaveBeenCalledWith("session_delete", {
      taskBranchId: "tb-active",
      force: false,
    }, undefined);

    click("Clean up inactive tasks");
    await waitFor(() => container.textContent?.includes("Removed 1 inactive tasks.") === true);
    await waitFor(() => container.textContent?.includes("Stale task") === false);
  });

  it("clears mode note timers when modes change and on unmount", async () => {
    let mode: "managed" | "advisory" = "managed";
    const tauri = installTauriInternals(dom.window, (cmd, args) => {
      switch (cmd) {
        case "session_list":
          return [];
        case "session_get_mode":
          return { mode };
        case "session_set_mode":
          mode = args["mode"] as typeof mode;
          return undefined;
        default:
          return undefined;
      }
    });
    const modeTimers: Array<() => void> = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation((handler, timeout) => {
      if (timeout === 4000 && typeof handler === "function") {
        modeTimers.push(handler as () => void);
        return modeTimers.length as unknown as ReturnType<typeof setTimeout>;
      }
      if (typeof handler === "function") {
        handler();
      }
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => undefined);

    mountSessions();
    await waitFor(() => container.textContent?.includes("No active tasks") === true);

    click("Advisory");
    await waitFor(() => modeTimers.length === 1);
    expect(tauri.invoke).toHaveBeenCalledWith("session_set_mode", { mode: "advisory" }, undefined);
    expect(container.textContent).toContain("Affects new tasks only");

    click("Auto-managed");
    await waitFor(() => modeTimers.length === 2);
    expect(tauri.invoke).toHaveBeenCalledWith("session_set_mode", { mode: "managed" }, undefined);
    expect(clearTimeoutSpy).toHaveBeenCalled();

    act(() => {
      modeTimers[1]?.();
    });
    await waitFor(() => container.textContent?.includes("Affects new tasks only") === false);

    click("Advisory");
    await waitFor(() => modeTimers.length === 3);
  });

  it("shows loading, error, and empty states", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    mountSessions();
    expect(container.textContent).toContain("Loading your tasks");
    await waitFor(() => container.textContent?.includes("Could not load tasks.") === true);
    expect(errorSpy).toHaveBeenCalled();

    act(() => {
      root?.unmount();
      root = undefined;
    });

    installTauriInternals(dom.window, (cmd) => {
      switch (cmd) {
        case "session_list":
          return [];
        case "session_get_mode":
          return { mode: "managed" };
        default:
          return undefined;
      }
    });

    mountSessions();
    await waitFor(() => container.textContent?.includes("No active tasks") === true);
  });

  it("reports inactive cleanup failures without removing failed rows", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const branches = [
      makeBranch({ id: "tb-stale", missionLabel: "Stale task", status: "stale" }),
    ];
    installTauriInternals(dom.window, (cmd) => {
      switch (cmd) {
        case "session_list":
          return branches;
        case "session_get_mode":
          return { mode: "managed" };
        case "session_delete":
          throw new Error("delete failed");
        default:
          return undefined;
      }
    });

    mountSessions();
    await waitFor(() => container.textContent?.includes("Stale task") === true);

    click("Clean up inactive tasks");
    await waitFor(() => container.textContent?.includes("Removed 0 tasks. 1 could not be removed: Stale task.") === true);

    expect(container.textContent).toContain("Stale task");
    expect(errorSpy).toHaveBeenCalled();
  });

  it("shows force-delete confirmation for tasks with unsaved changes", async () => {
    let branches = [makeBranch({ id: "tb-dirty", missionLabel: "Dirty task" })];
    const tauri = installTauriInternals(dom.window, (cmd, args) => {
      switch (cmd) {
        case "session_list":
          return branches;
        case "session_get_mode":
          return { mode: "managed" };
        case "session_has_uncommitted_changes":
          return { hasUncommittedChanges: true };
        case "session_delete":
          branches = branches.filter((branch) => branch.id !== args["taskBranchId"]);
          return undefined;
        default:
          return undefined;
      }
    });

    mountSessions();
    await waitFor(() => container.textContent?.includes("Dirty task") === true);

    click("Remove");
    await waitFor(() => container.textContent?.includes("This task has unsaved changes") === true);
    click("Keep It");
    await waitFor(() => container.textContent?.includes("This task has unsaved changes") === false);

    click("Remove");
    await waitFor(() => container.textContent?.includes("This task has unsaved changes") === true);
    click("Remove Anyway");
    await waitFor(() => container.textContent?.includes("No active tasks") === true);

    expect(tauri.invoke).toHaveBeenCalledWith("session_delete", {
      taskBranchId: "tb-dirty",
      force: true,
    }, undefined);
  });
});
