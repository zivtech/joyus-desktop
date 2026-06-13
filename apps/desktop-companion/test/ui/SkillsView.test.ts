import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SkillsView } from "../../src/ui/pages/SkillsView";
import type { SkillInfo } from "../../src/ui/components/SkillList";
import type { SyncStatus } from "../../src/ui/hooks/useSyncStatus";

const idleStatus: SyncStatus = {
  state: "idle",
  lastSync: undefined,
  version: undefined,
  nextSync: undefined,
};

const syncingStatus: SyncStatus = {
  state: "syncing",
  lastSync: "2026-06-13T03:00:00Z",
  version: "1.2.3",
  nextSync: undefined,
};

const skills: SkillInfo[] = [
  {
    name: "browser",
    version: "0.1.0",
    bundle: "core",
    path: "/skills/browser",
  },
  {
    name: "github",
    version: "0.2.0",
    bundle: "integrations",
    path: "/skills/github",
  },
];

function renderSkillsView(
  overrides: Partial<{
    skills: SkillInfo[];
    loading: boolean;
    status: SyncStatus;
    lastSync: string | undefined;
    version: string | undefined;
    filter: string;
    syncing: boolean;
  }> = {},
): string {
  const status = overrides.status ?? idleStatus;
  return renderToStaticMarkup(
    createElement(SkillsView, {
      skills: overrides.skills ?? [],
      loading: overrides.loading ?? false,
      status,
      lastSync: overrides.lastSync ?? status.lastSync,
      version: overrides.version ?? status.version,
      filter: overrides.filter ?? "",
      syncing: overrides.syncing ?? false,
      onFilterChange: vi.fn(),
      onSyncNow: vi.fn(),
    }),
  );
}

describe("SkillsView", () => {
  it("shows loading state without a synced count", () => {
    const html = renderSkillsView({ loading: true });

    expect(html).toContain("Skills");
    expect(html).toContain("Loading skills");
    expect(html).not.toContain("skills synced");
  });

  it("shows empty state and default sync metadata", () => {
    const html = renderSkillsView();

    expect(html).toContain("0 skills synced");
    expect(html).toContain("No skills synced yet");
    expect(html).toContain("Never");
  });

  it("shows sync-in-progress state with version and last sync", () => {
    const html = renderSkillsView({
      status: syncingStatus,
      skills,
      syncing: true,
    });

    expect(html).toContain("2 skills synced");
    expect(html).toContain("v1.2.3");
    expect(html).toContain("Syncing");
    expect(html).toContain("Sync in progress");
    expect(html).toContain("2026-06-13T03:00:00Z");
  });

  it("uses the singular skill count when exactly one skill is present", () => {
    const html = renderSkillsView({
      skills: [skills[0]!],
      version: "0.1.0",
    });

    expect(html).toContain("1 skill synced");
    expect(html).toContain("v0.1.0");
    expect(html).not.toContain("1 skills synced");
  });

  it("renders the filtered skill table when skills are present", () => {
    const html = renderSkillsView({ skills, filter: "git" });

    expect(html).toContain("2 skills synced");
    expect(html).toContain("github");
    expect(html).not.toContain("browser");
    expect(html).not.toContain("No skills match");
  });

  it("shows a no-match message when the filter excludes every skill", () => {
    const html = renderSkillsView({ skills, filter: "drupal" });

    expect(html).toContain("No skills match");
    expect(html).toContain("drupal");
    expect(html).not.toContain("No skills synced yet");
  });
});
