import { useEffect, useState } from "react";
import { useServerStatus } from "../hooks/useServerStatus";
import { useSyncStatus } from "../hooks/useSyncStatus";
import { ServerCard } from "../components/ServerCard";

interface UsageSummary {
  toolCallsToday: number;
  governanceDecisionsToday: number;
  serverUptimeSeconds: number;
}

async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  } catch {
    return undefined;
  }
}

function useUsageSummary(): UsageSummary | undefined {
  const [summary, setSummary] = useState<UsageSummary | undefined>(undefined);

  useEffect(() => {
    const fetch = () => {
      void safeInvoke<UsageSummary>("get_usage_summary", { days: 1 }).then((result) => {
        if (result !== undefined) {
          setSummary(result);
        }
      });
    };
    fetch();
    const interval = setInterval(fetch, 30_000);
    return () => clearInterval(interval);
  }, []);

  return summary;
}

function SectionHeading({ children }: { children: string }) {
  return (
    <h2
      style={{
        fontSize: "0.875rem",
        fontWeight: 600,
        color: "#6b7280",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        marginBottom: "0.75rem",
        marginTop: 0,
      }}
    >
      {children}
    </h2>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "1rem",
        minWidth: "140px",
      }}
    >
      <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#111827" }}>{value}</div>
      <div style={{ fontSize: "0.813rem", color: "#6b7280", marginTop: "0.25rem" }}>{label}</div>
    </div>
  );
}

export function Dashboard() {
  const { servers, loading: serversLoading } = useServerStatus();
  const { status: syncStatus, lastSync, version } = useSyncStatus();
  const usage = useUsageSummary();

  const runningCount = servers.filter((s) => s.status === "running").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>Dashboard</h1>

      {/* Server Health */}
      <section>
        <SectionHeading>Server Health</SectionHeading>
        {serversLoading ? (
          <p style={{ color: "#6b7280", fontSize: "0.875rem" }}>Loading servers…</p>
        ) : servers.length === 0 ? (
          <p style={{ color: "#6b7280", fontSize: "0.875rem" }}>No servers configured.</p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
            {servers.map((server) => (
              <div key={server.id} style={{ flex: "1 1 280px", maxWidth: "400px" }}>
                <ServerCard server={server} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Quick Stats */}
      <section>
        <SectionHeading>Quick Stats</SectionHeading>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
          <StatCard label="Servers Running" value={`${runningCount} / ${servers.length}`} />
          <StatCard
            label="Tool Calls Today"
            value={usage?.toolCallsToday ?? "—"}
          />
          <StatCard
            label="Governance Decisions Today"
            value={usage?.governanceDecisionsToday ?? "—"}
          />
        </div>
      </section>

      {/* Sync Status */}
      <section>
        <SectionHeading>Sync Status</SectionHeading>
        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            padding: "1rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
            fontSize: "0.875rem",
          }}
        >
          <div>
            <span style={{ color: "#6b7280" }}>State: </span>
            <span style={{ fontWeight: 500, color: "#111827", textTransform: "capitalize" }}>
              {syncStatus.state.replace("_", " ")}
            </span>
          </div>
          <div>
            <span style={{ color: "#6b7280" }}>Version: </span>
            <span style={{ fontWeight: 500, color: "#111827" }}>{version ?? "—"}</span>
          </div>
          <div>
            <span style={{ color: "#6b7280" }}>Last Sync: </span>
            <span style={{ color: "#111827" }}>{lastSync ?? "Never"}</span>
          </div>
          {syncStatus.nextSync !== undefined && (
            <div>
              <span style={{ color: "#6b7280" }}>Next Sync: </span>
              <span style={{ color: "#111827" }}>{syncStatus.nextSync}</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
