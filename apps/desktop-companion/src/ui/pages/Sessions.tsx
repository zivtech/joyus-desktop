import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DriftBanner, type DriftSignalPayload } from "../components/DriftBanner";
import { TaskBranchCard, type TaskBranch, buildGitHubDesktopUrl } from "../components/TaskBranchCard";

// Re-export for testability (T035)
export { buildGitHubDesktopUrl };

// ─── IPC helpers ─────────────────────────────────────────────────────────────

async function safeInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T | undefined> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  } catch (err) {
    console.error(`[safeInvoke] ${cmd} failed:`, err);
    return undefined;
  }
}

async function safeListen<T>(
  event: string,
  handler: (e: { payload: T }) => void
): Promise<() => void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<T>(event, handler);
  } catch {
    return () => undefined;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface BatchCleanupResult {
  removed: number;
  failed: Array<{ missionLabel: string; reason: string }>;
}

// ─── Sessions page ────────────────────────────────────────────────────────────

export function Sessions() {
  const navigate = useNavigate();

  const [branches, setBranches] = useState<TaskBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [driftSignals, setDriftSignals] = useState<DriftSignalPayload[]>([]);
  const [mode, setMode] = useState<"managed" | "advisory" | undefined>(
    undefined
  );
  const modeNoteTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<string | undefined>(
    undefined
  );
  const [pendingDeleteHasChanges, setPendingDeleteHasChanges] = useState(false);
  const [batchResult, setBatchResult] = useState<
    BatchCleanupResult | undefined
  >(undefined);
  const [modeChangedNote, setModeChangedNote] = useState(false);

  // ── On mount: load list + mode + subscribe to drift ──────────────────────

  useEffect(() => {
    void safeInvoke<TaskBranch[]>("session_list").then((result) => {
      if (result !== undefined) {
        setBranches(result);
      } else {
        setError("Could not load tasks.");
      }
      setLoading(false);
    });

    void safeInvoke<{ mode: "managed" | "advisory" }>(
      "session_get_mode"
    ).then((result) => {
      if (result !== undefined) {
        setMode(result.mode);
      }
    });

    let unlisten: (() => void) | undefined;
    void safeListen<DriftSignalPayload>("state.driftSignal", (e) => {
      setDriftSignals((prev) => {
        const filtered = prev.filter(
          (s) => s.taskBranchId !== e.payload.taskBranchId
        );
        return [...filtered, e.payload];
      });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
      if (modeNoteTimerRef.current !== undefined) {
        clearTimeout(modeNoteTimerRef.current);
      }
    };
  }, []);

  // ── Delete flow ───────────────────────────────────────────────────────────

  async function onDelete(id: string) {
    const result = await safeInvoke<{ hasUncommittedChanges: boolean }>(
      "session_has_uncommitted_changes",
      { taskBranchId: id }
    );
    const hasChanges = result?.hasUncommittedChanges === true;
    setPendingDelete(id);
    setPendingDeleteHasChanges(hasChanges);
  }

  async function confirmDelete(id: string, force: boolean) {
    await safeInvoke("session_delete", { taskBranchId: id, force });
    setBranches((prev) => prev.filter((b) => b.id !== id));
    setPendingDelete(undefined);
    setPendingDeleteHasChanges(false);
  }

  function cancelDelete() {
    setPendingDelete(undefined);
    setPendingDeleteHasChanges(false);
  }

  // ── Batch cleanup ─────────────────────────────────────────────────────────

  async function handleBatchCleanup() {
    const stale = branches.filter((b) => b.status === "stale");
    let removed = 0;
    const failed: BatchCleanupResult["failed"] = [];

    for (const b of stale) {
      try {
        await safeInvoke("session_delete", {
          taskBranchId: b.id,
          force: false,
        });
        removed++;
      } catch {
        failed.push({ missionLabel: b.missionLabel, reason: "Could not be removed." });
      }
    }

    setBatchResult({ removed, failed });

    // Refresh list
    const updated = await safeInvoke<TaskBranch[]>("session_list");
    if (updated !== undefined) {
      setBranches(updated);
    }
  }

  // ── Mode toggle ───────────────────────────────────────────────────────────

  async function handleModeChange(newMode: "managed" | "advisory") {
    await safeInvoke("session_set_mode", { mode: newMode });
    setMode(newMode);
    setModeChangedNote(true);
    if (modeNoteTimerRef.current !== undefined) {
      clearTimeout(modeNoteTimerRef.current);
    }
    modeNoteTimerRef.current = setTimeout(() => {
      modeNoteTimerRef.current = undefined;
      setModeChangedNote(false);
    }, 4000);
  }

  // ── GitHub Desktop ────────────────────────────────────────────────────────

  async function openInGitHubDesktop(repoPath: string) {
    const url = buildGitHubDesktopUrl(repoPath);
    await safeInvoke("open_url", { url });
  }

  function onOpenGitHub(repoPath: string, _branchName: string) {
    void openInGitHubDesktop(repoPath);
  }

  // ── Drift handlers ────────────────────────────────────────────────────────

  function onDismissDrift(id: string) {
    setDriftSignals((prev) => prev.filter((s) => s.taskBranchId !== id));
  }

  function onNewSession(id: string) {
    setDriftSignals((prev) => prev.filter((s) => s.taskBranchId !== id));
    navigate("/");
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const hasStale = branches.some((b) => b.status === "stale");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Page header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>
          My Tasks
        </h1>

        {/* Mode toggle */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.375rem",
            alignItems: "flex-end",
          }}
        >
          <div
            style={{
              fontSize: "0.8125rem",
              color: "#6b7280",
              fontWeight: 500,
            }}
          >
            Automation mode
          </div>
          <div style={{ display: "flex", gap: "0.375rem" }}>
            <button
              onClick={() => void handleModeChange("managed")}
              style={{
                background: mode === "managed" ? "#1a73e8" : "transparent",
                color: mode === "managed" ? "#fff" : "#374151",
                border: mode === "managed"
                  ? "1px solid #1a73e8"
                  : "1px solid #d1d5db",
                borderRadius: "6px",
                padding: "0.3125rem 0.625rem",
                fontSize: "0.8125rem",
                cursor: "pointer",
                fontWeight: mode === "managed" ? 600 : 400,
              }}
            >
              Auto-managed
            </button>
            <button
              onClick={() => void handleModeChange("advisory")}
              style={{
                background: mode === "advisory" ? "#1a73e8" : "transparent",
                color: mode === "advisory" ? "#fff" : "#374151",
                border: mode === "advisory"
                  ? "1px solid #1a73e8"
                  : "1px solid #d1d5db",
                borderRadius: "6px",
                padding: "0.3125rem 0.625rem",
                fontSize: "0.8125rem",
                cursor: "pointer",
                fontWeight: mode === "advisory" ? 600 : 400,
              }}
            >
              Advisory
            </button>
          </div>
          {modeChangedNote && (
            <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
              Affects new tasks only. Existing tasks are not changed.
            </div>
          )}
        </div>
      </div>

      {/* Drift banners */}
      {driftSignals.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {driftSignals.map((signal) => (
            <DriftBanner
              key={signal.taskBranchId}
              signal={signal}
              onDismiss={onDismissDrift}
              onNewSession={onNewSession}
            />
          ))}
        </div>
      )}

      {/* Main content */}
      {loading ? (
        <p style={{ color: "#6b7280", fontSize: "0.875rem" }}>
          Loading your tasks…
        </p>
      ) : error !== undefined ? (
        <p style={{ color: "#ef4444", fontSize: "0.875rem" }}>{error}</p>
      ) : branches.length === 0 ? (
        <p style={{ color: "#6b7280", fontSize: "0.875rem" }}>
          No active tasks. Start a task to see it here.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {branches.map((branch) => (
            <TaskBranchCard
              key={branch.id}
              branch={branch}
              pendingDelete={pendingDelete === branch.id && !pendingDeleteHasChanges}
              onResume={(id) => void safeInvoke("session_resume", { taskBranchId: id })}
              onDelete={(id) => void onDelete(id)}
              onConfirmDelete={(id) => void confirmDelete(id, false)}
              onCancelDelete={cancelDelete}
              onOpenGitHub={onOpenGitHub}
            />
          ))}
        </div>
      )}

      {/* Warning modal for uncommitted changes */}
      {pendingDelete !== undefined && pendingDeleteHasChanges && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "10px",
              padding: "1.5rem",
              maxWidth: "420px",
              width: "90%",
              boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: "1.125rem",
                fontWeight: 700,
                color: "#111827",
              }}
            >
              This task has unsaved changes
            </h2>
            <p style={{ margin: 0, fontSize: "0.875rem", color: "#374151" }}>
              Removing this task will discard changes that haven&apos;t been
              saved. This cannot be undone.
            </p>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button
                onClick={cancelDelete}
                style={{
                  background: "transparent",
                  color: "#374151",
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  padding: "0.5rem 1rem",
                  fontSize: "0.875rem",
                  cursor: "pointer",
                }}
              >
                Keep It
              </button>
              <button
                onClick={() =>
                  void confirmDelete(pendingDelete, true)
                }
                style={{
                  background: "#ef4444",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  padding: "0.5rem 1rem",
                  fontSize: "0.875rem",
                  cursor: "pointer",
                  fontWeight: 500,
                }}
              >
                Remove Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch cleanup */}
      {hasStale && (
        <div>
          <button
            onClick={() => void handleBatchCleanup()}
            style={{
              background: "transparent",
              color: "#374151",
              border: "1px solid #d1d5db",
              borderRadius: "6px",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            Clean up inactive tasks
          </button>
        </div>
      )}

      {/* Batch result */}
      {batchResult !== undefined && (
        <div
          style={{
            fontSize: "0.875rem",
            color: "#374151",
            background: "#f9fafb",
            border: "1px solid #e5e7eb",
            borderRadius: "6px",
            padding: "0.625rem 0.875rem",
          }}
        >
          {batchResult.failed.length === 0 ? (
            <span>Removed {batchResult.removed} inactive tasks.</span>
          ) : (
            <span>
              Removed {batchResult.removed} tasks. {batchResult.failed.length}{" "}
              could not be removed:{" "}
              {batchResult.failed.map((f) => f.missionLabel).join(", ")}.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
