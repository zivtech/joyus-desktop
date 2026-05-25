import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CredentialForm } from "../components/CredentialForm";

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

type CheckStatus = "idle" | "checking" | "pass" | "fail";

// ─── Shared primitives ────────────────────────────────────────────────────────

function Spinner() {
  return (
    <span
      style={{
        display: "inline-block",
        width: "1rem",
        height: "1rem",
        border: "2px solid #e5e7eb",
        borderTop: "2px solid #1a73e8",
        borderRadius: "50%",
        animation: "spin 0.75s linear infinite",
        flexShrink: 0,
      }}
    />
  );
}

// Inject keyframe once (idempotent — duplicate <style> tags are harmless here)
if (typeof document !== "undefined") {
  const id = "recon-setup-spin";
  if (document.getElementById(id) === null) {
    const style = document.createElement("style");
    style.id = id;
    style.textContent = "@keyframes spin { to { transform: rotate(360deg); } }";
    document.head.appendChild(style);
  }
}

function StatusRow({
  icon,
  color,
  text,
}: {
  icon: string;
  color: string;
  text: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
      <span style={{ color, fontSize: "1.25rem", lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: "0.875rem", color: "#374151" }}>{text}</span>
    </div>
  );
}

// ─── Step indicator ───────────────────────────────────────────────────────────

interface StepIndicatorProps {
  currentStep: number; // 1-based
  stepStatuses: CheckStatus[];
}

