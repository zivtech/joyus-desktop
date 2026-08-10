import { JSDOM } from "jsdom";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sites } from "../../src/ui/pages/Sites";
import type { LocalSite } from "../../src/ui/components/LocalSiteCard";
import type { RemoteEnvironment } from "../../src/ui/components/RemoteEnvironmentCard";
import type { TaskBranch } from "../../src/ui/components/TaskBranchCard";
import { installTauriInternals } from "./tauriInternals";

let dom: JSDOM;
let root: Root | undefined;
let container: HTMLElement;

interface ReactInputProps {
  onChange?: (event: { target: HTMLInputElement; currentTarget: HTMLInputElement }) => void;
  onKeyDown?: (event: { key: string }) => void;
}

function makeSite(overrides: Partial<LocalSite> = {}): LocalSite {
  return {
    id: "site-1",
    projectName: "Acme Web",
    repoUrl: "https://github.com/acme/web.git",
    repoPath: "/repos/acme/web",
    ddevProjectName: "web",
    status: "running",
    httpsUrl: "https://web.ddev.site",
    ...overrides,
  };
}

function makeRemote(overrides: Partial<RemoteEnvironment> = {}): RemoteEnvironment {
  return {
    id: "env-1",
    repoOwner: "acme",
    repoName: "web",
    environmentType: "probo",
    status: "active",
    environmentUrl: "https://preview.example.com",
    ...overrides,
  };
}

