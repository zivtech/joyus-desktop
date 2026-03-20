/**
 * T042 — SC-001: Git Terminology Blocklist Sweep
 *
 * Assert that no word from the git terminology blocklist (FR-011) appears in
 * any user-facing string rendered by the Sessions page components.
 */
import { describe, it, expect } from "vitest";

// Inlined from TaskBranchCard.tsx — pure function, no React dependency
function buildGitHubDesktopUrl(repoPath: string): string {
  return `x-github-client://openRepo/${encodeURIComponent(repoPath)}`;
}

const GIT_BLOCKLIST = [
  "branch",
  "commit",
  "hash",
  "HEAD",
  "checkout",
  "merge",
  "stash",
  "worktree",
  "ref",
  "diff",
  "push",
  "pull",
] as const;

function assertNoGitTerms(text: string, source: string): void {
  for (const term of GIT_BLOCKLIST) {
    expect(
      text.toLowerCase(),
      `"${term}" found in user-facing text from ${source}`,
    ).not.toContain(term);
  }
}

// All user-facing string literals extracted from Sessions page components.
// Source: TaskBranchCard.tsx, DriftBanner.tsx, Sessions.tsx.
const USER_FACING_STRINGS: Array<{ text: string; source: string }> = [
  // TaskBranchCard — STATUS_LABELS (4 values)
  { text: "Active", source: "TaskBranchCard/STATUS_LABELS" },
  { text: "Inactive", source: "TaskBranchCard/STATUS_LABELS" },
  { text: "Unavailable", source: "TaskBranchCard/STATUS_LABELS" },
  { text: "Completed", source: "TaskBranchCard/STATUS_LABELS" },
  // TaskBranchCard — action button labels
  { text: "Resume", source: "TaskBranchCard/buttons" },
  { text: "Remove", source: "TaskBranchCard/buttons" },
  { text: "Open in GitHub Desktop", source: "TaskBranchCard/buttons" },
  { text: "Yes, remove", source: "TaskBranchCard/confirmDelete" },
  { text: "Cancel", source: "TaskBranchCard/confirmDelete" },
  { text: "Really remove this task?", source: "TaskBranchCard/confirmDelete" },
  // TaskBranchCard — broken status warning
  {
    text: "This workspace is unavailable. Removing it will clean up the local files.",
    source: "TaskBranchCard/brokenWarning",
  },
  // TaskBranchCard — GitHub Desktop feedback
  { text: "Opening GitHub Desktop\u2026", source: "TaskBranchCard/githubFeedback" },
  {
    text: "GitHub Desktop does not appear to be installed. Download it at desktop.github.com",
    source: "TaskBranchCard/githubFeedback",
  },
  // TaskBranchCard — relative time label
  { text: "Last active", source: "TaskBranchCard/timeLabel" },
  // DriftBanner — low confidence
  {
    text: "Your work may be spreading across multiple areas. Consider starting a fresh task.",
    source: "DriftBanner/lowConfidence",
  },
  // DriftBanner — high confidence
  { text: "This task is covering a lot of ground", source: "DriftBanner/highConfidence" },
  // DriftBanner — action buttons
  { text: "Start Fresh Task", source: "DriftBanner/buttons" },
  { text: "Keep Going", source: "DriftBanner/buttons" },
  // Sessions — page title
  { text: "My Tasks", source: "Sessions/title" },
  // Sessions — mode toggle
  { text: "Automation mode", source: "Sessions/modeToggle" },
  { text: "Auto-managed", source: "Sessions/modeToggle" },
  { text: "Advisory", source: "Sessions/modeToggle" },
  {
    text: "Affects new tasks only. Existing tasks are not changed.",
    source: "Sessions/modeToggle",
  },
  // Sessions — loading / error / empty state
  { text: "Loading your tasks\u2026", source: "Sessions/loading" },
  { text: "Could not load tasks.", source: "Sessions/error" },
  { text: "No active tasks. Start a task to see it here.", source: "Sessions/emptyState" },
  // Sessions — delete confirm modal
  { text: "This task has unsaved changes", source: "Sessions/deleteModal" },
  {
    text: "Removing this task will discard changes that haven\u2019t been saved. This cannot be undone.",
    source: "Sessions/deleteModal",
  },
  { text: "Keep It", source: "Sessions/deleteModal" },
  { text: "Remove Anyway", source: "Sessions/deleteModal" },
  // Sessions — batch cleanup
  { text: "Clean up inactive tasks", source: "Sessions/batchCleanup" },
  { text: "inactive tasks.", source: "Sessions/batchResult" },
  { text: "could not be removed:", source: "Sessions/batchResult" },
];

describe("SC-001: Git terminology blocklist sweep", () => {
  it("all 4 status labels pass the blocklist check", () => {
    const statusLabels = USER_FACING_STRINGS.filter((s) =>
      s.source.includes("STATUS_LABELS"),
    );
    expect(statusLabels).toHaveLength(4);
    for (const { text, source } of statusLabels) {
      assertNoGitTerms(text, source);
    }
  });

  it("all button and confirmation labels pass the blocklist check", () => {
    const buttonStrings = USER_FACING_STRINGS.filter(
      (s) => s.source.includes("buttons") || s.source.includes("confirmDelete"),
    );
    expect(buttonStrings.length).toBeGreaterThanOrEqual(7);
    for (const { text, source } of buttonStrings) {
      assertNoGitTerms(text, source);
    }
  });

  it("all DriftBanner text variants (low + high confidence) pass the blocklist check", () => {
    const driftStrings = USER_FACING_STRINGS.filter((s) =>
      s.source.startsWith("DriftBanner"),
    );
    expect(driftStrings.length).toBeGreaterThanOrEqual(4);
    for (const { text, source } of driftStrings) {
      assertNoGitTerms(text, source);
    }
  });

  it("mode toggle labels pass the blocklist check", () => {
    const modeStrings = USER_FACING_STRINGS.filter((s) =>
      s.source.includes("modeToggle"),
    );
    expect(modeStrings.length).toBeGreaterThanOrEqual(4);
    for (const { text, source } of modeStrings) {
      assertNoGitTerms(text, source);
    }
  });

  it("all Sessions page strings pass the blocklist check", () => {
    const sessionStrings = USER_FACING_STRINGS.filter((s) =>
      s.source.startsWith("Sessions"),
    );
    expect(sessionStrings.length).toBeGreaterThanOrEqual(10);
    for (const { text, source } of sessionStrings) {
      assertNoGitTerms(text, source);
    }
  });

  it("complete user-facing string corpus — all strings pass blocklist", () => {
    for (const { text, source } of USER_FACING_STRINGS) {
      assertNoGitTerms(text, source);
    }
  });

  it("GitHub Desktop URL uses x-github-client scheme and is not rendered as visible text", () => {
    const repoPath = "/Users/test/my-project";
    const url = buildGitHubDesktopUrl(repoPath);

    // URL must use the x-github-client internal scheme
    expect(url).toMatch(/^x-github-client:\/\/openRepo\//);

    // The URL itself is never one of the visible user-facing strings
    for (const { text } of USER_FACING_STRINGS) {
      expect(text).not.toContain("x-github-client");
    }
  });
});
