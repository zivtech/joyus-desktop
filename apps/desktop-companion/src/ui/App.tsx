import { useEffect, useState } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Governance } from "./pages/Governance";
import { Servers } from "./pages/Servers";
import { Sessions } from "./pages/Sessions";
import { Skills } from "./pages/Skills";
import { Settings } from "./pages/Settings";
import { Sites } from "./pages/Sites";
import { Onboarding } from "./pages/Onboarding";
import { ReconDashboard } from "./pages/ReconDashboard";
import { ReconSetup } from "./pages/ReconSetup";
import { Usage } from "./pages/Usage";

async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  } catch {
    return undefined;
  }
}

interface AppRoutesProps {
  initialOnboardingComplete?: boolean;
}

function AppRoutes({ initialOnboardingComplete = false }: AppRoutesProps) {
  const navigate = useNavigate();
  const [checked, setChecked] = useState(initialOnboardingComplete);

  useEffect(() => {
    if (initialOnboardingComplete) {
      return;
    }
    void safeInvoke<string>("get_config", { key: "onboarding_complete" }).then((value) => {
      if (value !== "true") {
        navigate("/onboarding", { replace: true });
      }
      setChecked(true);
    });
  }, [initialOnboardingComplete, navigate]);

  if (!checked) {
    return null;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="/servers" element={<Servers />} />
        <Route path="/skills" element={<Skills />} />
        <Route path="/sessions" element={<Sessions />} />
        <Route path="/sites" element={<Sites />} />
        <Route path="/governance" element={<Governance />} />
        <Route path="/usage" element={<Usage />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/recon" element={<ReconDashboard />} />
      </Route>
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/recon/setup" element={<ReconSetup />} />
    </Routes>
  );
}

interface AppProps {
  initialEntries?: string[];
  initialOnboardingComplete?: boolean;
}

export function App({ initialEntries = ["/"], initialOnboardingComplete = false }: AppProps = {}) {
  return (
    <MemoryRouter initialEntries={initialEntries} initialIndex={0}>
      <AppRoutes initialOnboardingComplete={initialOnboardingComplete} />
    </MemoryRouter>
  );
}