function makeBranch(overrides: Partial<TaskBranch> = {}): TaskBranch {
  return {
    id: "tb-1",
    sessionId: "sess-1",
    repoPath: "/repos/acme/web",
    worktreePath: "/repos/acme/web/.worktrees/feat-x",
    branchName: "feat-x",
    missionLabel: "Build feature",
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

function button(label: string): HTMLButtonElement {
  const target = Array.from(container.querySelectorAll("button")).find((node) => node.textContent === label);
  if (!(target instanceof dom.window.HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }
  return target;
}

async function click(label: string): Promise<void> {
  await act(async () => {
    button(label).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function clickLast(label: string): Promise<void> {
  const matches = Array.from(container.querySelectorAll("button")).filter((node) => node.textContent === label);
  const target = matches.at(-1);
  if (!(target instanceof dom.window.HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }
  await act(async () => {
    target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function clickFirst(label: string): Promise<void> {
  const matches = Array.from(container.querySelectorAll("button")).filter((node) => node.textContent === label);
  const target = matches.at(0);
  if (!(target instanceof dom.window.HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }
  await act(async () => {
    target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function getReactInputProps(input: HTMLInputElement): ReactInputProps | undefined {
  const propsKey = Object.keys(input).find((key) => key.startsWith("__reactProps$"));
  if (propsKey === undefined) return undefined;
  return (input as unknown as Record<string, unknown>)[propsKey] as ReactInputProps;
}

async function changeInput(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    getReactInputProps(input)?.onChange?.({ target: input, currentTarget: input });
    input.dispatchEvent(new dom.window.InputEvent("input", {
      bubbles: true,
      data: value,
      inputType: "insertText",
    }));
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function mountSites() {
  act(() => {
    root = createRoot(container);
    root.render(createElement(Sites));
  });
}

describe("Sites page", () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    globalThis.document = dom.window.document;
    Object.assign(globalThis, {
      Event: dom.window.Event,
      HTMLInputElement: dom.window.HTMLInputElement,
      HTMLElement: dom.window.HTMLElement,
      InputEvent: dom.window.InputEvent,
      KeyboardEvent: dom.window.KeyboardEvent,
      MouseEvent: dom.window.MouseEvent,
    });
    container = dom.window.document.getElementById("root")!;
  });

  afterEach(async () => {
    vi.useRealTimers();
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

  it("loads sites, expands branch detail, routes branch actions, and provisions a site", async () => {
    const localSites = [makeSite()];
    const remoteSites = [makeRemote()];
    let branches = [makeBranch()];
    const tauri = installTauriInternals(dom.window, (cmd, args) => {
      switch (cmd) {
        case "site_list_local":
          return localSites;
        case "site_list_remote":
          return remoteSites;
        case "session_counts_by_repo":
          return { "/repos/acme/web": { active: branches.length, total: branches.length, lastActivityAt: Date.now() } };
        case "session_list_by_repo":
          return branches;
        case "session_resume":
          return undefined;
        case "session_delete":
          branches = branches.filter((branch) => branch.id !== args["taskBranchId"]);
          return undefined;
        case "open_url":
        case "site_provision":
          return undefined;
        default:
          return undefined;
      }
    });

    mountSites();
    await waitFor(() => container.textContent?.includes("Acme Web") === true);

    expect(container.textContent).toContain("1 Running");
    expect(container.textContent).toContain("Remote Environments");
    expect(container.textContent).toContain("acme/web");

    await click("▼");
    await waitFor(() => container.textContent?.includes("Build feature") === true);
    expect(container.textContent).toContain("Task Branches");
    expect(container.textContent).toContain("Open");

    await click("Resume");
    await waitFor(() => tauri.invoke.mock.calls.some(([cmd]) => cmd === "session_resume"));
    expect(tauri.invoke).toHaveBeenCalledWith("session_resume", { taskBranchId: "tb-1" }, undefined);

    await click("GitHub");
    await waitFor(() => tauri.invoke.mock.calls.some(([cmd]) => cmd === "open_url"));
    expect(tauri.invoke).toHaveBeenCalledWith("open_url", {
      url: "x-github-client://openRepo/%2Frepos%2Facme%2Fweb?branch=feat-x",
    }, undefined);

    await clickLast("Remove");
    await click("Confirm");
    await waitFor(() => tauri.invoke.mock.calls.some(([cmd]) => cmd === "session_delete"));
    expect(tauri.invoke).toHaveBeenCalledWith("session_delete", { taskBranchId: "tb-1" }, undefined);

    await click("▲");
    await waitFor(() => container.textContent?.includes("Task Branches") === false);

    const input = container.querySelector("input")!;
    vi.spyOn(input, "focus").mockImplementation(() => undefined);
    await changeInput(input, "https://github.com/acme/new-site.git");
    await waitFor(() => !button("Provision").disabled);
    await click("Provision");
    await waitFor(() => tauri.invoke.mock.calls.some(([cmd]) => cmd === "site_provision"));
    expect(tauri.invoke).toHaveBeenCalledWith("site_provision", {
      repoUrl: "https://github.com/acme/new-site.git",
    }, undefined);
  });

  it("shows local and remote error states when loading fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    mountSites();
    await waitFor(() => container.textContent?.includes("Could not load local sites.") === true);

    expect(container.textContent).toContain("Could not load local sites.");
    expect(container.textContent).toContain("Could not load remote environments.");
    expect(errorSpy).toHaveBeenCalled();
  });

  it("shows provision errors and submits with Enter after correction", async () => {
    let shouldFail = true;
    const tauri = installTauriInternals(dom.window, (cmd) => {
      switch (cmd) {
        case "site_list_local":
          return [];
        case "site_list_remote":
          return [];
        case "session_counts_by_repo":
          return {};
        case "site_provision":
          if (shouldFail) {
            throw new Error("Provision failed");
          }
          return undefined;
        default:
          return undefined;
      }
    });

    mountSites();
    await waitFor(() => container.textContent?.includes("No local sites") === true);

    const input = container.querySelector("input")!;
    vi.spyOn(input, "focus").mockImplementation(() => undefined);
    await act(async () => {
      getReactInputProps(input)?.onKeyDown?.({ key: "Enter" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(tauri.invoke.mock.calls.some(([cmd]) => cmd === "site_provision")).toBe(false);

    await changeInput(input, "https://github.com/acme/new-site.git");
    await click("Provision");
    await waitFor(() => container.textContent?.includes("Provision failed") === true);

    shouldFail = false;
    await changeInput(input, "https://github.com/acme/new-site.git");
    await act(async () => {
      getReactInputProps(input)?.onKeyDown?.({ key: "Enter" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => tauri.invoke.mock.calls.filter(([cmd]) => cmd === "site_provision").length === 2);
    await waitFor(() => container.textContent?.includes("Provision failed") === false);
  });

  it("renders string provision failures and skips the health bar for unknown statuses", async () => {
    const tauri = installTauriInternals(dom.window, (cmd) => {
      switch (cmd) {
        case "site_list_local":
          return [makeSite({ status: "unknown" as LocalSite["status"] })];
        case "site_list_remote":
          return [];
        case "session_counts_by_repo":
          return {};
        case "site_provision":
          throw "Provision failed as text";
        default:
          return undefined;
      }
    });

    mountSites();
    await waitFor(() => container.textContent?.includes("Acme Web") === true);
    expect(container.textContent).not.toContain("1 Running");

    const input = container.querySelector("input")!;
    vi.spyOn(input, "focus").mockImplementation(() => undefined);
    await changeInput(input, "https://github.com/acme/new-site.git");
    await click("Provision");
    await waitFor(() => container.textContent?.includes("Provision failed as text") === true);
    expect(tauri.invoke).toHaveBeenCalledWith("site_provision", {
      repoUrl: "https://github.com/acme/new-site.git",
    }, undefined);
  });

  it("shows expanded branch errors and handles disappearing expanded sites", async () => {
    let localSites = [makeSite()];
    const tauri = installTauriInternals(dom.window, (cmd) => {
      switch (cmd) {
        case "site_list_local":
          return localSites;
        case "site_list_remote":
          return [];
        case "session_counts_by_repo":
          return { "/repos/acme/web": { active: 1, total: 1, lastActivityAt: Date.now() } };
        case "session_list_by_repo":
          return undefined;
        case "site_remove":
          localSites = [];
          return undefined;
        default:
          return undefined;
      }
    });
    vi.spyOn(dom.window, "confirm").mockReturnValue(true);

    mountSites();
    await waitFor(() => container.textContent?.includes("Acme Web") === true);

    await click("▼");
    await waitFor(() => container.textContent?.includes("Could not load tasks for this site.") === true);

    await clickFirst("Remove");
    await waitFor(() => container.textContent?.includes("No local sites. Provision a project to see it here.") === true);
    expect(tauri.invoke).toHaveBeenCalledWith("site_remove", { siteId: "site-1" }, undefined);
  });

  it("polls branch counts only while the document is visible", async () => {
    let intervalCallback: (() => void) | undefined;
    vi.spyOn(globalThis, "setInterval").mockImplementation((handler) => {
      intervalCallback = handler as () => void;
      return 123 as unknown as ReturnType<typeof setInterval>;
    });
    vi.spyOn(globalThis, "clearInterval").mockImplementation(() => undefined);
    const tauri = installTauriInternals(dom.window, (cmd) => {
      switch (cmd) {
        case "site_list_local":
          return [makeSite()];
        case "site_list_remote":
          return [];
        case "session_counts_by_repo":
          return {};
        default:
          return undefined;
      }
    });

    mountSites();
    await waitFor(() => container.textContent?.includes("Acme Web") === true);
    const initialCountCalls = tauri.invoke.mock.calls.filter(([cmd]) => cmd === "session_counts_by_repo").length;

    Object.defineProperty(dom.window.document, "hidden", { configurable: true, value: true });
    act(() => {
      intervalCallback?.();
    });
    expect(tauri.invoke.mock.calls.filter(([cmd]) => cmd === "session_counts_by_repo")).toHaveLength(initialCountCalls);

    Object.defineProperty(dom.window.document, "hidden", { configurable: true, value: false });
    act(() => {
      intervalCallback?.();
    });
    await waitFor(() =>
      tauri.invoke.mock.calls.filter(([cmd]) => cmd === "session_counts_by_repo").length === initialCountCalls + 1
    );
  });

  it("does not attach remote environments when the local repo URL cannot be parsed", async () => {
    installTauriInternals(dom.window, (cmd) => {
      switch (cmd) {
        case "site_list_local":
          return [makeSite({ repoUrl: "not-a-repo-url" })];
        case "site_list_remote":
          return [];
        case "session_counts_by_repo":
          return {};
        case "session_list_by_repo":
          return [];
        default:
          return undefined;
      }
    });

    mountSites();
    await waitFor(() => container.textContent?.includes("Acme Web") === true);
    await click("▼");
    await waitFor(() => container.textContent?.includes("No active tasks for this site.") === true);

    expect(container.textContent).not.toContain("Probo");
  });

  it("ignores low-confidence drift signals in the site branch map", async () => {
    const tauri = installTauriInternals(dom.window, (cmd) => {
      switch (cmd) {
        case "site_list_local":
          return [makeSite()];
        case "site_list_remote":
          return [];
        case "session_counts_by_repo":
          return {};
        case "session_list_by_repo":
          return [makeBranch()];
        default:
          return undefined;
      }
    });

    mountSites();
    await waitFor(() => container.textContent?.includes("Acme Web") === true);
    await click("▼");
    await waitFor(() => container.textContent?.includes("Build feature") === true);

    act(() => {
      tauri.emit("state.driftSignal", {
        taskBranchId: "tb-1",
        confidence: "low",
        heuristics: { directoryCount: 1, topicDomainCount: 1, elapsedMinutes: 5 },
        explanation: "Low confidence drift",
      });
    });
    expect(container.textContent).not.toContain("Low confidence drift");

    act(() => {
      tauri.emit("state.driftSignal", {
        taskBranchId: "tb-1",
        confidence: "high",
        heuristics: { directoryCount: 4, topicDomainCount: 3, elapsedMinutes: 45 },
        explanation: "High confidence drift",
      });
    });
    expect(container.textContent).toContain("High confidence drift");

    await click("Keep Going");
    expect(container.textContent).not.toContain("High confidence drift");

    act(() => {
      tauri.emit("state.driftSignal", {
        taskBranchId: "tb-1",
        confidence: "high",
        heuristics: { directoryCount: 4, topicDomainCount: 3, elapsedMinutes: 45 },
        explanation: "Start fresh drift",
      });
    });
    expect(container.textContent).toContain("Start fresh drift");
    await click("Start Fresh Task");
    expect(container.textContent).toContain("Start fresh drift");
  });
});
