import { useState } from "react";
import type { TaskBranch } from "./TaskBranchCard.js";
import type { RemoteEnvironment } from "./RemoteEnvironmentCard.js";
import type { DriftSignalPayload } from "./DriftBanner.js";
import { BranchRow } from "./BranchRow.js";
import { RemoteEnvRow } from "./RemoteEnvRow.js";

const MAX_VISIBLE_BRANCHES = 10;

interface SiteCardExpandedProps {
  readonly branches: readonly TaskBranch[] | undefined;
  readonly remoteEnvs: readonly RemoteEnvironment[];
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly driftSignals: ReadonlyMap<string, DriftSignalPayload>;
  readonly onResume: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onOpenGitHub: (repoPath: string, branchName: string) => void;
  readonly onDriftDismiss: (taskBranchId: string) => void;
  readonly onDriftNewSession: (taskBranchId: string) => void;
}

export function SiteCardExpanded({
  branches,
  remoteEnvs,
  loading,
  error,
  driftSignals,
  onResume,
  onDelete,
  onOpenGitHub,
  onDriftDismiss,
  onDriftNewSession,
}: SiteCardExpandedProps) {
  const [showAll, setShowAll] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", paddingTop: "0.5rem" }}>
      {/* Task Branches Section */}
      <div>
        <div
          style={{
            fontSize: "0.6875rem",
            fontWeight: 600,
            color: "#6b7280",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: "0.25rem",
          }}
        >
          Task Branches
        </div>

        {loading && (
          <div
            style={{
              height: "40px",
              background: "#f9fafb",
              border: "1px solid #f3f4f6",
              borderRadius: "6px",
              animation: "pulse 1.5s ease-in-out infinite",
            }}
          />
        )}

        {error !== undefined && (
          <div
            style={{
              background: "#fef2f2",
              border: "1px solid #fca5a5",
              borderRadius: "4px",
              padding: "0.375rem 0.625rem",
              fontSize: "0.813rem",
              color: "#991b1b",
            }}
          >
            Could not load tasks for this site.
          </div>
        )}

        {!loading && error === undefined && branches !== undefined && branches.length === 0 && (
          <div
            style={{
              padding: "0.75rem",
              textAlign: "center",
              fontSize: "0.813rem",
              color: "#9ca3af",
            }}
          >
            No active tasks for this site.
          </div>
        )}

        {!loading && error === undefined && branches !== undefined && branches.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
            {(showAll ? branches : branches.slice(0, MAX_VISIBLE_BRANCHES)).map((branch) => (
              <BranchRow
                key={branch.id}
                branch={branch}
                driftSignal={driftSignals.get(branch.id)}
                onResume={onResume}
                onDelete={onDelete}
                onOpenGitHub={onOpenGitHub}
                onDriftDismiss={onDriftDismiss}
                onDriftNewSession={onDriftNewSession}
              />
            ))}
            {!showAll && branches.length > MAX_VISIBLE_BRANCHES && (
              <button
                onClick={() => setShowAll(true)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#1a73e8",
                  fontSize: "0.75rem",
                  cursor: "pointer",
                  padding: "0.25rem 0",
                  textAlign: "center",
                }}
              >
                Show {branches.length - MAX_VISIBLE_BRANCHES} more
              </button>
            )}
          </div>
        )}
      </div>

      {/* Remote Environments Section */}
      {remoteEnvs.length > 0 && (
        <div>
          <div
            style={{
              fontSize: "0.6875rem",
              fontWeight: 600,
              color: "#6b7280",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: "0.25rem",
            }}
          >
            Remote Environments
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
            {remoteEnvs.map((env) => (
              <RemoteEnvRow key={env.id} env={env} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
