import { createElement } from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "../../src/ui/pages/Dashboard";
import { installTauriInternals } from "./tauriInternals";
import { mount, setupDom, teardownDom, waitFor, type PageHarness } from "./pageTestUtils";

let harness: PageHarness;

describe("Dashboard page", () => {
  beforeEach(() => {
    harness = setupDom();
  });

  afterEach(async () => {
    await teardownDom(harness);
    vi.restoreAllMocks();
  });

  it("renders server, usage, and sync summaries", async () => {
    const tauri = installTauriInternals(harness.dom.window, (cmd, args) => {
      switch (cmd) {
        case "get_servers":
          return [
            { id: "srv-1", name: "Policy MCP", status: "running", pid: 123, uptime: 75, restartCount: 1 },
            { id: "srv-2", name: "Sync MCP", status: "stopped", restartCount: 0 },
          ];
        case "get_sync_status":
          return {
            state: "up_to_date",
            lastSync: "2026-06-13T10:00:00Z",
            version: "1.2.3",
            nextSync: "2026-06-13T11:00:00Z",
          };
        case "get_usage_summary":
          expect(args).toEqual({ days: 1 });
          return {
            toolCallsToday: 12,
            governanceDecisionsToday: 3,
            serverUptimeSeconds: 75,
          };
        default:
          return undefined;
      }
    });

    mount(harness, createElement(Dashboard));
    expect(harness.container.textContent).toContain("Loading servers");
    await waitFor(() => harness.container.textContent?.includes("Policy MCP") === true);
    await waitFor(() => harness.container.textContent?.includes("12") === true);

    expect(harness.container.textContent).toContain("1 / 2");
    expect(harness.container.textContent).toContain("Governance Decisions Today");
    expect(harness.container.textContent).toContain("up to date");
    expect(harness.container.textContent).toContain("2026-06-13T11:00:00Z");

    await act(async () => {
      tauri.emit("state:server-changed", {
        id: "srv-2",
        name: "Sync MCP",
        status: "running",
        restartCount: 0,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => harness.container.textContent?.includes("2 / 2") === true);
  });

  it("falls back to empty values when the desktop bridge is unavailable", async () => {
    mount(harness, createElement(Dashboard));
    await waitFor(() => harness.container.textContent?.includes("No servers configured.") === true);

    expect(harness.container.textContent).toContain("0 / 0");
    expect(harness.container.textContent).toContain("Never");
  });
});
