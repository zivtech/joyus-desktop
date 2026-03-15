import { useEffect, useState } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Onboarding } from "./pages/Onboarding";

async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  } catch {
    return undefined;
  }
}

function Placeholder({ title }: { title: string }) {
  return (
    <div>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>{title}</h1>
      <p style={{ color: "#6b7280", marginTop: "0.5rem" }}>Coming soon.</p>
    </div>
  );
}

// Handles first-run detection and redirects to /onboarding when needed.
function AppRoutes() {
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    void safeInvoke<string>("get_config", { key: "onboarding_complete" }).then((value) => {
      if (value !== "true") {
        navigate("/onboarding", { replace: true });
      }
      setChecked(true);
    });
  }, [navigate]);

  if (!checked) {
    return null;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="/servers" element={<Placeholder title="Servers" />} />
        <Route path="/skills" element={<Placeholder title="Skills" />} />
        <Route path="/governance" element={<Placeholder title="Governance" />} />
        <Route path="/usage" element={<Placeholder title="Usage" />} />
        <Route path="/settings" element={<Placeholder title="Settings" />} />
      </Route>
      <Route path="/onboarding" element={<Onboarding />} />
    </Routes>
  );
}

export function App() {
  return (
    <MemoryRouter initialEntries={["/"]} initialIndex={0}>
      <AppRoutes />
    </MemoryRouter>
  );
}
