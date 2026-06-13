import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Usage } from "../../src/ui/pages/Usage";
import { installTauriInternals } from "./tauriInternals";
import { clickButton, mount, setupDom, teardownDom, waitFor, type PageHarness } from "./pageTestUtils";

let harness: PageHarness;

describe("Usage page", () => {
  beforeEach(() => {
    harness = setupDom();
  });

  afterEach(async () => {
    await teardownDom(harness);
    vi.restoreAllMocks();
  });

  it("renders usage summaries, charts, rankings, and date-range switches", async () => {
    const seenDays: number[] = [];
    installTauriInternals(harness.dom.window, (_cmd, args) => {
      const days = Number(args["days"]);
      seenDays.push(days);
      return {
        toolCalls: days,
        syncs: 2,
        governanceDecisions: 4,
        serverCrashes: 1,
        dailyActivity: [
          { date: "2026-06-12", count: 0 },
          { date: "2026-06-13", count: 8 },
        ],
        topTools: [
          { name: "governance.check", count: 5 },
          { name: "sync.trigger", count: 3 },
        ],
        topServers: [
          { name: "policy", count: 6 },
        ],
      };
    });

    mount(harness, createElement(Usage));
    expect(harness.container.textContent).toContain("Loading usage data");
    await waitFor(() => harness.container.textContent?.includes("Tool Calls") === true);

    expect(harness.container.textContent).toContain("Daily Activity");
    expect(harness.container.textContent).toContain("governance.check");
    expect(harness.container.textContent).toContain("policy");
    expect(harness.container.querySelector("svg")?.getAttribute("aria-label")).toBe("Daily activity bar chart");

    await clickButton(harness, "7d");
    await waitFor(() => seenDays.includes(7));
    expect(harness.container.textContent).toContain("7");
  });

  it("renders no-data and empty-ranking states", async () => {
    installTauriInternals(harness.dom.window, () => ({
      toolCalls: 0,
      syncs: 0,
      governanceDecisions: 0,
      serverCrashes: 0,
      dailyActivity: [],
      topTools: [],
      topServers: [],
    }));

    mount(harness, createElement(Usage));
    await waitFor(() => harness.container.textContent?.includes("Top Activity") === true);

    expect(harness.container.textContent).toContain("No data yet.");
    expect(harness.container.textContent).not.toContain("Daily Activity");
  });

  it("falls back when usage data is unavailable", async () => {
    mount(harness, createElement(Usage));
    await waitFor(() => harness.container.textContent?.includes("No usage data available.") === true);
  });
});
