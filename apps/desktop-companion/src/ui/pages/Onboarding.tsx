import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { OnboardingStep } from "../components/OnboardingStep";
import type { ServerInfo } from "../hooks/useServerStatus";

// ─── Tauri helpers ────────────────────────────────────────────────────────────

async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  } catch {
    return undefined;
  }
}

async function safeListen(
  event: string,
  handler: (payload: unknown) => void
): Promise<() => void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen(event, (e) => handler(e.payload));
  } catch {
    return () => undefined;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type StepStatus = "pending" | "active" | "success" | "error";

interface SyncCompletedPayload {
  skillCount: number;
  version: string;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: "12px",
        padding: "2rem",
        width: "100%",
        maxWidth: "480px",
        display: "flex",
        flexDirection: "column",
        gap: "1.5rem",
        boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
      }}
    >
      {children}
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "0.625rem 1.5rem",
        background: disabled ? "#d1d5db" : "#1a73e8",
        color: "#fff",
        border: "none",
        borderRadius: "6px",
        fontSize: "0.938rem",
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.15s",
        alignSelf: "flex-start",
      }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "0.5rem 1rem",
        background: "transparent",
        color: "#6b7280",
        border: "1px solid #d1d5db",
        borderRadius: "6px",
        fontSize: "0.875rem",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Input({
  label,
  type,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      <span style={{ fontSize: "0.813rem", fontWeight: 500, color: "#374151" }}>{label}</span>
      <input
        type={type ?? "text"}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder={placeholder}
        style={{
          padding: "0.5rem 0.75rem",
          border: "1px solid #d1d5db",
          borderRadius: "6px",
          fontSize: "0.875rem",
          outline: "none",
          width: "100%",
          boxSizing: "border-box",
        }}
      />
    </label>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      style={{
        background: "#fef2f2",
        border: "1px solid #fecaca",
        borderRadius: "6px",
        padding: "0.75rem 1rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "1rem",
      }}
    >
      <span style={{ fontSize: "0.875rem", color: "#dc2626" }}>{message}</span>
      {onRetry !== undefined && (
        <button
          onClick={onRetry}
          style={{
            padding: "0.25rem 0.75rem",
            background: "#dc2626",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            fontSize: "0.813rem",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div
      style={{
        height: "6px",
        background: "#e5e7eb",
        borderRadius: "3px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${Math.min(100, Math.max(0, value))}%`,
          background: "#1a73e8",
          borderRadius: "3px",
          transition: "width 0.3s ease",
        }}
      />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type OnboardingPhase = "auth" | "mcp" | "sync" | "complete";

interface ServerOnboardingStatus {
  server: ServerInfo;
  failed: boolean;
}

export function Onboarding() {
  const navigate = useNavigate();

  // Step 1 — Auth
  const [orgName, setOrgName] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [authError, setAuthError] = useState<string | undefined>(undefined);
  const [authBusy, setAuthBusy] = useState(false);

  // Step 2 — MCP
  const [mcpServers, setMcpServers] = useState<ServerOnboardingStatus[]>([]);
  const [mcpError, setMcpError] = useState<string | undefined>(undefined);
  const [mcpProgress, setMcpProgress] = useState(0);

  // Step 3 — Sync
  const [syncError, setSyncError] = useState<string | undefined>(undefined);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncResult, setSyncResult] = useState<SyncCompletedPayload | undefined>(undefined);

  // Phase tracking
  const [phase, setPhase] = useState<OnboardingPhase>("auth");
  const unlistenRefs = useRef<Array<() => void>>([]);

  // Step status derivations
  const stepStatuses: Record<OnboardingPhase, StepStatus> = {
    auth: phase === "auth" ? "active" : "success",
    mcp:
      phase === "auth"
        ? "pending"
        : phase === "mcp"
        ? mcpError !== undefined
          ? "error"
          : "active"
        : "success",
    sync:
      phase === "auth" || phase === "mcp"
        ? "pending"
        : phase === "sync"
        ? syncError !== undefined
          ? "error"
          : "active"
        : "success",
    complete: phase === "complete" ? "success" : "pending",
  };

  // Resume from last incomplete step (crash recovery)
  useEffect(() => {
    void safeInvoke<string>("get_config", { key: "onboarding_phase" }).then((saved) => {
      if (saved === "mcp" || saved === "sync") {
        setPhase(saved);
      }
    });
    return () => {
      for (const fn of unlistenRefs.current) fn();
    };
  }, []);

  // ── Event listeners for MCP and Sync ──────────────────────────────────────

  const attachEventListeners = useCallback(() => {
    // MCP server-changed events
    const mcpUnlisten = safeListen("state:server-changed", (payload) => {
      const server = payload as ServerInfo;
      setMcpServers((prev) => {
        const idx = prev.findIndex((s) => s.server.id === server.id);
        const entry: ServerOnboardingStatus = {
          server,
          failed: server.status === "error",
        };
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = entry;
          return next;
        }
        return [...prev, entry];
      });
      // Derive progress from running servers
      setMcpServers((prev) => {
        const running = prev.filter((s) => s.server.status === "running").length;
        const pct = prev.length > 0 ? (running / prev.length) * 100 : 0;
        setMcpProgress(pct);
        return prev;
      });
    });

    // Sync completed event
    const syncUnlisten = safeListen("state:sync-completed", (payload) => {
      const result = payload as SyncCompletedPayload;
      setSyncResult(result);
      setSyncProgress(100);
      void safeInvoke("set_config", { key: "onboarding_phase", value: "complete" });
      void safeInvoke("set_config", { key: "onboarding_complete", value: "true" });
      setPhase("complete");
    });

    // Sync progress event
    const syncProgressUnlisten = safeListen("state:sync-progress", (payload) => {
      const pct = payload as number;
      setSyncProgress(pct);
    });

    void mcpUnlisten.then((fn) => unlistenRefs.current.push(fn));
    void syncUnlisten.then((fn) => unlistenRefs.current.push(fn));
    void syncProgressUnlisten.then((fn) => unlistenRefs.current.push(fn));
  }, []);

  // ── Step 1: Auth submit ───────────────────────────────────────────────────

  const handleConnect = useCallback(async () => {
    if (authToken.trim() === "" || tenantId.trim() === "" || workspaceId.trim() === "") {
      setAuthError("Auth token, tenant ID, and workspace ID are required.");
      return;
    }
    setAuthBusy(true);
    setAuthError(undefined);

    try {
      await safeInvoke("set_config", { key: "org_name", value: orgName });
      await safeInvoke("set_config", { key: "auth_token", value: authToken });
      await safeInvoke("set_config", { key: "tenant_id", value: tenantId });
      await safeInvoke("set_config", { key: "workspace_id", value: workspaceId });
      await safeInvoke("set_config", { key: "onboarding_phase", value: "mcp" });

      attachEventListeners();
      setPhase("mcp");
      setMcpProgress(0);

      const result = await safeInvoke("start_onboarding", { authToken, tenantId, workspaceId });
      if (result === undefined) {
        // Proceed even if invoke returns undefined (non-Tauri env)
      }
    } catch (err) {
      setAuthError(String(err));
    } finally {
      setAuthBusy(false);
    }
  }, [orgName, authToken, tenantId, workspaceId, attachEventListeners]);

  // ── Step 2: Retry failed MCP servers ─────────────────────────────────────

  const handleRetryMcp = useCallback(() => {
    setMcpError(undefined);
    const failedIds = mcpServers.filter((s) => s.failed).map((s) => s.server.id);
    void safeInvoke("retry_servers", { ids: failedIds });
  }, [mcpServers]);

  const handleSkipMcp = useCallback(() => {
    void safeInvoke("set_config", { key: "onboarding_phase", value: "sync" });
    setPhase("sync");
    setSyncProgress(0);
  }, []);

  // ── Step 3: Retry sync ────────────────────────────────────────────────────

  const handleRetrySync = useCallback(() => {
    setSyncError(undefined);
    setSyncProgress(0);
    void safeInvoke("retry_skill_sync");
  }, []);

  const handleSkipSync = useCallback(() => {
    void safeInvoke("set_config", { key: "onboarding_complete", value: "true" });
    setPhase("complete");
  }, []);

  // ── Step 4: Open Dashboard ────────────────────────────────────────────────

  const handleOpenDashboard = useCallback(() => {
    navigate("/");
  }, [navigate]);

  // ── Advance from MCP to Sync when all servers resolved ────────────────────

  useEffect(() => {
    if (phase !== "mcp" || mcpServers.length === 0) return;
    const allDone = mcpServers.every(
      (s) => s.server.status === "running" || s.server.status === "error"
    );
    const hasFailures = mcpServers.some((s) => s.failed);
    if (allDone) {
      if (hasFailures) {
        setMcpError(`${mcpServers.filter((s) => s.failed).length} server(s) failed to start.`);
      } else {
        void safeInvoke("set_config", { key: "onboarding_phase", value: "sync" });
        setPhase("sync");
        setSyncProgress(0);
      }
    }
  }, [phase, mcpServers]);

  // ── Render ────────────────────────────────────────────────────────────────

  const failedServers = mcpServers.filter((s) => s.failed);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#f0f4ff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: "#111827",
        zIndex: 9999,
      }}
    >
      {/* CSS keyframe for spinner */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Logo */}
      <div style={{ marginBottom: "1.5rem", fontSize: "1.75rem", fontWeight: 800, color: "#1a73e8" }}>
        Joyus
      </div>

      <Card>
        {/* Step indicator */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <OnboardingStep stepNumber={1} totalSteps={4} label="Welcome & Authentication" status={stepStatuses.auth} />
          <OnboardingStep stepNumber={2} totalSteps={4} label="MCP Configuration" status={stepStatuses.mcp} />
          <OnboardingStep stepNumber={3} totalSteps={4} label="Skill Sync" status={stepStatuses.sync} />
          <OnboardingStep stepNumber={4} totalSteps={4} label="Complete" status={stepStatuses.complete} />
        </div>

        <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: 0 }} />

        {/* Step 1 — Auth */}
        {phase === "auth" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700 }}>Welcome to Joyus</h2>
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.875rem", color: "#6b7280" }}>
                Connect your account to get started.
              </p>
            </div>
            <Input label="Organization Name (optional)" value={orgName} onChange={setOrgName} placeholder="Acme Corp" />
            <Input label="Auth Token" type="password" value={authToken} onChange={setAuthToken} placeholder="sk-..." />
            <Input label="Tenant ID" value={tenantId} onChange={setTenantId} placeholder="tenant-abc" />
            <Input label="Workspace ID" value={workspaceId} onChange={setWorkspaceId} placeholder="ws-xyz" />
            {authError !== undefined && (
              <ErrorBox message={authError} onRetry={() => { void handleConnect(); }} />
            )}
            <PrimaryButton onClick={() => { void handleConnect(); }} disabled={authBusy}>
              {authBusy ? "Connecting…" : "Connect"}
            </PrimaryButton>
          </div>
        )}

        {/* Step 2 — MCP */}
        {phase === "mcp" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700 }}>MCP Configuration</h2>
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.875rem", color: "#6b7280" }}>
                Registering and starting MCP servers…
              </p>
            </div>
            <ProgressBar value={mcpProgress} />
            {mcpServers.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {mcpServers.map(({ server, failed }) => (
                  <div
                    key={server.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: "0.875rem",
                      padding: "0.375rem 0",
                    }}
                  >
                    <span style={{ color: "#374151" }}>{server.name}</span>
                    <span
                      style={{
                        color:
                          server.status === "running"
                            ? "#22c55e"
                            : failed
                            ? "#ef4444"
                            : "#f59e0b",
                        fontWeight: 500,
                        textTransform: "capitalize",
                      }}
                    >
                      {server.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {mcpError !== undefined && (
              <ErrorBox message={mcpError} onRetry={handleRetryMcp} />
            )}
            {failedServers.length > 0 && (
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <PrimaryButton onClick={handleRetryMcp}>Retry Failed</PrimaryButton>
                <SecondaryButton onClick={handleSkipMcp}>Skip</SecondaryButton>
              </div>
            )}
          </div>
        )}

        {/* Step 3 — Sync */}
        {phase === "sync" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700 }}>Skill Sync</h2>
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.875rem", color: "#6b7280" }}>
                Downloading skills and verifying version pin…
              </p>
            </div>
            <ProgressBar value={syncProgress} />
            <p style={{ margin: 0, fontSize: "0.875rem", color: "#6b7280" }}>
              {syncProgress < 100 ? `${Math.round(syncProgress)}% complete` : "Sync complete"}
            </p>
            {syncError !== undefined && (
              <ErrorBox message={syncError} onRetry={handleRetrySync} />
            )}
            {syncError !== undefined && (
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <PrimaryButton onClick={handleRetrySync}>Retry Sync</PrimaryButton>
                <SecondaryButton onClick={handleSkipSync}>Skip</SecondaryButton>
              </div>
            )}
          </div>
        )}

        {/* Step 4 — Complete */}
        {phase === "complete" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "0.75rem",
                padding: "1rem 0",
              }}
            >
              <div
                style={{
                  width: "3.5rem",
                  height: "3.5rem",
                  borderRadius: "50%",
                  background: "#22c55e",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "1.75rem",
                }}
              >
                ✓
              </div>
              <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, textAlign: "center" }}>
                You're all set!
              </h2>
              <p style={{ margin: 0, fontSize: "0.875rem", color: "#6b7280", textAlign: "center" }}>
                {syncResult !== undefined
                  ? `${syncResult.skillCount} skills synced at version ${syncResult.version}.`
                  : "Joyus is ready to use."}
              </p>
            </div>
            <PrimaryButton onClick={handleOpenDashboard}>Open Dashboard</PrimaryButton>
          </div>
        )}
      </Card>
    </div>
  );
}
