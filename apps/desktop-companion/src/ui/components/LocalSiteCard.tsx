import { useState } from "react";

export interface LocalSite {
  readonly id: string;
  readonly projectName: string;
  readonly repoUrl: string;
  readonly repoPath: string;
  readonly ddevProjectName: string;
  readonly httpUrl?: string;
  readonly httpsUrl?: string;
  readonly status: "running" | "stopped" | "starting" | "error";
  readonly errorMessage?: string;
}

type PendingOp = "start" | "stop" | "restart" | undefined;

async function safeInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T | undefined> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  } catch {
    return undefined;
  }
}

const STATUS_COLORS: Record<LocalSite["status"], string> = {
  running: "#22c55e",
  stopped: "#6b7280",
  starting: "#f59e0b",
  error: "#ef4444",
};

const STATUS_LABELS: Record<LocalSite["status"], string> = {
  running: "Running",
  stopped: "Stopped",
  starting: "Starting",
  error: "Error",
};

interface ActionButtonProps {
  label: string;
  disabled: boolean;
  pending: boolean;
  onClick: () => void;
}

function ActionButton({ label, disabled, pending, onClick }: ActionButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "0.25rem 0.625rem",
        fontSize: "0.813rem",
        border: "1px solid #d1d5db",
        borderRadius: "4px",
        background: disabled ? "#f3f4f6" : "#fff",
        color: disabled ? "#9ca3af" : "#374151",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
        minWidth: "58px",
        justifyContent: "center",
      }}
    >
      {pending ? (
        <span
          style={{
            display: "inline-block",
            width: "10px",
            height: "10px",
            border: "2px solid #d1d5db",
            borderTopColor: "#6b7280",
            borderRadius: "50%",
            animation: "spin 0.6s linear infinite",
          }}
        />
      ) : null}
      {label}
    </button>
  );
}

interface LocalSiteCardProps {
  site: LocalSite;
}

export function LocalSiteCard({ site }: LocalSiteCardProps) {
  const [pendingOp, setPendingOp] = useState<PendingOp>(undefined);

  const isRunning = site.status === "running";
  const isStopped = site.status === "stopped" || site.status === "error";
  const isBusy = pendingOp !== undefined || site.status === "starting";

  function runAction(op: "start" | "stop" | "restart") {
    if (isBusy) return;
    setPendingOp(op);
    void safeInvoke(`site_${op}`, { siteId: site.id }).finally(() => {
      setPendingOp(undefined);
    });
  }

  const color = STATUS_COLORS[site.status];
  const label = STATUS_LABELS[site.status];

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "1rem",
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }}
    >
      {/* Name and status */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 600, fontSize: "0.938rem", color: "#111827" }}>
          {site.projectName}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: color,
              display: "inline-block",
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: "0.813rem", color: "#374151" }}>{label}</span>
        </span>
      </div>

      {/* Repo path */}
      <div style={{ fontSize: "0.813rem", color: "#6b7280", fontFamily: "monospace" }}>
        {site.repoPath}
      </div>

      {/* URLs */}
      {(site.httpUrl || site.httpsUrl) && (
        <div style={{ display: "flex", gap: "0.75rem", fontSize: "0.813rem" }}>
          {site.httpsUrl && (
            <a
              href={site.httpsUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#1a73e8", textDecoration: "none" }}
            >
              HTTPS
            </a>
          )}
          {site.httpUrl && (
            <a
              href={site.httpUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#1a73e8", textDecoration: "none" }}
            >
              HTTP
            </a>
          )}
        </div>
      )}

      {/* Error message */}
      {site.status === "error" && site.errorMessage !== undefined && (
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
          {site.errorMessage}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
        <ActionButton
          label="Start"
          disabled={isRunning || isBusy}
          pending={pendingOp === "start"}
          onClick={() => { runAction("start"); }}
        />
        <ActionButton
          label="Stop"
          disabled={isStopped || isBusy}
          pending={pendingOp === "stop"}
          onClick={() => { runAction("stop"); }}
        />
        <ActionButton
          label="Restart"
          disabled={!isRunning || (isBusy && pendingOp !== "restart")}
          pending={pendingOp === "restart"}
          onClick={() => { runAction("restart"); }}
        />
      </div>
    </div>
  );
}
