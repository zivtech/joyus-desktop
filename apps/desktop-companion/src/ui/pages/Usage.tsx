import { useEffect, useState } from "react";

type DateRange = 7 | 14 | 30;

interface UsageSummary {
  toolCalls: number;
  syncs: number;
  governanceDecisions: number;
  serverCrashes: number;
  dailyActivity: DailyActivity[];
  topTools: RankedItem[];
  topServers: RankedItem[];
}

interface DailyActivity {
  date: string;
  count: number;
}

interface RankedItem {
  name: string;
  count: number;
}

async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(cmd, args);
  } catch {
    return undefined;
  }
}

function useUsagePage(days: DateRange): { data: UsageSummary | undefined; loading: boolean } {
  const [data, setData] = useState<UsageSummary | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void safeInvoke<UsageSummary>("get_usage_summary", { days }).then((result) => {
      setData(result);
      setLoading(false);
    });
  }, [days]);

  return { data, loading };
}

function SummaryCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "1rem 1.25rem",
        flex: "1 1 140px",
      }}
    >
      <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#111827" }}>{value}</div>
      <div style={{ fontSize: "0.813rem", color: "#6b7280", marginTop: "0.25rem" }}>{label}</div>
    </div>
  );
}

function BarChart({ data }: { data: DailyActivity[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  const chartHeight = 80;

  return (
    <div style={{ overflow: "hidden" }}>
      <svg
        width="100%"
        viewBox={`0 0 ${data.length * 16} ${chartHeight + 20}`}
        preserveAspectRatio="none"
        style={{ display: "block", height: "100px" }}
        aria-label="Daily activity bar chart"
      >
        {data.map((d, i) => {
          const barH = Math.max(2, Math.round((d.count / max) * chartHeight));
          const x = i * 16 + 2;
          const y = chartHeight - barH;
          return (
            <rect
              key={d.date}
              x={x}
              y={y}
              width={12}
              height={barH}
              fill="#6366f1"
              rx={2}
              opacity={0.85}
            >
              <title>{`${d.date}: ${String(d.count)} events`}</title>
            </rect>
          );
        })}
      </svg>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "0.688rem",
          color: "#9ca3af",
          marginTop: "0.25rem",
          paddingLeft: "2px",
          paddingRight: "2px",
        }}
      >
        <span>{data[0]!.date}</span>
        <span>{data[data.length - 1]!.date}</span>
      </div>
    </div>
  );
}

function RankingList({ title, items }: { title: string; items: RankedItem[] }) {
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "1rem 1.25rem",
        flex: "1 1 220px",
      }}
    >
      <h3 style={{ margin: "0 0 0.75rem 0", fontSize: "0.875rem", fontWeight: 600, color: "#374151" }}>
        {title}
      </h3>
      {items.length === 0 ? (
        <p style={{ color: "#9ca3af", fontSize: "0.813rem", margin: 0 }}>No data yet.</p>
      ) : (
        <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {items.map((item, idx) => (
            <li key={item.name} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span
                style={{
                  width: "1.25rem",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  color: "#9ca3af",
                  textAlign: "right",
                  flexShrink: 0,
                }}
              >
                {idx + 1}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "0.813rem",
                    color: "#111827",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.name}
                </div>
                <div
                  style={{
                    height: "4px",
                    background: "#e5e7eb",
                    borderRadius: "2px",
                    marginTop: "3px",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${(item.count / max) * 100}%`,
                      background: "#6366f1",
                      borderRadius: "2px",
                    }}
                  />
                </div>
              </div>
              <span style={{ fontSize: "0.75rem", color: "#6b7280", flexShrink: 0 }}>
                {item.count}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function Usage() {
  const [days, setDays] = useState<DateRange>(30);
  const { data, loading } = useUsagePage(days);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>Usage</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {([7, 14, 30] as DateRange[]).map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={{
                padding: "0.25rem 0.75rem",
                borderRadius: "6px",
                border: "1px solid",
                borderColor: days === d ? "#6366f1" : "#e5e7eb",
                background: days === d ? "#6366f1" : "#fff",
                color: days === d ? "#fff" : "#374151",
                fontSize: "0.813rem",
                fontWeight: days === d ? 600 : 400,
                cursor: "pointer",
              }}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p style={{ color: "#6b7280", fontSize: "0.875rem" }}>Loading usage data…</p>
      ) : data === undefined ? (
        <p style={{ color: "#6b7280", fontSize: "0.875rem" }}>No usage data available.</p>
      ) : (
        <>
          {/* Summary Cards */}
          <section>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
              <SummaryCard label="Tool Calls" value={data.toolCalls} />
              <SummaryCard label="Syncs" value={data.syncs} />
              <SummaryCard label="Governance Decisions" value={data.governanceDecisions} />
              <SummaryCard label="Server Crashes" value={data.serverCrashes} />
            </div>
          </section>

          {/* Daily Activity Chart */}
          {data.dailyActivity.length > 0 && (
            <section>
              <h2
                style={{
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  color: "#6b7280",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  margin: "0 0 0.75rem 0",
                }}
              >
                Daily Activity
              </h2>
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
                  padding: "1rem 1.25rem",
                }}
              >
                <BarChart data={data.dailyActivity} />
              </div>
            </section>
          )}

          {/* Rankings */}
          <section>
            <h2
              style={{
                fontSize: "0.875rem",
                fontWeight: 600,
                color: "#6b7280",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                margin: "0 0 0.75rem 0",
              }}
            >
              Top Activity
            </h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
              <RankingList title="Top Tools" items={data.topTools} />
              <RankingList title="Top Servers" items={data.topServers} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
