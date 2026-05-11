import { useEffect, useRef, useState } from "react";

// ─── Tauri helpers ────────────────────────────────────────────────────────────

async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  } catch {
    return undefined;
  }
}

async function safeListen(
  event: string,
  handler: (payload: unknown) => void
): Promise<() => void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen(event, (e) => handler(e.payload));
  } catch {
    return () => undefined;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type EngagementStatusValue = "running" | "complete" | "error" | "cancelled" | "unknown";

interface ScanFinding {
  file: string;
  line: number;
  pattern: string;
}

interface ScanResult {
  pass: boolean;
  findings?: ScanFinding[];
}

interface ExportResult {
  zipPath: string;
  fileSizeBytes?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatElapsed(startMs: number, nowMs: number): string {
  const totalSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function nowLabel(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `[${hh}:${mm}:${ss}]`;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<EngagementStatusValue, { bg: string; text: string }> = {
  running: { bg: "#1a73e8", text: "#fff" },
  complete: { bg: "#22c55e", text: "#fff" },
  error: { bg: "#ef4444", text: "#fff" },
  cancelled: { bg: "#6b7280", text: "#fff" },
  unknown: { bg: "#e5e7eb", text: "#374151" },
};

function StatusBadge({ status }: { status: EngagementStatusValue }) {
  const { bg, text } = STATUS_COLORS[status];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.125rem 0.625rem",
        borderRadius: "9999px",
        background: bg,
        color: text,
        fontSize: "0.75rem",
        fontWeight: 600,
        textTransform: "capitalize",
      }}
    >
      {status}
    </span>
  );
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

if (typeof document !== "undefined") {
  const id = "engagement-status-spin";
  if (document.getElementById(id) === null) {
    const style = document.createElement("style");
    style.id = id;
    style.textContent = "@keyframes spin { to { transform: rotate(360deg); } }";
    document.head.appendChild(style);
  }
}

function Spinner({ size = "1rem" }: { size?: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        border: "2px solid #e5e7eb",
        borderTop: "2px solid #1a73e8",
        borderRadius: "50%",
        animation: "spin 0.75s linear infinite",
        flexShrink: 0,
      }}
    />
  );
}

// ─── Scan + Export panel ──────────────────────────────────────────────────────

interface ScanExportPanelProps {
  engagementDir: string;
}

