import { useEffect, useState } from "react";
import { useServerStatus } from "../hooks/useServerStatus";
import { ServerCard } from "../components/ServerCard";

interface ChromeStatus {
  available: boolean;
}

async function safeInvoke<T>(cmd: string): Promise<T | undefined> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd);
  } catch {
    return undefined;
  }
}

function useChromeAvailable(): boolean | undefined {
  const [available, setAvailable] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    void safeInvoke<ChromeStatus>("chrome_detect").then((result) => {
      if (result !== undefined) {
        setAvailable(result.available);
      }
    });
  }, []);

  return available;
}

function SkeletonCard() {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "1rem",
        background: "#f9fafb",
        height: "120px",
        animation: "pulse 1.5s ease-in-out infinite",
      }}
    />
  );
}

export function Servers() {
  const { servers, loading, error } = useServerStatus();
  const chromeAvailable = useChromeAvailable();

  const serverCount = servers.length;
  const runningCount = servers.filter((s) => s.status === "running").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700, color: "#111827" }}>
            MCP Servers
          </h1>
          {!loading && (
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.875rem", color: "#6b7280" }}>
              {runningCount} of {serverCount} running
            </p>
          )}
        </div>
      </div>

      {/* Chrome unavailability warning */}
      {chromeAvailable === false && (
        <div
          style={{
            background: "#fffbeb",
            border: "1px solid #fcd34d",
            borderRadius: "8px",
            padding: "0.75rem 1rem",
            fontSize: "0.875rem",
            color: "#92400e",
            display: "flex",
            gap: "0.5rem",
            alignItems: "flex-start",
          }}
        >
          <span style={{ flexShrink: 0, fontWeight: 600 }}>Notice:</span>
          <span>
            Google Chrome was not detected on this system. MCP servers that require Chrome
            (browser automation, extension integration) will be unavailable.
          </span>
        </div>
      )}

      {/* Error state */}
      {error !== undefined && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: "8px",
            padding: "0.75rem 1rem",
            fontSize: "0.875rem",
            color: "#991b1b",
          }}
        >
          <strong>Error loading servers:</strong> {error}
        </div>
      )}

      {/* Loading skeletons */}
      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {/* Empty state */}
      {!loading && servers.length === 0 && error === undefined && (
        <div
          style={{
            textAlign: "center",
            padding: "3rem 1rem",
            color: "#6b7280",
            background: "#f9fafb",
            borderRadius: "8px",
            border: "1px dashed #d1d5db",
          }}
        >
          <p style={{ margin: 0, fontSize: "1rem", fontWeight: 500, color: "#374151" }}>
            No servers registered
          </p>
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.875rem" }}>
            MCP servers configured in your Claude settings will appear here once the desktop
            companion detects them.
          </p>
        </div>
      )}

      {/* Server list */}
      {!loading && servers.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {servers.map((server) => (
            <ServerCard key={server.id} server={server} />
          ))}
        </div>
      )}
    </div>
  );
}
