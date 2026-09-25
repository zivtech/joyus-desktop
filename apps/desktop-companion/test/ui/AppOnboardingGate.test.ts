import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/ui/App";
import { installTauriInternals } from "./tauriInternals";
import { clickButton, setupDom, teardownDom, waitFor, type PageHarness } from "./pageTestUtils";

let harness: PageHarness;

describe("App onboarding gate", () => {
  beforeEach(() => {
    harness = setupDom();
  });

  afterEach(async () => {
    await teardownDom(harness);
    vi.restoreAllMocks();
  });

  it("checks onboarding once, so Open Dashboard is not bounced back to onboarding", async () => {
    const tauri = installTauriInternals(harness.dom.window, (cmd, args) => {
      // Simulates the flag never persisting (e.g. config.set unavailable).
      if (cmd === "get_config" && args["key"] === "onboarding_phase") {
        return "sync";
      }
      return undefined;
    });

    // App provides its own MemoryRouter, so render it without the harness router.
    act(() => {
      harness.root = createRoot(harness.container);
      harness.root.render(createElement(App));
    });
    await waitFor(() => harness.container.textContent?.includes("Downloading skills") === true);
    await clickButton(harness, "Skip");
    await waitFor(() => harness.container.textContent?.includes("Open Dashboard") === true);
    await clickButton(harness, "Open Dashboard");
    await waitFor(() => harness.container.textContent?.includes("Dashboard") === true
      && harness.container.textContent.includes("Open Dashboard") === false);

    const gateChecks = tauri.invoke.mock.calls.filter(
      ([cmd, args]) => cmd === "get_config" && (args as Record<string, unknown>)["key"] === "onboarding_complete",
    );
    expect(gateChecks).toHaveLength(1);
  });
});