function ScanExportPanel({ engagementDir }: ScanExportPanelProps) {
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | undefined>(undefined);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResult | undefined>(undefined);
  const [exportError, setExportError] = useState<string | undefined>(undefined);
  const [overrideConfirmed, setOverrideConfirmed] = useState(false);

  async function handleScan() {
    setScanning(true);
    setScanResult(undefined);
    setExportResult(undefined);
    setExportError(undefined);
    setOverrideConfirmed(false);

    const result = await safeInvoke<ScanResult>("recon_scan", {
      params: { engagementDir },
    });
    setScanResult(result ?? { pass: false, findings: [] });
    setScanning(false);
  }

  async function handleExport(override = false) {
    setExporting(true);
    setExportError(undefined);

    const result = await safeInvoke<ExportResult>("recon_export", {
      params: { engagementDir, overrideScan: override },
    });

    if (result === undefined) {
      setExportError("Export failed — sidecar may not be running.");
    } else {
      setExportResult(result);
    }
    setExporting(false);
  }

  function handleOverride() {
    if (window.confirm("Override scan findings and export anyway? (dogfood only)")) {
      setOverrideConfirmed(true);
      void handleExport(true);
    }
  }

  const canExport = scanResult?.pass === true || overrideConfirmed;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1rem" }}>
      <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: 0 }} />
      <p style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600, color: "#374151" }}>
        Post-Completion
      </p>

      {/* Scan button */}
      {scanResult === undefined && !scanning && (
        <button
          onClick={() => { void handleScan(); }}
          style={{
            alignSelf: "flex-start",
            padding: "0.5rem 1.25rem",
            background: "#1a73e8",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            fontSize: "0.875rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Scan Output
        </button>
      )}

      {scanning && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", color: "#6b7280" }}>
          <Spinner />
          Scanning for sensitive content…
        </div>
      )}

      {scanResult !== undefined && (
        <>
          {scanResult.pass ? (
            <div
              style={{
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: "6px",
                padding: "0.625rem 0.875rem",
                fontSize: "0.875rem",
                color: "#15803d",
                fontWeight: 600,
              }}
            >
              Scan passed — no sensitive content detected.
            </div>
          ) : (
            <div
              style={{
                background: "#fffbeb",
                border: "1px solid #fde68a",
                borderRadius: "6px",
                padding: "0.625rem 0.875rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
              }}
            >
              <p style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600, color: "#b45309" }}>
                Scan found potential sensitive content:
              </p>
              {(scanResult.findings ?? []).map((f, i) => (
                <div key={i} style={{ fontSize: "0.75rem", color: "#92400e", fontFamily: "monospace" }}>
                  {f.file}:{f.line} — {f.pattern}
                </div>
              ))}
              <button
                onClick={handleOverride}
                disabled={overrideConfirmed}
                style={{
                  alignSelf: "flex-start",
                  padding: "0.375rem 0.875rem",
                  background: overrideConfirmed ? "#d1d5db" : "#f59e0b",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  cursor: overrideConfirmed ? "not-allowed" : "pointer",
                }}
              >
                Override (dogfood only)
              </button>
            </div>
          )}

          {/* Export */}
          {exportResult === undefined && !exporting && (
            <button
              onClick={() => { void handleExport(false); }}
              disabled={!canExport}
              style={{
                alignSelf: "flex-start",
                padding: "0.5rem 1.25rem",
                background: canExport ? "#22c55e" : "#d1d5db",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: canExport ? "pointer" : "not-allowed",
              }}
            >
              Export
            </button>
          )}

          {exporting && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", color: "#6b7280" }}>
              <Spinner />
              Exporting…
            </div>
          )}

          {exportError !== undefined && (
            <div
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: "6px",
                padding: "0.625rem 0.875rem",
                fontSize: "0.813rem",
                color: "#dc2626",
              }}
            >
              {exportError}
            </div>
          )}

          {exportResult !== undefined && (
            <div
              style={{
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: "6px",
                padding: "0.875rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.375rem",
              }}
            >
              <p style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600, color: "#15803d" }}>
                Export complete
              </p>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "#374151", fontFamily: "monospace", wordBreak: "break-all" }}>
                {exportResult.zipPath}
              </p>
              {exportResult.fileSizeBytes !== undefined && (
                <p style={{ margin: 0, fontSize: "0.75rem", color: "#6b7280" }}>
                  {formatBytes(exportResult.fileSizeBytes)}
                </p>
              )}
              {/* TODO: Reveal in Finder (requires Tauri shell open command) */}
              <p style={{ margin: 0, fontSize: "0.75rem", color: "#6b7280", fontStyle: "italic" }}>
                (Reveal in Finder: TODO — requires shell.open integration)
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface EngagementStatusProps {
  engagementId: string;
  engagementDir: string;
  onBack: () => void;
}

