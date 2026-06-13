import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Skills } from "../../src/ui/pages/Skills";
import { installTauriInternals } from "./tauriInternals";
import {
  changeInput,
  clickButton,
  mount,
  setupDom,
  teardownDom,
  waitFor,
  type PageHarness,
} from "./pageTestUtils";

let harness: PageHarness;

describe("Skills page", () => {
  beforeEach(() => {
    harness = setupDom();
  });

  afterEach(async () => {
    await teardownDom(harness);
    vi.restoreAllMocks();
  });

  it("loads synced skills, filters them, and triggers sync", async () => {
    const tauri = installTauriInternals(harness.dom.window, (cmd) => {
      switch (cmd) {
        case "get_sync_status":
          return {
            state: "idle",
            lastSync: "2026-06-13T09:00:00Z",
            version: "4.5.6",
            nextSync: undefined,
          };
        case "get_skills":
          return [
            { name: "browser", version: "0.1.0", bundle: "core", path: "/skills/browser" },
            { name: "github", version: "0.2.0", bundle: "integrations", path: "/skills/github" },
          ];
        case "trigger_sync":
          return undefined;
        default:
          return undefined;
      }
    });

    mount(harness, createElement(Skills));
    expect(harness.container.textContent).toContain("Loading skills");
    await waitFor(() => harness.container.textContent?.includes("2 skills synced") === true);

    const filter = harness.container.querySelector("input");
    if (!(filter instanceof harness.dom.window.HTMLInputElement)) {
      throw new Error("Filter input not found");
    }
    await changeInput(harness, filter, "git");
    expect(harness.container.textContent).toContain("github");
    expect(harness.container.textContent).not.toContain("browser");

    await clickButton(harness, "Sync Now");
    await waitFor(() => tauri.invoke.mock.calls.some(([cmd]) => cmd === "trigger_sync"));
    expect(tauri.invoke).toHaveBeenCalledWith("trigger_sync", {}, undefined);
  });

  it("shows the empty fallback when skill loading cannot reach Tauri", async () => {
    mount(harness, createElement(Skills));
    await waitFor(() => harness.container.textContent?.includes("No skills synced yet") === true);

    await clickButton(harness, "Sync Now");
    await waitFor(() => harness.container.textContent?.includes("Sync Now") === true);
  });
});
