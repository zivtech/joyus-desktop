import { useState } from "react";
import { StatusBadge } from "./StatusBadge";
import type { ServerInfo } from "../hooks/useServerStatus";

interface ServerCardProps {
  server: ServerInfo;
}

type PendingOp = "start" | "stop" | "restart" | undefined;

interface Toast {
  id: number;
  message: string;
  kind: "success" | "error";
}

let toastId = 0;

export function buildServerActionArgs(server: Pick<ServerInfo, "name">): { name: string } {
  return { name: server.name };
}

async function safeInvoke(cmd: string, args: Record<string, unknown>): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke(cmd, args);
}

function formatUptime(seconds: number | undefined): string {
  if (seconds === undefined) return "\u2014";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function ActionButton({
  label,
  disabled,
  pending,
  onClick,
}: {
  label: string;
  disabled: boolean;
  pending: boolean;
  onClick: () => void;
}) {
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

export function ServerCard({ server }: ServerCardProps) {
  const [pendingOp, setPendingOp] = useState<PendingOp>(undefined);
  const [optimisticStatus, setOptimisticStatus] = useState<ServerInfo["status"] | undefined>(
    undefined
  );
  const [toasts, setToasts] = useState<Toast[]>([]);

  const effectiveStatus = optimisticStatus ?? server.status;
  const isRunning = effectiveStatus === "running";
  const isStopped = effectiveStatus === "stopped" || effectiveStatus === "error";
  const isTransitioning = effectiveStatus === "starting";
  const isBusy = pendingOp !== undefined || isTransitioning;

  function showToast(message: string, kind: "success" | "error") {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, kind }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }

  function runAction(
    op: "start" | "stop" | "restart",
    cmd: string,
    optimistic: ServerInfo["status"]
  ) {
    if (isBusy) return;
    setPendingOp(op);
    setOptimisticStatus(optimistic);
    safeInvoke(cmd, buildServerActionArgs(server))
      .then(() => {
        showToast(`${op.charAt(0).toUpperCase() + op.slice(1)} succeeded`, "success");
      })
      .catch((err: unknown) => {
        setOptimisticStatus(undefined);
        showToast(
          `Failed to ${op} server: ${err instanceof Error ? err.message : String(err)}`,
          "error"
        );
      })
      .finally(() => {
        setPendingOp(undefined);
      });
  }

  const handleStart = () => { runAction("start", "start_server", "starting"); };
  const handleStop = () => { runAction("stop", "stop_server", "stopped"); };
  const handleRestart = () => { runAction("restart", "restart_server", "starting"); };

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
        position: "relative",
      }}
    >
      {/* Toasts */}
      {toasts.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "0.5rem",
            right: "0.5rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
            zIndex: 10,
          }}
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              style={{
                padding: "0.375rem 0.625rem",
                borderRadius: "4px",
                fontSize: "0.75rem",
                background: t.kind === "success" ? "#d1fae5" : "#fee2e2",
                color: t.kind === "success" ? "#065f46" : "#991b1b",
                border: `1px solid ${t.kind === "success" ? "#6ee7b7" : "#fca5a5"}`,
                maxWidth: "220px",
              }}
            >
              {t.message}
            </div>
          ))}
        </div>
      )}

      {/* Name and status */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 600, fontSize: "0.938rem", color: "#111827" }}>
          {server.name}
        </span>
        <StatusBadge status={effectiveStatus} />
      </div>

      {/* Meta row */}
      <div style={{ display: "flex", gap: "1rem", fontSize: "0.813rem", color: "#6b7280" }}>
        <span>PID: {server.pid ?? "\u2014"}</span>
        <span>Uptime: {formatUptime(server.uptime)}</span>
        <span>Restarts: {server.restartCount}</span>
      </div>

      {/* Error message */}
      {"lastError" in server && typeof (server as Record<string, unknown>)["lastError"] === "string" && (
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
          {(server as Record<string, unknown>)["lastError"] as string}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
        <ActionButton
          label="Start"
          disabled={isRunning || isBusy}
          pending={pendingOp === "start"}
          onClick={handleStart}
        />
        <ActionButton
          label="Stop"
          disabled={isStopped || isBusy}
          pending={pendingOp === "stop"}
          onClick={handleStop}
        />
        <ActionButton
          label="Restart"
          disabled={isBusy && pendingOp !== "restart"}
          pending={pendingOp === "restart"}
          onClick={handleRestart}
        />
      </div>
    </div>
  );
}
