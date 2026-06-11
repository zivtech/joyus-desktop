import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

interface UpdatePayload {
  version: string;
  notes: string;
}

export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdatePayload | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const unlisten = listen<UpdatePayload>("update:available", (event) => {
      setUpdate(event.payload);
      setDismissed(false);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  if (!update || dismissed) {
    return null;
  }

  const handleRestart = () => {
    void invoke("install_update");
  };

  const handleDismiss = () => {
    setDismissed(true);
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.5rem 1rem",
        background: "#1a73e8",
        color: "#fff",
        fontSize: "0.875rem",
      }}
    >
      <span>Update v{update.version} available{update.notes ? ` — ${update.notes}` : ""}</span>
      <span style={{ display: "flex", gap: "0.5rem" }}>
        <button
          onClick={handleRestart}
          style={{
            padding: "0.25rem 0.75rem",
            background: "#fff",
            color: "#1a73e8",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Restart Now
        </button>
        <button
          onClick={handleDismiss}
          style={{
            padding: "0.25rem 0.75rem",
            background: "transparent",
            color: "#fff",
            border: "1px solid #fff",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Later
        </button>
      </span>
    </div>
  );
}
