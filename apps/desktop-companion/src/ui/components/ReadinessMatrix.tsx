import { useEffect, useState } from "react";

// ─── Tauri helpers ────────────────────────────────────────────────────────────

async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(cmd, args);
  } catch {
    return undefined;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReadinessItem {
  id: string;
  label: string;
  status: "ready" | "blocking" | "warning" | "unchecked";
  detail: string | null;
}

interface ReadinessMatrixProps {
  onPreflightComplete?: (allClear: boolean) => void;
}

// ─── Dot color map ────────────────────────────────────────────────────────────

const DOT_COLOR: Record<ReadinessItem["status"], string> = {
  ready: "#22c55e",
  blocking: "#ef4444",
  warning: "#eab308",
  unchecked: "#9ca3af",
};

// ─── Initial rows (all unchecked) ────────────────────────────────────────────

const INITIAL_ITEMS: ReadinessItem[] = [
  { id: "claude", label: "Claude Code", status: "unchecked", detail: null },
  { id: "credentials", label: "Credentials", status: "unchecked", detail: null },
  { id: "recon-skill", label: "Recon Skill", status: "unchecked", detail: null },
  { id: "dataforseo", label: "DataForSEO", status: "unchecked", detail: null },
  { id: "last-engagement", label: "Last Engagement", status: "unchecked", detail: null },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function ReadinessMatrix({ onPreflightComplete }: ReadinessMatrixProps) {
  const [items, setItems] = useState<ReadinessItem[]>(INITIAL_ITEMS);
  const [checking, setChecking] = useState(false);

  async function runPreflight() {
    setChecking(true);

    function timeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
      return Promise.race([p, new Promise<undefined>((r) => setTimeout(r, ms))]);
    }

    const [claude, creds, sync, verify, engagements] = await Promise.all([
      timeout(safeInvoke<{ found?: boolean }>("check_skill_file", {}), 5000),
      timeout(safeInvoke<string[]>("keychain_list"), 5000),
      timeout(safeInvoke<{ status?: string; version?: string }>("get_sync_status"), 5000),
      timeout(
        safeInvoke<Array<{ key: string; valid: boolean | null }>>("credentials_verify"),
        5000,
      ),
      timeout(safeInvoke("list_engagements"), 5000),
    ]);

    const newItems: ReadinessItem[] = [
      {
        id: "claude",
        label: "Claude Code",
        status: claude?.found ? "ready" : "blocking",
        detail: claude?.found ? "Installed" : "Not found on PATH",
      },
      {
        id: "credentials",
        label: "Credentials",
        status: (() => {
          const required = ["ANTHROPIC_API_KEY", "DATAFORSEO_USERNAME", "DATAFORSEO_PASSWORD"];
          const stored = creds ?? [];
          const allPresent = required.every((k) => stored.includes(k));
          return allPresent ? "ready" : "blocking";
        })(),
        detail: `${(creds ?? []).length}/5 keys stored`,
      },
      {
        id: "recon-skill",
        label: "Recon Skill",
        status: (() => {
          const s = sync as { status?: string; version?: string } | undefined;
          return s?.status === "synced" ? "ready" : "warning";
        })(),
        detail: (() => {
          const s = sync as { version?: string } | undefined;
          return s?.version ? `v${s.version}` : "Version unknown";
        })(),
      },
      {
        id: "dataforseo",
        label: "DataForSEO",
        status: (() => {
          if (!verify) return "warning";
          const dfsLogin = verify.find((r) => r.key === "DATAFORSEO_USERNAME");
          return dfsLogin?.valid === true ? "ready" : "warning";
        })(),
        detail: (() => {
          if (!verify) return "Not checked";
          const dfsLogin = verify.find((r) => r.key === "DATAFORSEO_USERNAME");
          return dfsLogin?.valid === true ? "Verified" : "Unverified";
        })(),
      },
      {
        id: "last-engagement",
        label: "Last Engagement",
        status: "ready",
        detail: engagements ? "History available" : "No prior engagements",
      },
    ];

    setItems(newItems);
    setChecking(false);

    const hasCritical = newItems.some((i) => i.status === "blocking");
    onPreflightComplete?.(!hasCritical);
  }

  useEffect(() => {
    void runPreflight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: 16,
      }}
    >
      <h2
        style={{
          margin: "0 0 12px",
          fontSize: "0.938rem",
          fontWeight: 700,
          color: "#111827",
        }}
      >
        System Readiness
      </h2>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((item) => (
          <div
            key={item.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            {/* Status dot */}
            <span
              style={{
                display: "inline-block",
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: DOT_COLOR[item.status],
                flexShrink: 0,
              }}
            />

            {/* Label */}
            <span
              style={{
                fontSize: "0.875rem",
                fontWeight: 500,
                color: "#111827",
                minWidth: 120,
              }}
            >
              {item.label}
            </span>

            {/* Detail */}
            {item.detail !== null && (
              <span
                style={{
                  fontSize: "0.813rem",
                  color: "#6b7280",
                }}
              >
                {item.detail}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Run Preflight button */}
      <button
        onClick={() => { void runPreflight(); }}
        disabled={checking}
        style={{
          marginTop: 14,
          padding: "0.5rem 1.25rem",
          background: checking ? "#d1d5db" : "#1a73e8",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontSize: "0.875rem",
          fontWeight: 600,
          cursor: checking ? "not-allowed" : "pointer",
        }}
      >
        {checking ? "Checking…" : "Run Preflight"}
      </button>
    </div>
  );
}
