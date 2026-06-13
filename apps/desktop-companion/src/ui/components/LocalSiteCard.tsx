import { useEffect, useRef, useState } from "react";
import { BranchCountBadge } from "./BranchCountBadge.js";
import { SiteActivityIndicator } from "./SiteActivityIndicator.js";

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

async function openUrl(url: string): Promise<void> {
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  } catch {
    window.open(url, "_blank");
  }
}

const STATUS_COLORS: Record<LocalSite["status"], string> = {
  running: "#22c55e",
  stopped: "#94a3b8",
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
  destructive?: boolean;
}

function ActionButton({ label, disabled, pending, onClick, destructive = false }: ActionButtonProps) {
  const textColor = disabled
    ? "#9ca3af"
    : destructive
      ? "#dc2626"
      : "#374151";

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
        color: textColor,
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
  onRemoved: () => void;
  expanded?: boolean | undefined;
  onToggleExpand?: (() => void) | undefined;
  branchCounts?: { active: number; total: number } | undefined;
  lastBranchActivity?: number | undefined;
  children?: React.ReactNode | undefined;
}

export function LocalSiteCard({
  site,
  onRemoved,
  expanded = false,
  onToggleExpand,
  branchCounts,
  lastBranchActivity,
  children,
}: LocalSiteCardProps) {
  const [pendingOp, setPendingOp] = useState<PendingOp>(undefined);
  const [removing, setRemoving] = useState(false);
  const chevronRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!expanded || onToggleExpand === undefined) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onToggleExpand!();
        chevronRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [expanded, onToggleExpand]);

  const isRunning = site.status === "running";
  const isStopped = site.status === "stopped" || site.status === "error";
  const isBusy = pendingOp !== undefined || site.status === "starting" || removing;

  function runAction(op: "start" | "stop" | "restart") {
    if (isBusy) return;
    setPendingOp(op);
    void safeInvoke(`site_${op}`, { siteId: site.id }).finally(() => {
      setPendingOp(undefined);
    });
  }

  function handleOpen() {
    const url = site.httpsUrl ?? site.httpUrl;
    if (url === undefined) return;
    void openUrl(url);
  }

  function handleRemove() {
    if (isBusy) return;
    const branchCount = branchCounts?.active ?? 0;
    const msg = branchCount > 0
      ? `Remove "${site.projectName}"? This site has ${branchCount} active task(s) that will also be removed. This cannot be undone.`
      : `Remove "${site.projectName}"? This cannot be undone.`;
    if (!window.confirm(msg)) return;
    setRemoving(true);
    void safeInvoke("site_remove", { siteId: site.id }).finally(() => {
      setRemoving(false);
      onRemoved();
    });
  }

  const color = STATUS_COLORS[site.status];
  const label = STATUS_LABELS[site.status];
  const openableUrl = site.httpsUrl ?? site.httpUrl;

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "0.875rem 1rem",
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        gap: "0.375rem",
      }}
    >
      {/* Header: Name + Status + Branch count */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
        <span
          id={`site-name-${site.id}`}
          style={{
            fontWeight: 600,
            fontSize: "0.938rem",
            color: "#111827",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            minWidth: 0,
          }}
        >
          {site.projectName}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.75rem", flexShrink: 0 }}>
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
          {branchCounts !== undefined && (
            <BranchCountBadge active={branchCounts.active} total={branchCounts.total} />
          )}
        </span>
      </div>

      {/* Repo path + activity indicator */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.813rem", color: "#6b7280", fontFamily: "monospace" }}>
          {site.repoPath}
        </span>
        {lastBranchActivity !== undefined && (
          <SiteActivityIndicator lastActivityAt={lastBranchActivity} />
        )}
      </div>

      {/* URLs */}
      {(site.httpUrl !== undefined || site.httpsUrl !== undefined) && (
        <div style={{ display: "flex", gap: "0.75rem", fontSize: "0.813rem" }}>
          {site.httpsUrl !== undefined && (
            <a
              href={site.httpsUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#1a73e8", textDecoration: "none" }}
            >
              HTTPS
            </a>
          )}
          {site.httpUrl !== undefined && (
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

      {/* Action buttons + chevron */}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem", flexWrap: "wrap", alignItems: "center" }}>
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
        {openableUrl !== undefined && (
          <ActionButton
            label="Open"
            disabled={isBusy}
            pending={false}
            onClick={handleOpen}
          />
        )}
        <ActionButton
          label="Remove"
          disabled={isBusy}
          pending={removing}
          onClick={handleRemove}
          destructive
        />
        {onToggleExpand !== undefined && (
          <button
            ref={chevronRef}
            onClick={onToggleExpand}
            aria-expanded={expanded}
            aria-controls={`site-detail-${site.id}`}
            style={{
              marginLeft: "auto",
              background: "transparent",
              border: "1px solid #d1d5db",
              borderRadius: "4px",
              padding: "0.25rem 0.5rem",
              fontSize: "0.813rem",
              cursor: "pointer",
              color: "#374151",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            {expanded ? "▲" : "▼"}
          </button>
        )}
      </div>

      {/* Expanded content */}
      {expanded && children !== undefined && (
        <div
          id={`site-detail-${site.id}`}
          role="region"
          aria-labelledby={`site-name-${site.id}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
