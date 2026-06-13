import { useState } from "react";
import { useGovernance, type GovernanceDecision } from "../hooks/useGovernance";

type DecisionFilter = "all" | "allow" | "deny" | "escalate";
type ModeStyle = { bg: string; text: string; border: string };

const STANDARD_MODE_STYLE: ModeStyle = { bg: "#fffbeb", text: "#92400e", border: "#fcd34d" };

const MODE_COLORS: Record<string, ModeStyle> = {
  strict: { bg: "#fef2f2", text: "#991b1b", border: "#fca5a5" },
  standard: STANDARD_MODE_STYLE,
  permissive: { bg: "#f0fdf4", text: "#166534", border: "#86efac" },
};

const MODE_DESCRIPTIONS: Record<string, string> = {
  strict: "All tool calls require explicit approval. Unapproved actions are blocked.",
  standard: "Known-safe tools run freely; unknown or high-risk tools require approval.",
  permissive: "All tool calls are allowed and logged for audit purposes only.",
};

const OUTCOME_STYLES: Record<GovernanceDecision["outcome"], { color: string; bg: string }> = {
  allow: { color: "#166534", bg: "#f0fdf4" },
  deny: { color: "#991b1b", bg: "#fef2f2" },
  escalate: { color: "#92400e", bg: "#fffbeb" },
};

const PAGE_SIZE = 20;

export function formatGovernanceTimestamp(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) {
    return ts;
  }
  return date.toLocaleString();
}

function getServerName(action: string): string {
  return action.split(":")[0] || "unknown";
}

function getModeStyle(mode: string): ModeStyle {
  return MODE_COLORS[mode] ?? STANDARD_MODE_STYLE;
}

export function Governance() {
  const { mode, decisions, refresh } = useGovernance();
  const [filter, setFilter] = useState<DecisionFilter>("all");
  const [serverFilter, setServerFilter] = useState<string>("all");
  const [page, setPage] = useState(0);

  const servers = Array.from(new Set(decisions.map((d) => getServerName(d.action))));

  const filtered = decisions.filter((d) => {
    const matchOutcome = filter === "all" || d.outcome === filter;
    const serverName = getServerName(d.action);
    const matchServer = serverFilter === "all" || serverName === serverFilter;
    return matchOutcome && matchServer;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageDecisions = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>Governance</h1>
        <button
          onClick={refresh}
          style={{
            background: "none",
            border: "1px solid #e5e7eb",
            borderRadius: "6px",
            padding: "0.375rem 0.75rem",
            fontSize: "0.813rem",
            cursor: "pointer",
            color: "#374151",
          }}
        >
          Refresh
        </button>
      </div>

      {/* Mode Indicator */}
      <section>
        {mode === undefined ? (
          <div style={{ color: "#6b7280", fontSize: "0.875rem" }}>Loading governance mode…</div>
        ) : (() => {
          const modeStyle = getModeStyle(mode);
          return (
            <div
              style={{
                background: modeStyle.bg,
                border: `1px solid ${modeStyle.border}`,
                borderRadius: "10px",
                padding: "1.25rem 1.5rem",
                display: "flex",
                alignItems: "flex-start",
                gap: "1rem",
              }}
            >
              <div
                style={{
                  background: modeStyle.text,
                  color: "#fff",
                  borderRadius: "6px",
                  padding: "0.25rem 0.875rem",
                  fontSize: "0.875rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  whiteSpace: "nowrap",
                }}
              >
                {mode}
              </div>
              <p style={{ margin: 0, fontSize: "0.875rem", color: "#374151", lineHeight: 1.5 }}>
                {MODE_DESCRIPTIONS[mode] ?? ""}
              </p>
            </div>
          );
        })()}
      </section>

      {/* Filters */}
      <section>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "0.813rem", color: "#6b7280" }}>Filter:</span>
          {(["all", "allow", "deny", "escalate"] as DecisionFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => { setFilter(f); setPage(0); }}
              style={{
                padding: "0.25rem 0.75rem",
                borderRadius: "999px",
                border: "1px solid",
                borderColor: filter === f ? "#6366f1" : "#e5e7eb",
                background: filter === f ? "#6366f1" : "#fff",
                color: filter === f ? "#fff" : "#374151",
                fontSize: "0.813rem",
                cursor: "pointer",
                fontWeight: filter === f ? 600 : 400,
              }}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          {servers.length > 0 && (
            <select
              value={serverFilter}
              onChange={(e) => { setServerFilter(e.target.value); setPage(0); }}
              style={{
                marginLeft: "0.5rem",
                padding: "0.25rem 0.5rem",
                borderRadius: "6px",
                border: "1px solid #e5e7eb",
                fontSize: "0.813rem",
                color: "#374151",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              <option value="all">All Servers</option>
              {servers.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
        </div>
      </section>

      {/* Decisions Table */}
      <section>
        {filtered.length === 0 ? (
          <div
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: "8px",
              padding: "3rem",
              textAlign: "center",
              color: "#6b7280",
              fontSize: "0.875rem",
            }}
          >
            No governance decisions recorded yet.
          </div>
        ) : (
          <>
            <div style={{ border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.813rem" }}>
                <thead>
                  <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                    {["Timestamp", "Action", "Outcome", "Reason"].map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: "0.625rem 1rem",
                          textAlign: "left",
                          fontWeight: 600,
                          color: "#374151",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageDecisions.map((d, i) => {
                    const style = OUTCOME_STYLES[d.outcome];
                    return (
                      <tr
                        key={d.id}
                        style={{
                          background: i % 2 === 0 ? "#fff" : "#fafafa",
                          borderBottom: "1px solid #f3f4f6",
                        }}
                      >
                        <td style={{ padding: "0.625rem 1rem", color: "#6b7280", whiteSpace: "nowrap" }}>
                          {formatGovernanceTimestamp(d.timestamp)}
                        </td>
                        <td style={{ padding: "0.625rem 1rem", color: "#111827", fontFamily: "monospace" }}>
                          {d.action}
                        </td>
                        <td style={{ padding: "0.625rem 1rem" }}>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "0.125rem 0.5rem",
                              borderRadius: "999px",
                              background: style.bg,
                              color: style.color,
                              fontWeight: 600,
                              fontSize: "0.75rem",
                              textTransform: "uppercase",
                            }}
                          >
                            {d.outcome}
                          </span>
                        </td>
                        <td style={{ padding: "0.625rem 1rem", color: "#374151" }}>{d.reason}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ display: "flex", justifyContent: "center", gap: "0.5rem", marginTop: "1rem" }}>
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  style={{
                    padding: "0.25rem 0.75rem",
                    borderRadius: "6px",
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                    color: page === 0 ? "#d1d5db" : "#374151",
                    cursor: page === 0 ? "default" : "pointer",
                    fontSize: "0.813rem",
                  }}
                >
                  Prev
                </button>
                <span style={{ padding: "0.25rem 0.5rem", fontSize: "0.813rem", color: "#6b7280" }}>
                  {page + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  style={{
                    padding: "0.25rem 0.75rem",
                    borderRadius: "6px",
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                    color: page >= totalPages - 1 ? "#d1d5db" : "#374151",
                    cursor: page >= totalPages - 1 ? "default" : "pointer",
                    fontSize: "0.813rem",
                  }}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
