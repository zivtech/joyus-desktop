export type StatusType = "running" | "stopped" | "error" | "starting";

interface StatusBadgeProps {
  status: StatusType;
}

const STATUS_COLORS: Record<StatusType, string> = {
  running: "#22c55e",
  stopped: "#94a3b8",
  error: "#ef4444",
  starting: "#f59e0b",
};

const STATUS_LABELS: Record<StatusType, string> = {
  running: "Running",
  stopped: "Stopped",
  error: "Error",
  starting: "Starting",
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const color = STATUS_COLORS[status];
  const label = STATUS_LABELS[status];

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}>
      <span
        style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          backgroundColor: color,
          display: "inline-block",
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: "0.813rem", color: "#374151" }}>{label}</span>
    </span>
  );
}
