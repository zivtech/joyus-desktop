import { useState } from "react";
import { formatRelativeTime } from "../utils/formatTime.js";
import type { TaskBranch, TaskBranchStatus } from "./TaskBranchCard.js";
import { DriftBanner, type DriftSignalPayload } from "./DriftBanner.js";

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

interface BranchRowProps {
  readonly branch: TaskBranch;
  readonly driftSignal?: DriftSignalPayload | undefined;
  readonly onResume: (id: string) => void | Promise<void>;
  readonly onDelete: (id: string) => void;
  readonly onOpenGitHub: (repoPath: string, branchName: string) => void;
  readonly onDriftDismiss: (taskBranchId: string) => void;
  readonly onDriftNewSession: (taskBranchId: string) => void;
}

export function BranchRow({
  branch,
  driftSignal,
  onResume,
  onDelete,
  onOpenGitHub,
  onDriftDismiss,
  onDriftNewSession,
}: BranchRowProps) {
  const [pendingDelete, setPendingDelete] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | undefined>(undefined);
  const canResume = branch.status === "active" || branch.status === "stale";

  function handleResume() {
    setResuming(true);
    setResumeError(undefined);
    Promise.resolve(onResume(branch.id))
      .catch(() => { setResumeError("Could not resume this session."); })
      .finally(() => { setResuming(false); });
  }

  return (
    <div
      style={{
        background: "#f9fafb",
        border: "1px solid #f3f4f6",
        borderRadius: "6px",
        padding: "0.625rem 0.75rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.375rem",
      }}
    >
      {/* Row 1: Mission + Status + Timestamp */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
        }}
      >
        <span
          style={{
            fontWeight: 500,
            fontSize: "0.8125rem",
            color: "#111827",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            minWidth: 0,
          }}
        >
          {branch.missionLabel}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.625rem",
            flexShrink: 0,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                backgroundColor: STATUS_COLORS[branch.status],
                display: "inline-block",
              }}
            />
            <span style={{ fontSize: "0.75rem", color: "#374151" }}>
              {STATUS_LABELS[branch.status]}
            </span>
          </span>
          <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
            {formatRelativeTime(branch.lastActivityAt)}
          </span>
        </span>
      </div>

      {/* Row 2: Branch Name + PR + Actions */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
        }}
      >
        <span
          style={{
            fontSize: "0.75rem",
            color: "#9ca3af",
            fontFamily: "monospace",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {branch.branchName}
          {branch.prUrl !== undefined && (
            <a
              href={branch.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                marginLeft: "0.5rem",
                color: "#1a73e8",
                textDecoration: "none",
                fontFamily: "system-ui, -apple-system, sans-serif",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              PR #{branch.prNumber}
            </a>
          )}
        </span>
        <span style={{ display: "inline-flex", gap: "0.375rem", flexShrink: 0 }}>
          {pendingDelete ? (
            <>
              <button
                onClick={() => { onDelete(branch.id); setPendingDelete(false); }}
                style={{
                  background: "#ef4444",
                  color: "#fff",
                  border: "none",
                  borderRadius: "4px",
                  padding: "0.1875rem 0.5rem",
                  fontSize: "0.75rem",
                  cursor: "pointer",
                }}
              >
                Confirm
              </button>
              <button
                onClick={() => setPendingDelete(false)}
                style={{
                  background: "transparent",
                  color: "#374151",
                  border: "1px solid #d1d5db",
                  borderRadius: "4px",
                  padding: "0.1875rem 0.5rem",
                  fontSize: "0.75rem",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              {canResume && (
                <button
                  onClick={handleResume}
                  disabled={resuming}
                  style={{
                    background: resuming ? "#93c5fd" : "#1a73e8",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    padding: "0.1875rem 0.5rem",
                    fontSize: "0.75rem",
                    cursor: resuming ? "not-allowed" : "pointer",
                  }}
                >
                  {resuming ? "Resuming…" : "Resume"}
                </button>
              )}
              <button
                onClick={() => onOpenGitHub(branch.repoPath, branch.branchName)}
                style={{
                  background: "transparent",
                  color: "#374151",
                  border: "1px solid #d1d5db",
                  borderRadius: "4px",
                  padding: "0.1875rem 0.5rem",
                  fontSize: "0.75rem",
                  cursor: "pointer",
                }}
              >
                GitHub
              </button>
              <button
                onClick={() => setPendingDelete(true)}
                style={{
                  background: "transparent",
                  color: "#ef4444",
                  border: "1px solid #fca5a5",
                  borderRadius: "4px",
                  padding: "0.1875rem 0.5rem",
                  fontSize: "0.75rem",
                  cursor: "pointer",
                }}
              >
                Remove
              </button>
            </>
          )}
        </span>
      </div>

      {/* Drift banner */}
      {driftSignal !== undefined && (
        <DriftBanner
          signal={driftSignal}
          onDismiss={onDriftDismiss}
          onNewSession={onDriftNewSession}
        />
      )}

      {/* Resume error */}
      {resumeError !== undefined && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: "4px",
            padding: "0.25rem 0.5rem",
            fontSize: "0.75rem",
            color: "#991b1b",
          }}
        >
          {resumeError}
        </div>
      )}
    </div>
  );
}