export function EngagementStatus({ engagementId, engagementDir, onBack }: EngagementStatusProps) {
  const [status, setStatus] = useState<EngagementStatusValue>("running");
  const [currentPhase, setCurrentPhase] = useState<string | undefined>(undefined);
  const [log, setLog] = useState<string[]>([]);
  const [startMs] = useState(() => Date.now());
  const [elapsedLabel, setElapsedLabel] = useState("0m 0s");
  const [cancelling, setCancelling] = useState(false);

  const logEndRef = useRef<HTMLDivElement | null>(null);

  const isTerminal = status === "complete" || status === "error" || status === "cancelled";

  // ── Elapsed timer ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (isTerminal) return;
    const timer = setInterval(() => {
      setElapsedLabel(formatElapsed(startMs, Date.now()));
    }, 1000);
    return () => clearInterval(timer);
  }, [isTerminal, startMs]);

  // ── Real-time streaming ────────────────────────────────────────────────────
  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenEnd: (() => void) | undefined;

    void (async () => {
      unlistenProgress = await safeListen("recon:progress", (payload) => {
        const event = payload as { type?: string; content?: string; phase?: string; [key: string]: unknown };
        const line = (() => {
          if (typeof event.content === "string") return event.content;
          try { return JSON.stringify(event); } catch { return String(event); }
        })();

        setLog((prev) => {
          const next = [...prev, `${nowLabel()} ${line}`];
          return next.length > 100 ? next.slice(next.length - 100) : next;
        });

        if (event.type === "phase" && typeof event.phase === "string") {
          setCurrentPhase(event.phase);
        }
        if (event.type === "error") {
          setStatus("error");
        }
      });

      unlistenEnd = await safeListen("recon:stream-end", (payload) => {
        const event = payload as { engagementId?: string };
        if (event?.engagementId === engagementId) {
          setStatus("complete");
        }
      });
    })();

    return () => {
      unlistenProgress?.();
      unlistenEnd?.();
    };
  }, [engagementId]);

  // ── Polling fallback (every 10s) ───────────────────────────────────────────
  useEffect(() => {
    if (isTerminal) return;

    const poll = setInterval(() => {
      void safeInvoke<{ status?: string }>("get_engagement_status", {
        engagement_id: engagementId,
      }).then((result) => {
        if (result?.status !== undefined) {
          const s = result.status as EngagementStatusValue;
          setStatus((prev) => {
            if (prev === s) return prev;
            if (prev === "complete" || prev === "error" || prev === "cancelled") return prev;
            return s;
          });
        }
      });
    }, 10000);

    return () => clearInterval(poll);
  }, [engagementId, isTerminal]);

  // ── Auto-scroll to bottom ──────────────────────────────────────────────────
  useEffect(() => {
    if (logEndRef.current !== null) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [log.length]);

  async function handleCancel() {
    setCancelling(true);
    await safeInvoke("cancel_engagement", { engagement_id: engagementId });
    setStatus("cancelled");
    setCancelling(false);
  }

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: "10px",
        padding: "1.5rem",
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#111827", fontFamily: "monospace" }}>
          {engagementId}
        </h2>
        <StatusBadge status={status} />
      </div>

      {/* Meta row */}
      <div style={{ display: "flex", gap: "1.5rem", fontSize: "0.813rem", color: "#6b7280", flexWrap: "wrap" }}>
        <span>Elapsed: <strong style={{ color: "#374151" }}>{elapsedLabel}</strong></span>
        {currentPhase !== undefined && (
          <span>Phase: <strong style={{ color: "#374151" }}>{currentPhase}</strong></span>
        )}
      </div>

      {/* Progress log */}
      <div
        style={{
          maxHeight: "240px",
          overflowY: "auto",
          background: "#f9fafb",
          border: "1px solid #e5e7eb",
          borderRadius: "6px",
          padding: "0.75rem",
          fontFamily: "'SF Mono', Monaco, monospace",
          fontSize: "0.75rem",
          color: "#374151",
          lineHeight: 1.6,
        }}
      >
        {log.length === 0 ? (
          <span style={{ color: "#9ca3af" }}>Waiting for output…</span>
        ) : (
          log.map((line, i) => (
            <div key={i}>{line}</div>
          ))
        )}
        <div ref={logEndRef} />
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
        <button
          onClick={onBack}
          style={{
            padding: "0.5rem 1rem",
            background: "transparent",
            color: "#6b7280",
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            fontSize: "0.875rem",
            cursor: "pointer",
          }}
        >
          Back
        </button>

        {status === "running" && (
          <button
            onClick={() => { void handleCancel(); }}
            disabled={cancelling}
            style={{
              padding: "0.5rem 1rem",
              background: cancelling ? "#d1d5db" : "#ef4444",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: cancelling ? "not-allowed" : "pointer",
            }}
          >
            {cancelling ? "Cancelling…" : "Cancel"}
          </button>
        )}
      </div>

      {/* Post-completion panel */}
      {status === "complete" && (
        <ScanExportPanel engagementDir={engagementDir} />
      )}
    </div>
  );
}
