export interface DriftSignalPayload {
  taskBranchId: string;
  confidence: "low" | "high";
  heuristics: {
    directoryCount: number;
    topicDomainCount: number;
    elapsedMinutes: number;
  };
  explanation: string;
}

interface DriftBannerProps {
  signal: DriftSignalPayload;
  onDismiss: (taskBranchId: string) => void;
  onNewSession: (taskBranchId: string) => void;
}

export function DriftBanner({ signal, onDismiss, onNewSession }: DriftBannerProps) {
  if (signal.confidence === "low") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          background: "#fffbeb",
          border: "1px solid #fde68a",
          borderRadius: "6px",
          padding: "0.625rem 0.875rem",
          fontSize: "0.875rem",
          color: "#92400e",
        }}
      >
        <span>
          Your work may be spreading across multiple areas. Consider starting a
          fresh task.
        </span>
        <button
          onClick={() => onDismiss(signal.taskBranchId)}
          aria-label="Dismiss"
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "#92400e",
            fontSize: "1rem",
            lineHeight: 1,
            padding: "0 0.25rem",
            flexShrink: 0,
          }}
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "#fff7ed",
        border: "1px solid #fed7aa",
        borderRadius: "8px",
        padding: "1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
      }}
    >
      <div>
        <div
          style={{
            fontWeight: 600,
            fontSize: "0.9375rem",
            color: "#7c2d12",
            marginBottom: "0.375rem",
          }}
        >
          This task is covering a lot of ground
        </div>
        <div style={{ fontSize: "0.875rem", color: "#9a3412" }}>
          {signal.explanation}
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button
          onClick={() => onNewSession(signal.taskBranchId)}
          style={{
            background: "#ea580c",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            padding: "0.375rem 0.75rem",
            fontSize: "0.8125rem",
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          Start Fresh Task
        </button>
        <button
          onClick={() => onDismiss(signal.taskBranchId)}
          style={{
            background: "transparent",
            color: "#7c2d12",
            border: "1px solid #fdba74",
            borderRadius: "6px",
            padding: "0.375rem 0.75rem",
            fontSize: "0.8125rem",
            cursor: "pointer",
          }}
        >
          Keep Going
        </button>
      </div>
    </div>
  );
}
