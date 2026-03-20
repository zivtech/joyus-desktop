import { useState } from "react";

export type TaskBranchStatus = "active" | "stale" | "merged" | "broken";
export type OperatingMode = "managed" | "advisory";
export type MissionSource = "declared" | "inferred";

export interface TaskBranch {
  readonly id: string;
  readonly sessionId: string;
  readonly repoPath: string;
  readonly worktreePath: string;
  readonly branchName: string;
  readonly missionLabel: string;
  readonly missionSource: MissionSource;
  readonly mode: OperatingMode;
  readonly status: TaskBranchStatus;
  readonly createdAt: number;
  readonly lastActivityAt: number;
}

interface TaskBranchCardProps {
  branch: TaskBranch;
  pendingDelete: boolean;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
  onOpenGitHub: (repoPath: string, branchName: string) => void;
}

const STATUS_COLORS: Record<TaskBranchStatus, string> = {
  active: "#22c55e",
  stale: "#f59e0b",
  broken: "#ef4444",
  merged: "#6b7280",
};

const STATUS_LABELS: Record<TaskBranchStatus, string> = {
  active: "Active",
  stale: "Inactive",
  broken: "Unavailable",
  merged: "Completed",
};

function formatRelativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) {
    return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  }
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  }
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

export function buildGitHubDesktopUrl(repoPath: string): string {
  return `x-github-client://openRepo/${encodeURIComponent(repoPath)}`;
}

export function TaskBranchCard({
  branch,
  pendingDelete,
  onResume,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
  onOpenGitHub,
}: TaskBranchCardProps) {
  const [githubFeedback, setGithubFeedback] = useState<
    "idle" | "opening" | "error"
  >("idle");

  const color = STATUS_COLORS[branch.status];
  const label = STATUS_LABELS[branch.status];
  const canResume = branch.status === "active" || branch.status === "stale";

  function handleOpenGitHub() {
    setGithubFeedback("opening");
    try {
      onOpenGitHub(branch.repoPath, branch.branchName);
      setTimeout(() => {
        setGithubFeedback("idle");
      }, 2000);
    } catch {
      setGithubFeedback("error");
    }
  }

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "0.5rem",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: "0.9375rem",
              color: "#111827",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {branch.missionLabel}
          </div>
          <div
            style={{
              fontSize: "0.8125rem",
              color: "#6b7280",
              marginTop: "0.25rem",
            }}
          >
            Last active {formatRelativeTime(branch.lastActivityAt)}
          </div>
        </div>

        {/* Status badge */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.375rem",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: color,
              display: "inline-block",
            }}
          />
          <span style={{ fontSize: "0.8125rem", color: "#374151" }}>
            {label}
          </span>
        </span>
      </div>

      {/* Broken warning */}
      {branch.status === "broken" && (
        <div
          style={{
            fontSize: "0.8125rem",
            color: "#b45309",
            background: "#fef3c7",
            border: "1px solid #fde68a",
            borderRadius: "6px",
            padding: "0.5rem 0.75rem",
          }}
        >
          This workspace is unavailable. Removing it will clean up the local
          files.
        </div>
      )}

      {/* Actions */}
      {pendingDelete ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: "0.875rem", color: "#374151" }}>
            Really remove this task?
          </span>
          <button
            onClick={() => onConfirmDelete(branch.id)}
            style={{
              background: "#ef4444",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              padding: "0.375rem 0.75rem",
              fontSize: "0.8125rem",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            Yes, remove
          </button>
          <button
            onClick={onCancelDelete}
            style={{
              background: "transparent",
              color: "#374151",
              border: "1px solid #d1d5db",
              borderRadius: "6px",
              padding: "0.375rem 0.75rem",
              fontSize: "0.8125rem",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {canResume && (
            <button
              onClick={() => onResume(branch.id)}
              style={{
                background: "#1a73e8",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                padding: "0.375rem 0.75rem",
                fontSize: "0.8125rem",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              Resume
            </button>
          )}

          <button
            onClick={() => onDelete(branch.id)}
            style={{
              background: "transparent",
              color: "#ef4444",
              border: "1px solid #fca5a5",
              borderRadius: "6px",
              padding: "0.375rem 0.75rem",
              fontSize: "0.8125rem",
              cursor: "pointer",
            }}
          >
            Remove
          </button>

          <button
            onClick={handleOpenGitHub}
            style={{
              background: "transparent",
              color: "#374151",
              border: "1px solid #d1d5db",
              borderRadius: "6px",
              padding: "0.375rem 0.75rem",
              fontSize: "0.8125rem",
              cursor: "pointer",
            }}
          >
            Open in GitHub Desktop
          </button>
        </div>
      )}

      {/* GitHub Desktop feedback */}
      {githubFeedback === "opening" && (
        <div style={{ fontSize: "0.8125rem", color: "#6b7280" }}>
          Opening GitHub Desktop…
        </div>
      )}
      {githubFeedback === "error" && (
        <div style={{ fontSize: "0.8125rem", color: "#6b7280" }}>
          GitHub Desktop does not appear to be installed. Download it at{" "}
          <span style={{ textDecoration: "underline" }}>
            desktop.github.com
          </span>
        </div>
      )}
    </div>
  );
}
