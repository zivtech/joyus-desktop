import { useEffect, useState } from "react";

interface ChromeStatus {
  available: boolean;
}

export const CHROME_DETECT_COMMAND = "detect_chrome";

async function safeInvoke<T>(cmd: string): Promise<T | undefined> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd);
  } catch {
    return undefined;
  }
}

export function useChromeAvailable(): boolean | undefined {
  const [available, setAvailable] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    void safeInvoke<ChromeStatus>(CHROME_DETECT_COMMAND).then((result) => {
      if (result !== undefined) {
        setAvailable(result.available);
      }
    });
  }, []);

  return available;
}