function StepIndicator({ currentStep, stepStatuses }: StepIndicatorProps) {
  const labels = ["Detect Claude Code", "Credentials", "Skill File"];
  const total = labels.length;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 0,
        marginBottom: "0.5rem",
      }}
    >
      {labels.map((label, idx) => {
        const stepNum = idx + 1;
        const isActive = stepNum === currentStep;
        const isComplete = stepStatuses[idx] === "pass";
        const isUpcoming = stepNum > currentStep && !isComplete;

        const circleBg = isComplete ? "#22c55e" : isActive ? "#1a73e8" : "#e5e7eb";
        const circleColor = isComplete || isActive ? "#fff" : "#6b7280";

        // Line color: green if the preceding step is complete
        const lineColor = idx > 0 && stepStatuses[idx - 1] === "pass" ? "#22c55e" : "#e5e7eb";

        return (
          <div
            key={label}
            style={{
              display: "flex",
              alignItems: "center",
              flex: stepNum < total ? 1 : undefined,
            }}
          >
            {/* Connecting line (skip for first step) */}
            {idx > 0 && (
              <div
                style={{
                  flex: 1,
                  height: "2px",
                  background: lineColor,
                  transition: "background 0.2s",
                }}
              />
            )}

            {/* Step circle + label */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "0.375rem",
              }}
            >
              <div
                style={{
                  width: "2rem",
                  height: "2rem",
                  borderRadius: "50%",
                  background: circleBg,
                  color: circleColor,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.813rem",
                  fontWeight: 700,
                  transition: "background 0.2s",
                  flexShrink: 0,
                }}
              >
                {isComplete ? "✓" : stepNum}
              </div>
              <span
                style={{
                  fontSize: "0.688rem",
                  color: isActive ? "#1a73e8" : isComplete ? "#22c55e" : "#6b7280",
                  fontWeight: isActive ? 600 : 400,
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </span>
            </div>

            {/* Trailing line (for all but last step) */}
            {stepNum < total && (
              <div
                style={{
                  flex: 1,
                  height: "2px",
                  background: isComplete ? "#22c55e" : "#e5e7eb",
                  transition: "background 0.2s",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1: Claude Code detection ───────────────────────────────────────────

interface StepClaudeDetectProps {
  onResult: (pass: boolean) => void;
}

function StepClaudeDetect({ onResult }: StepClaudeDetectProps) {
  type DetectStatus = "checking" | "found" | "not-found";
  const [status, setStatus] = useState<DetectStatus>("checking");
  const [version, setVersion] = useState<string | undefined>(undefined);

  async function runDetect() {
    setStatus("checking");

    const result = await safeInvoke<{ found: boolean; version?: string }>(
      "check_claude_binary"
    );

    if (result === undefined || !result.found) {
      setStatus("not-found");
      onResult(false);
    } else {
      setVersion(result.version);
      setStatus("found");
      onResult(true);
    }
  }

  useEffect(() => {
    void runDetect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "checking") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
          <Spinner />
          <span style={{ fontSize: "0.875rem", color: "#6b7280" }}>Detecting Claude Code…</span>
        </div>
      </div>
    );
  }

  if (status === "found") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <StatusRow icon="✓" color="#22c55e" text="Claude Code found" />
        {version !== undefined && (
          <p style={{ margin: 0, fontSize: "0.813rem", color: "#6b7280" }}>Version: {version}</p>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <StatusRow icon="✗" color="#ef4444" text="Claude Code not found" />
      <p style={{ margin: 0, fontSize: "0.813rem", color: "#6b7280" }}>
        Install Claude Code to continue. Visit{" "}
        <span style={{ color: "#1a73e8" }}>docs.anthropic.com/claude-code</span>.
      </p>
      <button
        onClick={() => { void runDetect(); }}
        style={{
          alignSelf: "flex-start",
          padding: "0.5rem 1rem",
          background: "#1a73e8",
          color: "#fff",
          border: "none",
          borderRadius: "6px",
          fontSize: "0.813rem",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Check Again
      </button>
    </div>
  );
}

// ─── Step 2: Credentials ──────────────────────────────────────────────────────

interface StepCredentialsProps {
  onComplete: () => void;
}

function StepCredentials({ onComplete }: StepCredentialsProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <CredentialForm onComplete={onComplete} />
    </div>
  );
}

// ─── Step 3: Skill file check (with sync-first flow) ──────────────────────────

interface StepSkillCheckProps {
  onResult: (pass: boolean) => void;
}

function StepSkillCheck({ onResult }: StepSkillCheckProps) {
  // "syncing" → trying trigger_sync first
  // "checking" → running check_skill_file after sync attempt
  // "found" → skill present, ready
  // "not-found" → sync attempted but skill still absent
  type CheckState = "syncing" | "checking" | "found" | "not-found";
  const [state, setState] = useState<CheckState>("syncing");
  const [version, setVersion] = useState<string | undefined>(undefined);
  // When true: user chose "Skip (manual install)" — show warning but allow advance
  const [skipped, setSkipped] = useState(false);

  async function runCheck() {
    // Reset all state at the top so Retry works cleanly
    setState("syncing");
    setVersion(undefined);
    setSkipped(false);

    // Step 1: attempt sync (trigger_sync already exists in commands.rs)
    await safeInvoke("trigger_sync");

    // Step 2: read version info — capture for display, don't block on failure
    const syncStatus = await safeInvoke<{ version?: string }>("get_sync_status");
    if (syncStatus?.version !== undefined) {
      setVersion(syncStatus.version);
    }

    // Step 3: check whether the skill file is present
    setState("checking");
    const result = await safeInvoke<{ found: boolean }>("check_skill_file");

    if (result === undefined || !result.found) {
      setState("not-found");
      onResult(false);
    } else {
      setState("found");
      onResult(true);
    }
  }

  useEffect(() => {
    void runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Syncing ────────────────────────────────────────────────────────────────
  if (state === "syncing") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
        <Spinner />
        <span style={{ fontSize: "0.875rem", color: "#6b7280" }}>Syncing Recon Operator skill…</span>
      </div>
    );
  }

  // ── Checking (post-sync) ───────────────────────────────────────────────────
  if (state === "checking") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
        <Spinner />
        <span style={{ fontSize: "0.875rem", color: "#6b7280" }}>Checking skill file…</span>
      </div>
    );
  }

  // ── Found ──────────────────────────────────────────────────────────────────
  if (state === "found") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <StatusRow
          icon="✓"
          color="#22c55e"
          text={version !== undefined ? `Recon Operator skill ready (v${version})` : "Recon Operator skill ready"}
        />
        <p style={{ margin: 0, fontSize: "0.813rem", color: "#6b7280", fontFamily: "monospace" }}>
          ~/.claude/skills/joyus-recon.md
        </p>
      </div>
    );
  }

  // ── Not found (sync failed or skill absent) ────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <StatusRow icon="✗" color="#ef4444" text="Skill sync failed or skill not found." />

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        {/* Retry: re-runs sync + check from scratch */}
        <button
          onClick={() => { void runCheck(); }}
          style={{
            padding: "0.5rem 1rem",
            background: "#1a73e8",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            fontSize: "0.813rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Retry
        </button>

        {/* Skip: allow advancing without the skill — intentional, not a bug */}
        <button
          onClick={() => {
            setSkipped(true);
            // Calling onResult(true) here lets the wizard advance even though
            // the skill is absent. The warning banner below makes this explicit.
            onResult(true);
          }}
          style={{
            padding: "0.5rem 1rem",
            background: "transparent",
            color: "#6b7280",
            border: "none",
            fontSize: "0.813rem",
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          Skip (manual install)
        </button>
      </div>

      {/* Manual install instructions */}
      <p style={{ margin: 0, fontSize: "0.813rem", color: "#6b7280" }}>
        Ask Alex to copy joyus-recon.md to ~/.claude/skills/
      </p>

      {/* Warning banner shown after skip */}
      {skipped && (
        <div
          style={{
            background: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: "6px",
            padding: "0.625rem 0.875rem",
            fontSize: "0.813rem",
            color: "#b45309",
            fontWeight: 600,
          }}
        >
          Recon skill not installed. Some features may not work until the skill is added manually.
        </div>
      )}
    </div>
  );
}

// ─── Main wizard page ─────────────────────────────────────────────────────────

export function ReconSetup() {
  const navigate = useNavigate();

  const [currentStep, setCurrentStep] = useState(1);
  const [stepStatus, setStepStatus] = useState<CheckStatus[]>(["idle", "idle", "idle"]);

  function updateStepStatus(index: number, status: CheckStatus) {
    setStepStatus((prev) => {
      const next = [...prev];
      next[index] = status;
      return next;
    });
  }

  const canAdvance = stepStatus[currentStep - 1] === "pass";

  function handleBack() {
    if (currentStep > 1) {
      setCurrentStep((s) => s - 1);
    }
  }

  function handleNext() {
    if (currentStep < 3) {
      setCurrentStep((s) => s + 1);
    }
  }

  function handleFinish() {
    navigate("/recon");
  }

  const stepTitles = [
    "Detect Claude Code",
    "API Credentials",
    "Recon Skill File",
  ];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#f9fafb",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: "#111827",
        zIndex: 9999,
        overflowY: "auto",
      }}
    >
      {/* Wordmark */}
      <div
        style={{
          marginBottom: "1.5rem",
          fontSize: "1.5rem",
          fontWeight: 800,
          color: "#1a73e8",
          letterSpacing: "-0.02em",
        }}
      >
        Joyus Recon
      </div>

      {/* Card */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: "12px",
          padding: "2rem",
          width: "100%",
          maxWidth: "640px",
          display: "flex",
          flexDirection: "column",
          gap: "1.5rem",
          boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
        }}
      >
        {/* Step indicator */}
        <StepIndicator currentStep={currentStep} stepStatuses={stepStatus} />

        <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: 0 }} />

        {/* Step heading */}
        <div>
          <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700 }}>
            {stepTitles[currentStep - 1]}
          </h2>
        </div>

        {/* Step content */}
        <div style={{ minHeight: "240px" }}>
          {currentStep === 1 && (
            <StepClaudeDetect
              onResult={(pass) => {
                updateStepStatus(0, pass ? "pass" : "fail");
              }}
            />
          )}
          {currentStep === 2 && (
            <StepCredentials
              onComplete={() => {
                updateStepStatus(1, "pass");
              }}
            />
          )}
          {currentStep === 3 && (
            <StepSkillCheck
              onResult={(pass) => {
                updateStepStatus(2, pass ? "pass" : "fail");
              }}
            />
          )}
        </div>

        <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: 0 }} />

        {/* Bottom navigation */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {/* Back */}
          <button
            onClick={handleBack}
            disabled={currentStep === 1}
            style={{
              padding: "0.5rem 1rem",
              background: "transparent",
              color: currentStep === 1 ? "#d1d5db" : "#6b7280",
              border: `1px solid ${currentStep === 1 ? "#e5e7eb" : "#d1d5db"}`,
              borderRadius: "6px",
              fontSize: "0.875rem",
              cursor: currentStep === 1 ? "not-allowed" : "pointer",
            }}
          >
            Back
          </button>

          {/* Next / Finish */}
          {currentStep < 3 ? (
            <button
              onClick={handleNext}
              disabled={!canAdvance}
              style={{
                padding: "0.625rem 1.5rem",
                background: canAdvance ? "#1a73e8" : "#d1d5db",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                fontSize: "0.938rem",
                fontWeight: 600,
                cursor: canAdvance ? "pointer" : "not-allowed",
              }}
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleFinish}
              disabled={!canAdvance}
              style={{
                padding: "0.625rem 1.5rem",
                background: canAdvance ? "#22c55e" : "#d1d5db",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                fontSize: "0.938rem",
                fontWeight: 600,
                cursor: canAdvance ? "pointer" : "not-allowed",
              }}
            >
              Finish
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
