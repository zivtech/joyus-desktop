import { useCallback, useEffect, useRef, useState } from "react";
import { LocalSiteCard, type LocalSite } from "../components/LocalSiteCard";
import { RemoteEnvironmentCard, type RemoteEnvironment } from "../components/RemoteEnvironmentCard";

// ─── IPC helpers ─────────────────────────────────────────────────────────────

async function safeInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T | undefined> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  } catch (err) {
    console.error(`[safeInvoke] ${cmd} failed:`, err);
    return undefined;
  }
}

// ─── Provision Form ──────────────────────────────────────────────────────────

interface ProvisionFormProps {
  onProvisioned: () => void;
}

function ProvisionForm({ onProvisioned }: ProvisionFormProps) {
  const [repoUrl, setRepoUrl] = useState("");
  const [provisioning, setProvisioning] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleProvision() {
    const url = repoUrl.trim();
    if (url === "" || provisioning) return;
    setProvisioning(true);
    setError(undefined);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("site_provision", { repoUrl: url });
      setRepoUrl("");
      onProvisioned();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProvisioning(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      void handleProvision();
    }
  }

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "0.875rem 1rem",
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }}
    >
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <input
          ref={inputRef}
          type="text"
          value={repoUrl}
          onChange={(e) => { setRepoUrl(e.target.value); }}
          onKeyDown={handleKeyDown}
          disabled={provisioning}
          placeholder="https://github.com/org/repo.git"
          style={{
            flex: 1,
            padding: "0.375rem 0.625rem",
            fontSize: "0.875rem",
            border: "1px solid #d1d5db",
            borderRadius: "4px",
            background: provisioning ? "#f9fafb" : "#fff",
            color: "#111827",
            outline: "none",
            minWidth: 0,
          }}
        />
        <button
          onClick={() => { void handleProvision(); }}
          disabled={provisioning || repoUrl.trim() === ""}
          style={{
            padding: "0.375rem 0.875rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            border: "1px solid #d1d5db",
            borderRadius: "4px",
            background: provisioning || repoUrl.trim() === "" ? "#f3f4f6" : "#fff",
            color: provisioning || repoUrl.trim() === "" ? "#9ca3af" : "#374151",
            cursor: provisioning || repoUrl.trim() === "" ? "not-allowed" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.375rem",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {provisioning ? (
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
          Provision
        </button>
      </div>
      {error !== undefined && (
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
          {error}
        </div>
      )}
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "1rem",
        background: "#f9fafb",
        height: "100px",
        animation: "pulse 1.5s ease-in-out infinite",
      }}
    />
  );
}

// ─── Section component ───────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  loading: boolean;
  error: string | undefined;
  emptyMessage: string;
  count: number;
  children: React.ReactNode;
}

function Section({ title, loading, error, emptyMessage, count, children }: SectionProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600, color: "#111827" }}>
        {title}
        {!loading && error === undefined && (
          <span style={{ fontSize: "0.875rem", fontWeight: 400, color: "#6b7280", marginLeft: "0.5rem" }}>
            ({count})
          </span>
        )}
      </h2>

      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {!loading && error !== undefined && (
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
          {error}
        </div>
      )}

      {!loading && error === undefined && count === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "2rem 1rem",
            color: "#6b7280",
            background: "#f9fafb",
            borderRadius: "8px",
            border: "1px dashed #d1d5db",
          }}
        >
          <p style={{ margin: 0, fontSize: "0.875rem" }}>{emptyMessage}</p>
        </div>
      )}

      {!loading && error === undefined && count > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Sites page ──────────────────────────────────────────────────────────────

export function Sites() {
  const [localSites, setLocalSites] = useState<LocalSite[]>([]);
  const [remoteSites, setRemoteSites] = useState<RemoteEnvironment[]>([]);
  const [localLoading, setLocalLoading] = useState(true);
  const [remoteLoading, setRemoteLoading] = useState(true);
  const [localError, setLocalError] = useState<string | undefined>(undefined);
  const [remoteError, setRemoteError] = useState<string | undefined>(undefined);

  const loadLocalSites = useCallback(() => {
    setLocalLoading(true);
    setLocalError(undefined);
    void safeInvoke<LocalSite[]>("site_list_local").then((result) => {
      if (result !== undefined) {
        setLocalSites(result);
      } else {
        setLocalError("Could not load local sites.");
      }
      setLocalLoading(false);
    });
  }, []);

  useEffect(() => {
    loadLocalSites();

    void safeInvoke<RemoteEnvironment[]>("site_list_remote").then((result) => {
      if (result !== undefined) {
        setRemoteSites(result);
      } else {
        setRemoteError("Could not load remote environments.");
      }
      setRemoteLoading(false);
    });
  }, [loadLocalSites]);

  const totalCount = localSites.length + remoteSites.length;
  const anyLoading = localLoading || remoteLoading;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Header */}
      <div>
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700, color: "#111827" }}>
          Sites
        </h1>
        {!anyLoading && (
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.875rem", color: "#6b7280" }}>
            {totalCount} {totalCount === 1 ? "site" : "sites"}
          </p>
        )}
      </div>

      {/* Provision New Site */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600, color: "#111827" }}>
          New Site
        </h2>
        <ProvisionForm onProvisioned={loadLocalSites} />
      </div>

      {/* Local Sites */}
      <Section
        title="Local Sites"
        loading={localLoading}
        error={localError}
        emptyMessage="No local sites. Provision a project to see it here."
        count={localSites.length}
      >
        {localSites.map((site) => (
          <LocalSiteCard key={site.id} site={site} onRemoved={loadLocalSites} />
        ))}
      </Section>

      {/* Remote Environments */}
      <Section
        title="Remote Environments"
        loading={remoteLoading}
        error={remoteError}
        emptyMessage="No remote environments detected."
        count={remoteSites.length}
      >
        {remoteSites.map((env) => (
          <RemoteEnvironmentCard key={env.id} env={env} />
        ))}
      </Section>
    </div>
  );
}
