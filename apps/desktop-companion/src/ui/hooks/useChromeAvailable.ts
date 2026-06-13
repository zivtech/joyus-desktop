import { useEffect, useState } from "react";

interface ChromeStatus {
  available: boolean;
}

export const CHROME_DETECT_COMMAND = "detect_chrome";

type InvokeFn = <T>(cmd: string) => Promise<T | undefined>;

interface UseChromeAvailableDeps {
  readonly invoke?: InvokeFn;
}

async function defaultInvoke<T>(cmd: string): Promise<T | undefined> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(cmd);
  } catch {
    return undefined;
  }
}

async function safeInvoke<T>(invokeFn: InvokeFn, cmd: string): Promise<T | undefined> {
  try {
    return await invokeFn<T>(cmd);
  } catch {
    return undefined;
  }
}

export function useChromeAvailable(deps: UseChromeAvailableDeps = {}): boolean | undefined {
  const [available, setAvailable] = useState<boolean | undefined>(undefined);
  const invokeFn = deps.invoke ?? defaultInvoke;

  useEffect(() => {
    void safeInvoke<ChromeStatus>(invokeFn, CHROME_DETECT_COMMAND).then((result) => {
      if (result !== undefined) {
        setAvailable(result.available);
      }
    });
  }, [invokeFn]);

  return available;
}
