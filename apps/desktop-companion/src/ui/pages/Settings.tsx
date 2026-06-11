import { useCallback, useEffect, useState } from "react";

interface AppConfig {
  autoStart: boolean;
  telemetryEnabled: boolean;
  version: string;
  buildDate?: string;
}

async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  } catch {
    return undefined;
  }
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      style={{
        width: "2.75rem",
        height: "1.5rem",
        borderRadius: "999px",
        border: "none",
        background: checked ? "#6366f1" : "#d1d5db",
        cursor: disabled === true ? "default" : "pointer",
        position: "relative",
        transition: "background 0.15s",
        flexShrink: 0,
        opacity: disabled === true ? 0.5 : 1,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: "3px",
          left: checked ? "calc(100% - 21px)" : "3px",
          width: "18px",
          height: "18px",
          borderRadius: "50%",
          background: "#fff",
          transition: "left 0.15s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }}
      />
    </button>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "1rem",
        padding: "0.875rem 0",
        borderBottom: "1px solid #f3f4f6",
      }}
    >
      <div>
        <div style={{ fontSize: "0.875rem", fontWeight: 500, color: "#111827" }}>{label}</div>
        {description !== undefined && (
          <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "0.125rem" }}>
            {description}
          </div>
        )}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function ActionButton({
  onClick,
  children,
  variant = "default",
  disabled,
}: {
  onClick: () => void;
  children: string;
  variant?: "default" | "danger";
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "0.375rem 0.875rem",
        borderRadius: "6px",
        border: "1px solid",
        borderColor: variant === "danger" ? "#fca5a5" : "#e5e7eb",
        background: "#fff",
        color: variant === "danger" ? "#dc2626" : "#374151",
        fontSize: "0.813rem",
        cursor: disabled === true ? "default" : "pointer",
        fontWeight: 500,
        opacity: disabled === true ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
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
        margin: "0 0 0 0",
      }}
    >
      {children}
    </h2>
  );
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "1rem 1.25rem",
      }}
    >
      <div style={{ marginBottom: "0.25rem" }}>
        <SectionHeading>{title}</SectionHeading>
      </div>
      <div>{children}</div>
    </section>
  );
}

type ResetStep = "idle" | "confirm" | "running" | "done";

