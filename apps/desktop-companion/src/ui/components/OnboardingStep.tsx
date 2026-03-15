interface OnboardingStepProps {
  stepNumber: number;
  totalSteps: number;
  label: string;
  status: "pending" | "active" | "success" | "error";
}

export function OnboardingStep({ stepNumber, totalSteps, label, status }: OnboardingStepProps) {
  const isActive = status === "active";
  const isSuccess = status === "success";
  const isError = status === "error";
  const isPending = status === "pending";

  const circleColor = isSuccess
    ? "#22c55e"
    : isError
    ? "#ef4444"
    : isActive
    ? "#1a73e8"
    : "#d1d5db";

  const circleContent = isSuccess ? "✓" : isError ? "✗" : String(stepNumber);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        opacity: isPending ? 0.5 : 1,
      }}
    >
      <div
        style={{
          width: "2rem",
          height: "2rem",
          borderRadius: "50%",
          background: circleColor,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "0.875rem",
          fontWeight: 700,
          flexShrink: 0,
          transition: "background 0.2s",
        }}
      >
        {isActive ? (
          <span
            style={{
              width: "1rem",
              height: "1rem",
              borderRadius: "50%",
              border: "2px solid #fff",
              borderTopColor: "transparent",
              display: "inline-block",
              animation: "spin 0.8s linear infinite",
            }}
          />
        ) : (
          circleContent
        )}
      </div>
      <span
        style={{
          fontSize: "0.875rem",
          fontWeight: isActive ? 600 : 400,
          color: isActive ? "#111827" : isPending ? "#9ca3af" : "#374151",
        }}
      >
        {label}
      </span>
      <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "#9ca3af" }}>
        {stepNumber} of {totalSteps}
      </span>
    </div>
  );
}
