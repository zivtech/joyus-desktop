import { StatusBadge } from "./StatusBadge";
import type { ServerInfo } from "../hooks/useServerStatus";

interface ServerCardProps {
  server: ServerInfo;
}

async function safeInvoke(cmd: string, args: Record<string, unknown>): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke(cmd, args);
  } catch {
    // no-op in non-Tauri environment
  }
}

function formatUptime(seconds: number | undefined): string {
  if (seconds === undefined) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function ServerCard({ server }: ServerCardProps) {
  const isRunning = server.status === "running";
  const isStopped = server.status === "stopped" || server.status === "error";
  const isTransitioning = server.status === "starting";

  const handleStart = () => {
    void safeInvoke("start_server", { id: server.id });
  };
  const handleStop = () => {
    void safeInvoke("stop_server", { id: server.id });
  };
  const handleRestart = () => {
    void safeInvoke("restart_server", { id: server.id });
  };

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 600, fontSize: "0.938rem", color: "#111827" }}>
          {server.name}
        </span>
        <StatusBadge status={server.status} />
      </div>

      <div style={{ display: "flex", gap: "1rem", fontSize: "0.813rem", color: "#6b7280" }}>
        <span>PID: {server.pid ?? "—"}</span>
        <span>Uptime: {formatUptime(server.uptime)}</span>
        <span>Restarts: {server.restartCount}</span>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
        <button
          onClick={handleStart}
          disabled={isRunning || isTransitioning}
          style={{
            padding: "0.25rem 0.625rem",
            fontSize: "0.813rem",
            border: "1px solid #d1d5db",
            borderRadius: "4px",
            background: isRunning || isTransitioning ? "#f3f4f6" : "#fff",
            color: isRunning || isTransitioning ? "#9ca3af" : "#374151",
            cursor: isRunning || isTransitioning ? "not-allowed" : "pointer",
          }}
        >
          Start
        </button>
        <button
          onClick={handleStop}
          disabled={isStopped || isTransitioning}
          style={{
            padding: "0.25rem 0.625rem",
            fontSize: "0.813rem",
            border: "1px solid #d1d5db",
            borderRadius: "4px",
            background: isStopped || isTransitioning ? "#f3f4f6" : "#fff",
            color: isStopped || isTransitioning ? "#9ca3af" : "#374151",
            cursor: isStopped || isTransitioning ? "not-allowed" : "pointer",
          }}
        >
          Stop
        </button>
        <button
          onClick={handleRestart}
          disabled={isTransitioning}
          style={{
            padding: "0.25rem 0.625rem",
            fontSize: "0.813rem",
            border: "1px solid #d1d5db",
            borderRadius: "4px",
            background: isTransitioning ? "#f3f4f6" : "#fff",
            color: isTransitioning ? "#9ca3af" : "#374151",
            cursor: isTransitioning ? "not-allowed" : "pointer",
          }}
        >
          Restart
        </button>
      </div>
    </div>
  );
}