export function Settings() {
  const [config, setConfig] = useState<AppConfig | undefined>(undefined);
  const [syncStatus, setSyncStatus] = useState<string | undefined>(undefined);
  const [updateStatus, setUpdateStatus] = useState<string | undefined>(undefined);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetStep, setResetStep] = useState<ResetStep>("idle");
  const [resetDeleteData, setResetDeleteData] = useState(false);
  const [resetError, setResetError] = useState<string | undefined>(undefined);

  const loadConfig = useCallback(() => {
    void safeInvoke<AppConfig>("get_config").then((result) => {
      if (result !== undefined) {
        setConfig(result);
      }
    });
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const setConfigField = useCallback(
    <K extends keyof AppConfig>(field: K, value: AppConfig[K]) => {
      if (config === undefined) return;
      const updated = { ...config, [field]: value };
      setConfig(updated);
      void safeInvoke("set_config", { key: field, value });
    },
    [config]
  );

  const handleAutoStart = useCallback(
    (enabled: boolean) => {
      setConfigField("autoStart", enabled);
      void safeInvoke("toggle_autostart", { enabled });
    },
    [setConfigField]
  );

  const handleTelemetry = useCallback(
    (enabled: boolean) => {
      setConfigField("telemetryEnabled", enabled);
    },
    [setConfigField]
  );

  const handleSync = useCallback(() => {
    setBusy(true);
    setSyncStatus("Syncing…");
    void safeInvoke("trigger_sync").then(() => {
      setSyncStatus("Sync complete.");
      setBusy(false);
    });
  }, []);

  const handleUpdateCheck = useCallback(() => {
    setBusy(true);
    setUpdateStatus("Checking…");
    void safeInvoke<string>("check_for_update").then((result) => {
      setUpdateStatus(result ?? "Up to date.");
      setBusy(false);
    });
  }, []);

  const handleClearData = useCallback(() => {
    if (!clearConfirm) {
      setClearConfirm(true);
      return;
    }
    setBusy(true);
    void safeInvoke("clear_usage_data").then(() => {
      setClearConfirm(false);
      setBusy(false);
    });
  }, [clearConfirm]);

  const handleResetStart = useCallback(() => {
    setResetStep("confirm");
    setResetDeleteData(false);
    setResetError(undefined);
  }, []);

  const handleResetCancel = useCallback(() => {
    setResetStep("idle");
    setResetError(undefined);
  }, []);

  const handleResetConfirm = useCallback(() => {
    setResetStep("running");
    setBusy(true);
    void safeInvoke<void>("reset_desktop_companion", { deleteData: resetDeleteData }).then(() => {
      setResetStep("done");
      setBusy(false);
    }).catch((err: unknown) => {
      setResetError(String(err));
      setResetStep("confirm");
      setBusy(false);
    });
  }, [resetDeleteData]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 700 }}>Settings</h1>

      {/* General */}
      <SettingsSection title="General">
        <SettingRow
          label="Auto-Start"
          description="Launch the desktop companion when you log in."
        >
          <Toggle
            checked={config?.autoStart ?? false}
            onChange={handleAutoStart}
            disabled={config === undefined}
          />
        </SettingRow>
        <SettingRow
          label="Telemetry"
          description="Send anonymous usage data to improve the product."
        >
          <Toggle
            checked={config?.telemetryEnabled ?? false}
            onChange={handleTelemetry}
            disabled={config === undefined}
          />
        </SettingRow>
      </SettingsSection>

      {/* Sync */}
      <SettingsSection title="Sync">
        <SettingRow
          label="Sync Now"
          {...(syncStatus !== undefined ? { description: syncStatus } : {})}
        >
          <ActionButton onClick={handleSync} disabled={busy}>
            Sync Now
          </ActionButton>
        </SettingRow>
      </SettingsSection>

      {/* Updates */}
      <SettingsSection title="Updates">
        <SettingRow
          label="Check for Updates"
          description={updateStatus ?? `Current version: ${config?.version ?? "—"}`}
        >
          <ActionButton onClick={handleUpdateCheck} disabled={busy}>
            Check Now
          </ActionButton>
        </SettingRow>
      </SettingsSection>

      {/* Data */}
      <SettingsSection title="Data">
        <SettingRow
          label="Clear Usage Data"
          description={
            clearConfirm
              ? "Are you sure? This cannot be undone. Click again to confirm."
              : "Delete all recorded usage events from local storage."
          }
        >
          <ActionButton onClick={handleClearData} variant="danger" disabled={busy}>
            {clearConfirm ? "Confirm Clear" : "Clear Data"}
          </ActionButton>
        </SettingRow>
        {clearConfirm && (
          <div style={{ paddingTop: "0.5rem", paddingBottom: "0.25rem" }}>
            <button
              onClick={() => setClearConfirm(false)}
              style={{
                background: "none",
                border: "none",
                color: "#6b7280",
                fontSize: "0.75rem",
                cursor: "pointer",
                padding: 0,
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </SettingsSection>

      {/* Reset */}
      <SettingsSection title="Reset Desktop Companion">
        {resetStep === "idle" && (
          <SettingRow
            label="Reset Desktop Companion"
            description="Stop all MCP servers and remove managed configuration entries. Use this before uninstalling on macOS."
          >
            <ActionButton onClick={handleResetStart} variant="danger" disabled={busy}>
              Reset…
            </ActionButton>
          </SettingRow>
        )}
        {resetStep === "confirm" && (
          <div style={{ paddingTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div style={{ fontSize: "0.875rem", fontWeight: 500, color: "#111827" }}>
              Choose what to remove:
            </div>
            <label style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", fontSize: "0.875rem", color: "#374151", cursor: "pointer" }}>
              <input
                type="radio"
                name="resetMode"
                checked={!resetDeleteData}
                onChange={() => setResetDeleteData(false)}
                style={{ marginTop: "2px" }}
              />
              <span>
                <strong>Remove app only</strong>
                <span style={{ color: "#6b7280" }}> — stop MCP servers and remove managed .mcp.json entries. Leave settings and skill cache intact.</span>
              </span>
            </label>
            <label style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", fontSize: "0.875rem", color: "#374151", cursor: "pointer" }}>
              <input
                type="radio"
                name="resetMode"
                checked={resetDeleteData}
                onChange={() => setResetDeleteData(true)}
                style={{ marginTop: "2px" }}
              />
              <span>
                <strong>Remove everything</strong>
                <span style={{ color: "#6b7280" }}> — also delete app data directory and <code style={{ fontFamily: "monospace" }}>~/.claude/.skill-sync-cache/</code>.</span>
              </span>
            </label>
            {resetError !== undefined && (
              <div style={{ fontSize: "0.813rem", color: "#dc2626" }}>Error: {resetError}</div>
            )}
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <ActionButton onClick={handleResetConfirm} variant="danger" disabled={busy}>
                Confirm Reset
              </ActionButton>
              <ActionButton onClick={handleResetCancel} disabled={busy}>
                Cancel
              </ActionButton>
            </div>
          </div>
        )}
        {resetStep === "running" && (
          <div style={{ paddingTop: "0.5rem", fontSize: "0.875rem", color: "#6b7280" }}>
            Resetting…
          </div>
        )}
        {resetStep === "done" && (
          <div style={{ paddingTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <div style={{ fontSize: "0.875rem", color: "#16a34a" }}>
              Reset complete. You can now move Joyus Desktop to the Trash.
            </div>
            <div>
              <ActionButton onClick={handleResetCancel}>Dismiss</ActionButton>
            </div>
          </div>
        )}
      </SettingsSection>

      {/* About */}
      <SettingsSection title="About">
        <div style={{ paddingTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#111827" }}>
            Joyus Desktop Companion
          </div>
          <div style={{ fontSize: "0.813rem", color: "#6b7280" }}>
            Version: {config?.version ?? "—"}
          </div>
          {config?.buildDate !== undefined && (
            <div style={{ fontSize: "0.813rem", color: "#6b7280" }}>
              Built: {config.buildDate}
            </div>
          )}
          <div style={{ fontSize: "0.813rem", color: "#6b7280", marginTop: "0.5rem" }}>
            <strong style={{ color: "#374151" }}>Uninstall:</strong> Remove the app from your
            Applications folder and delete <code style={{ fontFamily: "monospace" }}>~/Library/Application Support/com.joyus.desktop</code> to fully clean up.
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}
