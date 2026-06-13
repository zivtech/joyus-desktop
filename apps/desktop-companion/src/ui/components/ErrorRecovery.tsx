import { useEffect, useState } from "react";

// ─── Tauri helpers ────────────────────────────────────────────────────────────

async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(cmd, args);
  } catch {
    return undefined;
  }
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const amberBannerStyle = {
  background: "#fffbeb",
  border: "1px solid #f59e0b",
  borderRadius: "8px",
  padding: "0.875rem 1rem",
  position: "relative" as const,
  display: "flex",
  flexDirection: "column" as const,
  gap: "0.625rem",
};

function outlineBtn(color: string) {
  return {
    padding: "0.375rem 0.875rem",
    background: "transparent",
    color: color,
    border: `1px solid ${color}`,
    borderRadius: "6px",
    fontSize: "0.8rem",
    fontWeight: 600,
    cursor: "pointer" as const,
  };
}

// ─── TimeoutAlert ─────────────────────────────────────────────────────────────

interface TimeoutAlertProps {
  engagementDir: string;
  engagementName: string;
  onMarkFailed: () => void;
  onKeepWaiting: (extraHours: number) => void;
}

export function TimeoutAlert({
  engagementDir,
  engagementName,
  onMarkFailed,
  onKeepWaiting,
}: TimeoutAlertProps) {
  const [dismissed, setDismissed] = useState(false);
  const [marking, setMarking] = useState(false);

  if (dismissed) return null;

  async function handleMarkFailed() {
    setMarking(true);
    await safeInvoke("recon_mark_failed", { engagementDir, reason: "timeout" });
    setMarking(false);
    onMarkFailed();
  }

  return (
    <div style={amberBannerStyle}>
      {/* Dismiss × */}
      <button
        onClick={() => { setDismissed(true); }}
        aria-label="Dismiss"
        style={{
          position: "absolute",
          top: "0.5rem",
          right: "0.75rem",
          background: "transparent",
          border: "none",
          fontSize: "1rem",
          color: "#92400e",
          cursor: "pointer",
          lineHeight: 1,
        }}
      >
        ×
      </button>

      <p style={{ margin: 0, fontSize: "0.875rem", color: "#92400e", paddingRight: "1.5rem" }}>
        Engagement <strong>'{engagementName}'</strong> may be stuck — it's been running for over
        2 hours with no completion signal.
      </p>

      <div style={{ display: "flex", gap: "0.625rem", flexWrap: "wrap" }}>
        <button
          onClick={() => { void handleMarkFailed(); }}
          disabled={marking}
          style={{
            ...outlineBtn("#ef4444"),
            opacity: marking ? 0.6 : 1,
            cursor: marking ? "not-allowed" : "pointer",
          }}
        >
          {marking ? "Marking…" : "Mark as Failed"}
        </button>
        <button
          onClick={() => { onKeepWaiting(1); }}
          style={outlineBtn("#6b7280")}
        >
          Keep Waiting (+1h)
        </button>
      </div>
    </div>
  );
}

// ─── CrashRecoveryBanner ──────────────────────────────────────────────────────

interface IncompleteEngagement {
  engagementDir: string;
  engagementName: string;
  createdAt: string;
}

function formatCreatedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function CrashRecoveryItem({
  engagement,
  onRemove,
}: {
  engagement: IncompleteEngagement;
  onRemove: () => void;
}) {
  const [abandonConfirm, setAbandonConfirm] = useState(false);
  const [working, setWorking] = useState(false);

  async function handleMarkFailed() {
    setWorking(true);
    await safeInvoke("recon_mark_failed", {
      engagementDir: engagement.engagementDir,
      reason: "app_crash",
    });
    setWorking(false);
    onRemove();
  }

  async function handleConfirmDelete() {
    setWorking(true);
    await safeInvoke("delete_engagement_dir", {
      engagementDir: engagement.engagementDir,
    });
    setWorking(false);
    onRemove();
  }

  return (
    <div style={amberBannerStyle}>
      <p style={{ margin: 0, fontSize: "0.875rem", color: "#92400e" }}>
        Incomplete engagement:{" "}
        <strong>'{engagement.engagementName}'</strong>{" "}
        (started {formatCreatedAt(engagement.createdAt)})
      </p>

      {!abandonConfirm ? (
        <div style={{ display: "flex", gap: "0.625rem", flexWrap: "wrap" }}>
          <button
            onClick={() => { void handleMarkFailed(); }}
            disabled={working}
            style={{
              ...outlineBtn("#ef4444"),
              opacity: working ? 0.6 : 1,
              cursor: working ? "not-allowed" : "pointer",
            }}
          >
            {working ? "Working…" : "Mark as Failed"}
          </button>
          <button
            onClick={() => { setAbandonConfirm(true); }}
            disabled={working}
            style={outlineBtn("#6b7280")}
          >
            Abandon
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <p style={{ margin: 0, fontSize: "0.813rem", color: "#b45309", fontWeight: 600 }}>
            This will permanently delete the engagement directory. Proceed?
          </p>
          <div style={{ display: "flex", gap: "0.625rem" }}>
            <button
              onClick={() => { void handleConfirmDelete(); }}
              disabled={working}
              style={{
                ...outlineBtn("#ef4444"),
                background: "#ef4444",
                color: "#fff",
                opacity: working ? 0.6 : 1,
                cursor: working ? "not-allowed" : "pointer",
              }}
            >
              {working ? "Deleting…" : "Confirm Delete"}
            </button>
            <button
              onClick={() => { setAbandonConfirm(false); }}
              disabled={working}
              style={outlineBtn("#6b7280")}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function CrashRecoveryBanner() {
  const [items, setItems] = useState<IncompleteEngagement[] | undefined>(undefined);

  useEffect(() => {
    void safeInvoke<IncompleteEngagement[]>("scan_incomplete_engagements").then((result) => {
      setItems(result ?? []);
    });
  }, []);

  // Not yet loaded, or no items
  if (items === undefined || items.length === 0) return null;

  function removeItem(dir: string) {
    setItems((prev) => (prev ?? []).filter((e) => e.engagementDir !== dir));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {items.map((eng) => (
        <CrashRecoveryItem
          key={eng.engagementDir}
          engagement={eng}
          onRemove={() => { removeItem(eng.engagementDir); }}
        />
      ))}
    </div>
  );
}

// ─── ScanFailurePanel ─────────────────────────────────────────────────────────

export interface ScanFinding {
  file: string;
  line: number;
  pattern: string;
}

interface ScanFailurePanelProps {
  findings: ScanFinding[];
  engagementDir: string;
  onAllOverridden: () => void;
}

interface FindingState {
  finding: ScanFinding;
  overridden: boolean;
  overrideReason: string;
  showForm: boolean;
  overrideError: string | undefined;
  overriding: boolean;
}

export function ScanFailurePanel({
  findings,
  engagementDir,
  onAllOverridden,
}: ScanFailurePanelProps) {
  const [rows, setRows] = useState<FindingState[]>(() =>
    findings.map((f) => ({
      finding: f,
      overridden: false,
      overrideReason: "",
      showForm: false,
      overrideError: undefined,
      overriding: false,
    }))
  );

  const allOverridden = rows.every((r) => r.overridden);

  // Fire onAllOverridden exactly once when the last finding is overridden
  const allOverriddenRef = { current: allOverridden };
  allOverriddenRef.current = allOverridden;

  useEffect(() => {
    if (allOverriddenRef.current && rows.length > 0) {
      onAllOverridden();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allOverridden]);

  function updateRow(index: number, patch: Partial<FindingState>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function handleConfirmOverride(index: number) {
    const row = rows[index];
    if (!row || row.overrideReason.length < 10) return;

    updateRow(index, { overriding: true, overrideError: undefined });

    const result = await safeInvoke("recon_override_finding", {
      engagementDir,
      finding: {
        file: row.finding.file,
        line: row.finding.line,
        pattern: row.finding.pattern,
      },
      reason: row.overrideReason,
    });

    if (result === undefined) {
      // Command doesn't exist or failed — record client-side override anyway
      updateRow(index, {
        overriding: false,
        overridden: true,
        showForm: false,
        overrideError: undefined,
      });
    } else {
      updateRow(index, { overriding: false, overridden: true, showForm: false });
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        border: "1px solid #fde68a",
        borderRadius: "8px",
        padding: "0.875rem",
        background: "#fffbeb",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "#b45309" }}>
          Scan Findings
        </span>
        <span
          style={{
            background: "#f59e0b",
            color: "#fff",
            borderRadius: "9999px",
            fontSize: "0.688rem",
            fontWeight: 700,
            padding: "0.125rem 0.5rem",
          }}
        >
          {rows.filter((r) => !r.overridden).length} remaining
        </span>
      </div>

      {/* Finding rows */}
      {rows.map((row, i) => (
        <div
          key={`${row.finding.file}:${row.finding.line}:${row.finding.pattern}`}
          style={{
            background: row.overridden ? "#f3f4f6" : "#fff",
            border: `1px solid ${row.overridden ? "#e5e7eb" : "#fde68a"}`,
            borderRadius: "6px",
            padding: "0.625rem 0.75rem",
            opacity: row.overridden ? 0.6 : 1,
            display: "flex",
            flexDirection: "column",
            gap: "0.375rem",
          }}
        >
          {/* Finding info row */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <span
              style={{
                fontFamily: "monospace",
                fontSize: "0.813rem",
                color: "#374151",
                flex: 1,
                wordBreak: "break-all",
              }}
            >
              {row.finding.file}:{row.finding.line}
            </span>
            <span
              style={{
                background: "#fef3c7",
                color: "#92400e",
                border: "1px solid #fde68a",
                borderRadius: "4px",
                fontSize: "0.688rem",
                fontWeight: 600,
                padding: "0.125rem 0.375rem",
                flexShrink: 0,
              }}
            >
              {row.finding.pattern}
            </span>
            {row.overridden ? (
              <span style={{ fontSize: "0.75rem", color: "#6b7280", fontWeight: 600 }}>
                Overridden ✓
              </span>
            ) : (
              <button
                onClick={() => { updateRow(i, { showForm: !row.showForm }); }}
                style={outlineBtn("#f59e0b")}
              >
                Override
              </button>
            )}
          </div>

          {/* Inline override form */}
          {!row.overridden && row.showForm && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
              <input
                type="text"
                value={row.overrideReason}
                onChange={(e) => {
                  updateRow(i, { overrideReason: e.currentTarget.value });
                }}
                placeholder="Reason for override (min 10 chars)"
                style={{
                  padding: "0.375rem 0.625rem",
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  fontSize: "0.813rem",
                  outline: "none",
                }}
              />
              {row.overrideError !== undefined && (
                <span style={{ fontSize: "0.75rem", color: "#ef4444" }}>{row.overrideError}</span>
              )}
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  onClick={() => { void handleConfirmOverride(i); }}
                  disabled={row.overrideReason.length < 10 || row.overriding}
                  style={{
                    padding: "0.375rem 0.875rem",
                    background:
                      row.overrideReason.length < 10 || row.overriding ? "#d1d5db" : "#f59e0b",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    cursor:
                      row.overrideReason.length < 10 || row.overriding ? "not-allowed" : "pointer",
                  }}
                >
                  {row.overriding ? "Confirming…" : "Confirm Override"}
                </button>
                <button
                  onClick={() => { updateRow(i, { showForm: false, overrideReason: "" }); }}
                  style={outlineBtn("#6b7280")}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
