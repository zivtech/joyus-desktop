import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EngagementStatus } from "../components/EngagementStatus";
import { useReconSetup } from "../hooks/useRecon";

// ─── Tauri helpers ────────────────────────────────────────────────────────────

async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  } catch {
    return undefined;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type AccessMode = "rfp" | "discovery" | "full";
type EngagementStatus = "Running" | "Complete" | "Error" | "Cancelled";

interface Engagement {
  engagementId: string;
  engagementDir: string;
  clientName: string;
  url: string;
  accessMode: AccessMode;
  createdAt?: string;
  status?: EngagementStatus;
}

interface CreateEngagementResult {
  engagementDir: string;
  engagementId: string;
  clientSlug: string;
}

interface LaunchReconResult {
  pid: number;
  launchTime: string;
  engagementId: string;
}

interface ActiveEngagement {
  engagementId: string;
  engagementDir: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function truncate(str: string, max: number): string {
  return str.length > max ? `${str.slice(0, max)}…` : str;
}

function formatDate(iso?: string): string {
  if (iso === undefined) return "—";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { bg: string; color: string }> = {
  Running: { bg: "#1a73e8", color: "#fff" },
  Complete: { bg: "#22c55e", color: "#fff" },
  Error: { bg: "#ef4444", color: "#fff" },
  Cancelled: { bg: "#6b7280", color: "#fff" },
};

function EngagementStatusBadge({ status }: { status?: string }) {
  const label = status ?? "Unknown";
  const cfg = STATUS_BADGE[label] ?? { bg: "#e5e7eb", color: "#374151" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.125rem 0.5rem",
        borderRadius: "9999px",
        background: cfg.bg,
        color: cfg.color,
        fontSize: "0.688rem",
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
}

// ─── New Engagement form ──────────────────────────────────────────────────────

interface NewEngagementFormProps {
  onSuccess: (engagement: ActiveEngagement) => void;
  onCancel: () => void;
}

function NewEngagementForm({ onSuccess, onCancel }: NewEngagementFormProps) {
  const [clientName, setClientName] = useState("");
  const [url, setUrl] = useState("");
  const [accessMode, setAccessMode] = useState<AccessMode>("rfp");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const urlValid = isValidUrl(url);
  const canSubmit = clientName.trim().length > 0 && urlValid && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(undefined);

    const createResult = await safeInvoke<CreateEngagementResult>("create_engagement", {
      params: { clientName: clientName.trim(), url: url.trim(), accessMode },
    });

    if (createResult === undefined) {
      setError("Failed to create engagement — sidecar may not be running.");
      setSubmitting(false);
      return;
    }

    const { engagementDir, engagementId } = createResult;

    const launchResult = await safeInvoke<LaunchReconResult>("launch_recon", {
      client_name: clientName.trim(),
      engagement_dir: engagementDir,
      engagement_id: engagementId,
    });

    if (launchResult === undefined) {
      setError("Engagement created but failed to launch — is Claude Code installed?");
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    onSuccess({ engagementId, engagementDir });
  }

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: "10px",
        padding: "1.25rem",
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
        marginBottom: "1.5rem",
      }}
    >
      <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>New Engagement</h2>

      {error !== undefined && (
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
          {error}
        </div>
      )}

      {/* Client Name */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <label style={{ fontSize: "0.813rem", fontWeight: 600, color: "#374151" }}>
          Client Name <span style={{ color: "#ef4444" }}>*</span>
        </label>
        <input
          type="text"
          value={clientName}
          onChange={(e) => { setClientName(e.currentTarget.value); }}
          placeholder="Acme Corp"
          style={{
            padding: "0.5rem 0.75rem",
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            fontSize: "0.875rem",
            outline: "none",
          }}
        />
      </div>

      {/* URL */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <label style={{ fontSize: "0.813rem", fontWeight: 600, color: "#374151" }}>
          URL <span style={{ color: "#ef4444" }}>*</span>
        </label>
        <input
          type="url"
          value={url}
          onChange={(e) => { setUrl(e.currentTarget.value); }}
          placeholder="https://example.com"
          style={{
            padding: "0.5rem 0.75rem",
            border: `1px solid ${url.length > 0 && !urlValid ? "#ef4444" : "#d1d5db"}`,
            borderRadius: "6px",
            fontSize: "0.875rem",
            outline: "none",
          }}
        />
        {url.length > 0 && !urlValid && (
          <span style={{ fontSize: "0.75rem", color: "#ef4444" }}>Enter a valid URL (e.g. https://example.com)</span>
        )}
      </div>

      {/* Access Mode */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <label style={{ fontSize: "0.813rem", fontWeight: 600, color: "#374151" }}>
          Access Mode
        </label>
        <select
          value={accessMode}
          onChange={(e) => { setAccessMode(e.currentTarget.value as AccessMode); }}
          style={{
            padding: "0.5rem 0.75rem",
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            fontSize: "0.875rem",
            outline: "none",
            background: "#fff",
          }}
        >
          <option value="rfp">RFP (limited)</option>
          <option value="discovery">Discovery</option>
          <option value="full">Full Access</option>
        </select>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
        <button
          onClick={() => { void handleSubmit(); }}
          disabled={!canSubmit}
          style={{
            padding: "0.625rem 1.5rem",
            background: canSubmit ? "#1a73e8" : "#d1d5db",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            fontSize: "0.875rem",
            fontWeight: 600,
            cursor: canSubmit ? "pointer" : "not-allowed",
          }}
        >
          {submitting ? "Starting…" : "Start Engagement"}
        </button>
        <button
          onClick={onCancel}
          disabled={submitting}
          style={{
            padding: "0.625rem 1rem",
            background: "transparent",
            color: "#6b7280",
            border: "none",
            fontSize: "0.875rem",
            cursor: submitting ? "default" : "pointer",
            textDecoration: "underline",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Past engagements list ────────────────────────────────────────────────────

interface EngagementListProps {
  onSelect: (engagement: ActiveEngagement) => void;
}

function EngagementList({ onSelect }: EngagementListProps) {
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void safeInvoke<Engagement[]>("list_engagements", {}).then((result) => {
      setEngagements(result ?? []);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <p style={{ color: "#6b7280", fontSize: "0.875rem" }}>Loading engagements…</p>;
  }

  if (engagements.length === 0) {
    return (
      <p style={{ color: "#6b7280", fontSize: "0.875rem", fontStyle: "italic" }}>
        No engagements yet. Start your first engagement above.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {engagements.map((eng) => (
        <button
          key={eng.engagementId}
          onClick={() => { onSelect({ engagementId: eng.engagementId, engagementDir: eng.engagementDir }); }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1rem",
            padding: "0.75rem 1rem",
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            cursor: "pointer",
            textAlign: "left",
            width: "100%",
            fontSize: "0.875rem",
          }}
        >
          <span style={{ fontWeight: 600, color: "#111827", minWidth: "120px" }}>
            {eng.clientName}
          </span>
          <span style={{ color: "#6b7280", flex: 1, fontFamily: "monospace", fontSize: "0.813rem" }}>
            {truncate(eng.url, 40)}
          </span>
          <span
            style={{
              padding: "0.125rem 0.5rem",
              background: "#f3f4f6",
              borderRadius: "4px",
              fontSize: "0.688rem",
              color: "#374151",
              fontWeight: 500,
              textTransform: "capitalize",
              flexShrink: 0,
            }}
          >
            {eng.accessMode}
          </span>
          <span style={{ color: "#9ca3af", fontSize: "0.75rem", flexShrink: 0 }}>
            {formatDate(eng.createdAt)}
          </span>
          <EngagementStatusBadge status={eng.status} />
        </button>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function ReconDashboard() {
  const navigate = useNavigate();
  const { setupComplete, loading: setupLoading } = useReconSetup();

  const [showForm, setShowForm] = useState(false);
  const [activeEngagement, setActiveEngagement] = useState<ActiveEngagement | undefined>(undefined);

  // Route guard: redirect to /recon/setup if not configured
  useEffect(() => {
    if (!setupLoading && !setupComplete) {
      navigate("/recon/setup", { replace: true });
    }
  }, [setupComplete, setupLoading, navigate]);

  // Render nothing while setup check is in progress
  if (setupLoading) {
    return null;
  }

  if (!setupComplete) {
    return null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, color: "#111827" }}>
          Recon Engagements
        </h1>
        {!showForm && activeEngagement === undefined && (
          <button
            onClick={() => { setShowForm(true); }}
            style={{
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
            New Engagement
          </button>
        )}
      </div>

      {/* New Engagement form (inline toggle) */}
      {showForm && activeEngagement === undefined && (
        <NewEngagementForm
          onSuccess={(engagement) => {
            setShowForm(false);
            setActiveEngagement(engagement);
          }}
          onCancel={() => { setShowForm(false); }}
        />
      )}

      {/* Active engagement status */}
      {activeEngagement !== undefined && (
        <EngagementStatus
          engagementId={activeEngagement.engagementId}
          engagementDir={activeEngagement.engagementDir}
          onBack={() => { setActiveEngagement(undefined); }}
        />
      )}

      {/* Past engagements list (always visible when no form/active view) */}
      {activeEngagement === undefined && (
        <div>
          <h2 style={{ margin: "0 0 0.75rem", fontSize: "0.938rem", fontWeight: 600, color: "#374151" }}>
            Past Engagements
          </h2>
          <EngagementList
            onSelect={(engagement) => {
              setShowForm(false);
              setActiveEngagement(engagement);
            }}
          />
        </div>
      )}
    </div>
  );
}
