import type { ChangeEventHandler } from "react";
import { SkillList, type SkillInfo } from "../components/SkillList";
import type { SyncStatus } from "../hooks/useSyncStatus";

interface SkillsViewProps {
  readonly skills: SkillInfo[];
  readonly loading: boolean;
  readonly status: SyncStatus;
  readonly lastSync: string | undefined;
  readonly version: string | undefined;
  readonly filter: string;
  readonly syncing: boolean;
  readonly onFilterChange: ChangeEventHandler<HTMLInputElement>;
  readonly onSyncNow: () => void;
}

export function SkillsView({
  skills,
  loading,
  status,
  lastSync,
  version,
  filter,
  syncing,
  onFilterChange,
  onSyncNow,
}: SkillsViewProps) {
  const filtered = skills.filter((s) =>
    s.name.toLowerCase().includes(filter.toLowerCase())
  );
  const syncStateLabel = status.state.replace("_", " ");
  const isSyncing = status.state === "syncing" || syncing;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700, color: "#111827" }}>
            Skills
          </h1>
          {!loading && (
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.875rem", color: "#6b7280" }}>
              {skills.length} skill{skills.length !== 1 ? "s" : ""} synced
              {version !== undefined ? ` · v${version}` : ""}
            </p>
          )}
        </div>
        <button
          onClick={onSyncNow}
          disabled={isSyncing}
          style={{
            padding: "0.5rem 1rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            background: isSyncing ? "#f3f4f6" : "#fff",
            color: isSyncing ? "#9ca3af" : "#374151",
            cursor: isSyncing ? "not-allowed" : "pointer",
          }}
        >
          {isSyncing ? "Syncing\u2026" : "Sync Now"}
        </button>
      </div>

      <div
        style={{
          background: "#f9fafb",
          border: "1px solid #e5e7eb",
          borderRadius: "8px",
          padding: "0.75rem 1rem",
          fontSize: "0.875rem",
          display: "flex",
          gap: "1.5rem",
          flexWrap: "wrap",
          color: "#374151",
        }}
      >
        <span>
          <span style={{ color: "#6b7280" }}>State: </span>
          <span style={{ fontWeight: 500, textTransform: "capitalize" }}>{syncStateLabel}</span>
        </span>
        <span>
          <span style={{ color: "#6b7280" }}>Version: </span>
          <span style={{ fontWeight: 500 }}>{version ?? "\u2014"}</span>
        </span>
        <span>
          <span style={{ color: "#6b7280" }}>Last sync: </span>
          <span>{lastSync ?? "Never"}</span>
        </span>
        {isSyncing && (
          <span style={{ color: "#6366f1", fontWeight: 500 }}>Sync in progress\u2026</span>
        )}
      </div>

      {!loading && skills.length > 0 && (
        <input
          type="text"
          placeholder="Filter skills by name\u2026"
          value={filter}
          onChange={onFilterChange}
          style={{
            padding: "0.5rem 0.75rem",
            fontSize: "0.875rem",
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            outline: "none",
            width: "100%",
            boxSizing: "border-box",
            color: "#111827",
            background: "#fff",
          }}
        />
      )}

      {loading && (
        <p style={{ color: "#6b7280", fontSize: "0.875rem" }}>Loading skills\u2026</p>
      )}

      {!loading && skills.length === 0 && (
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
            No skills synced yet
          </p>
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.875rem" }}>
            Run sync to get started.
          </p>
        </div>
      )}

      {!loading && skills.length > 0 && filtered.length === 0 && (
        <p style={{ color: "#6b7280", fontSize: "0.875rem", textAlign: "center" }}>
          No skills match &ldquo;{filter}&rdquo;.
        </p>
      )}
      {!loading && filtered.length > 0 && <SkillList skills={filtered} />}
    </div>
  );
}
