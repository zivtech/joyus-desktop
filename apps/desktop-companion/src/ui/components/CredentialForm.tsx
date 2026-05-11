import { useEffect, useState } from "react";

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

type FieldStatus = "unchecked" | "verified" | "failed";

interface CredentialField {
  key: string;
  label: string;
  description: string;
}

interface CredentialListItem {
  key: string;
  isSet: boolean;
}

interface CredentialVerifyItem {
  key: string;
  valid: boolean | null;
  error?: string;
}

// ─── Credential definitions ───────────────────────────────────────────────────

const CREDENTIAL_FIELDS: CredentialField[] = [
  {
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic API Key",
    description: "Used to run Claude inside Recon sessions",
  },
  {
    key: "DATAFORSEO_LOGIN",
    label: "DataForSEO Login",
    description: "DataForSEO account login",
  },
  {
    key: "DATAFORSEO_PASSWORD",
    label: "DataForSEO Password",
    description: "DataForSEO account password",
  },
  {
    key: "CRUX_API_KEY",
    label: "Chrome UX Report API Key",
    description: "Chrome UX Report API key",
  },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusIndicator({ status }: { status: FieldStatus }) {
  const config: Record<FieldStatus, { symbol: string; color: string }> = {
    unchecked: { symbol: "—", color: "#6b7280" },
    verified: { symbol: "✓", color: "#22c55e" },
    failed: { symbol: "✗", color: "#ef4444" },
  };
  const { symbol, color } = config[status];
  return (
    <span
      style={{
        fontWeight: 700,
        color,
        fontSize: "1rem",
        width: "1.25rem",
        textAlign: "center",
        flexShrink: 0,
      }}
    >
      {symbol}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface CredentialFormProps {
  onComplete: () => void;
}

export function CredentialForm({ onComplete }: CredentialFormProps) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(CREDENTIAL_FIELDS.map((f) => [f.key, ""]))
  );
  const [statuses, setStatuses] = useState<Record<string, FieldStatus>>(
    Object.fromEntries(CREDENTIAL_FIELDS.map((f) => [f.key, "unchecked" as FieldStatus]))
  );
  const [saving, setSaving] = useState<Record<string, boolean>>(
    Object.fromEntries(CREDENTIAL_FIELDS.map((f) => [f.key, false]))
  );
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | undefined>(undefined);

  // Pre-populate isSet status on mount
  useEffect(() => {
    void safeInvoke<CredentialListItem[]>("credentials_list").then((result) => {
      if (result === undefined) return;
      const next: Record<string, FieldStatus> = { ...statuses };
      for (const item of result) {
        if (CREDENTIAL_FIELDS.some((f) => f.key === item.key)) {
          next[item.key] = item.isSet ? "unchecked" : "unchecked";
          // We mark as unchecked even if isSet, because we haven't verified yet.
          // The visual distinction is: an empty input (not isSet) vs masked (isSet).
        }
      }
      setStatuses(next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleValueChange(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setStatuses((prev) => ({ ...prev, [key]: "unchecked" }));
  }

  async function handleSave(key: string) {
    const value = values[key];
    if (value.trim() === "") return;
    setSaving((prev) => ({ ...prev, [key]: true }));
    await safeInvoke("credentials_save", { key, value });
    setSaving((prev) => ({ ...prev, [key]: false }));
    // Do not mark verified here — only verify_all can confirm validity.
  }

  async function handleVerifyAll() {
    setVerifying(true);
    setVerifyError(undefined);

    const result = await safeInvoke<CredentialVerifyItem[]>("credentials_verify");

    if (result === undefined) {
      setVerifyError("Verification unavailable — sidecar may not be running.");
      setVerifying(false);
      return;
    }

    const next: Record<string, FieldStatus> = { ...statuses };
    let allValid = true;

    for (const item of result) {
      if (!CREDENTIAL_FIELDS.some((f) => f.key === item.key)) continue;
      if (item.valid === true) {
        next[item.key] = "verified";
      } else {
        next[item.key] = "failed";
        allValid = false;
      }
    }

    setStatuses(next);
    setVerifying(false);

    if (allValid && result.length === CREDENTIAL_FIELDS.length) {
      onComplete();
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div>
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#111827" }}>
          Enter API credentials
        </h3>
        <p style={{ margin: "0.25rem 0 0", fontSize: "0.813rem", color: "#6b7280" }}>
          These are stored locally on this machine. You will receive them from Alex via Signal.
        </p>
      </div>

      {CREDENTIAL_FIELDS.map((field) => (
        <div
          key={field.key}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.375rem",
            padding: "0.75rem",
            border: "1px solid #e5e7eb",
            borderRadius: "6px",
            background: "#fff",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <label
              style={{ fontSize: "0.813rem", fontWeight: 600, color: "#374151" }}
              htmlFor={`cred-${field.key}`}
            >
              {field.label}
            </label>
            <StatusIndicator status={statuses[field.key]} />
          </div>
          <p style={{ margin: 0, fontSize: "0.75rem", color: "#6b7280" }}>{field.description}</p>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input
              id={`cred-${field.key}`}
              type="password"
              value={values[field.key]}
              onChange={(e) => { handleValueChange(field.key, e.currentTarget.value); }}
              placeholder="Enter value…"
              style={{
                flex: 1,
                padding: "0.5rem 0.75rem",
                border: "1px solid #d1d5db",
                borderRadius: "6px",
                fontSize: "0.875rem",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <button
              onClick={() => { void handleSave(field.key); }}
              disabled={saving[field.key] || values[field.key].trim() === ""}
              style={{
                padding: "0.5rem 0.875rem",
                background:
                  saving[field.key] || values[field.key].trim() === "" ? "#d1d5db" : "#1a73e8",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                fontSize: "0.813rem",
                fontWeight: 600,
                cursor:
                  saving[field.key] || values[field.key].trim() === "" ? "not-allowed" : "pointer",
                flexShrink: 0,
              }}
            >
              {saving[field.key] ? "Saving…" : "Save"}
            </button>
          </div>
          {statuses[field.key] === "failed" && (
            <p style={{ margin: 0, fontSize: "0.75rem", color: "#ef4444" }}>
              Verification failed. Check the value and try again.
            </p>
          )}
        </div>
      ))}

      {verifyError !== undefined && (
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
          {verifyError}
        </div>
      )}

      <button
        onClick={() => { void handleVerifyAll(); }}
        disabled={verifying}
        style={{
          width: "100%",
          padding: "0.625rem 1rem",
          background: verifying ? "#d1d5db" : "#1a73e8",
          color: "#fff",
          border: "none",
          borderRadius: "6px",
          fontSize: "0.938rem",
          fontWeight: 600,
          cursor: verifying ? "not-allowed" : "pointer",
        }}
      >
        {verifying ? "Verifying…" : "Verify All"}
      </button>
    </div>
  );
}
