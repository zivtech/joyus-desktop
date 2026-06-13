import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTauriInternals } from "./tauriInternals";
import { clickButton, mount, setupDom, teardownDom, waitFor, type PageHarness } from "./pageTestUtils";

let harness: PageHarness;

async function mountReconSetup(): Promise<void> {
  const { ReconSetup } = await import("../../src/ui/pages/ReconSetup");
  mount(harness, createElement(ReconSetup), { initialEntries: ["/recon/setup"] });
}

function installHappySetupBridge() {
  return installTauriInternals(harness.dom.window, (cmd) => {
    switch (cmd) {
      case "check_claude_binary":
        return { found: true, version: "1.0.0" };
      case "credentials_list":
        return [];
      case "credentials_verify":
        return [
          { key: "ANTHROPIC_API_KEY", valid: true },
          { key: "DATAFORSEO_USERNAME", valid: true },
          { key: "DATAFORSEO_PASSWORD", valid: true },
          { key: "CRUX_API_KEY", valid: true },
        ];
      case "get_sync_status":
        return { version: "9.9.9" };
      case "check_skill_file":
        return { found: true };
      default:
        return undefined;
    }
  });
}

async function advanceThroughCredentials(): Promise<void> {
  await waitFor(() => harness.container.textContent?.includes("Claude Code found") === true);
  await clickButton(harness, "Next");
  await waitFor(() => harness.container.textContent?.includes("Enter API credentials") === true);
  await clickButton(harness, "Verify All");
  await waitFor(() => !Array.from(harness.container.querySelectorAll("button"))
    .find((button) => button.textContent === "Next")?.hasAttribute("disabled"));
  await clickButton(harness, "Next");
}

describe("ReconSetup page", () => {
  beforeEach(() => {
    harness = setupDom();
  });

  afterEach(async () => {
    await teardownDom(harness);
    vi.restoreAllMocks();
  });

  it("walks through the successful setup wizard", async () => {
    installHappySetupBridge();

    await mountReconSetup();
    expect(harness.container.textContent).toContain("Detecting Claude Code");
    await waitFor(() => harness.container.textContent?.includes("Claude Code found") === true);

    await clickButton(harness, "Next");
    await waitFor(() => harness.container.textContent?.includes("Enter API credentials") === true);
    await clickButton(harness, "Back");
    await waitFor(() => harness.container.textContent?.includes("Claude Code found") === true);

    await advanceThroughCredentials();
    expect(harness.container.textContent).toContain("Syncing Recon Operator skill");
    await waitFor(() => harness.container.textContent?.includes("Recon Operator skill ready (v9.9.9)") === true);
    await clickButton(harness, "Finish");
  });

  it("supports retrying Claude detection after a failed check", async () => {
    let attempts = 0;
    installTauriInternals(harness.dom.window, (cmd) => {
      if (cmd === "check_claude_binary") {
        attempts += 1;
        return attempts === 1 ? { found: false } : { found: true, version: "1.0.1" };
      }
      return undefined;
    });

    await mountReconSetup();
    await waitFor(() => harness.container.textContent?.includes("Claude Code not found") === true);
    await clickButton(harness, "Check Again");
    await waitFor(() => harness.container.textContent?.includes("Version: 1.0.1") === true);
  });

  it("shows not-found when Claude detection cannot reach the desktop bridge", async () => {
    await mountReconSetup();
    await waitFor(() => harness.container.textContent?.includes("Claude Code not found") === true);
  });

  it("allows manual skill install when sync does not produce the skill file", async () => {
    let skillChecks = 0;
    installTauriInternals(harness.dom.window, (cmd) => {
      switch (cmd) {
        case "check_claude_binary":
          return { found: true, version: "1.0.0" };
        case "credentials_list":
          return [];
        case "credentials_verify":
          return [
            { key: "ANTHROPIC_API_KEY", valid: true },
            { key: "DATAFORSEO_USERNAME", valid: true },
            { key: "DATAFORSEO_PASSWORD", valid: true },
            { key: "CRUX_API_KEY", valid: true },
          ];
        case "check_skill_file":
          skillChecks += 1;
          return { found: false };
        case "get_sync_status":
          return {};
        default:
          return undefined;
      }
    });

    await mountReconSetup();
    await advanceThroughCredentials();
    await waitFor(() => harness.container.textContent?.includes("Skill sync failed or skill not found.") === true);
    await clickButton(harness, "Retry");
    await waitFor(() => skillChecks >= 2);
    await waitFor(() => harness.container.textContent?.includes("Skill sync failed or skill not found.") === true);
    await clickButton(harness, "Skip (manual install)");
    await waitFor(() => harness.container.textContent?.includes("Recon skill not installed.") === true);
    await clickButton(harness, "Finish");
  });

  it("shows skill readiness without a version when sync status has no version", async () => {
    installTauriInternals(harness.dom.window, (cmd) => {
      switch (cmd) {
        case "check_claude_binary":
          return { found: true, version: "1.0.0" };
        case "credentials_list":
          return [];
        case "credentials_verify":
          return [
            { key: "ANTHROPIC_API_KEY", valid: true },
            { key: "DATAFORSEO_USERNAME", valid: true },
            { key: "DATAFORSEO_PASSWORD", valid: true },
            { key: "CRUX_API_KEY", valid: true },
          ];
        case "check_skill_file":
          return { found: true };
        case "get_sync_status":
          return {};
        default:
          return undefined;
      }
    });

    await mountReconSetup();
    await advanceThroughCredentials();
    await waitFor(() => harness.container.textContent?.includes("Recon Operator skill ready") === true);
    expect(harness.container.textContent).not.toContain("v9.9.9");
  });
});
