import { createInterface } from "node:readline";
import { createIpcHandler } from "./ipc-handler";
import {
  createServices,
  registerHealthCheck,
  registerServerMethods,
  registerServerNotifications,
  registerChromeDetect,
} from "./services";
import type { ServiceDeps } from "./services";
import type { ChromeDetectDeps } from "./chrome-detect";
import { createDefaultChromeDeps } from "./chrome-detect";

export interface SidecarDeps {
  stdin: NodeJS.ReadableStream;
  stdout: { write: (data: string) => void };
  stderr: { write: (data: string) => void };
  exit: (code: number) => void;
  onSignal: (signal: string, handler: () => void) => void;
  nowFn: () => number;
  serviceDeps: ServiceDeps;
  chromeDeps?: ChromeDetectDeps;
}

export interface SidecarHandle {
  ipc: {
    sendNotification: (method: string, params: unknown) => void;
  };
}

export function startSidecar(deps: SidecarDeps): SidecarHandle {
  const startTime = deps.nowFn();

  const writeFn = (data: string): void => {
    deps.stdout.write(data);
  };

  const ipc = createIpcHandler(writeFn);
  const services = createServices(deps.serviceDeps);

  registerHealthCheck(ipc, startTime, deps.nowFn);
  registerServerMethods(ipc, services.registry);
  registerServerNotifications(ipc, services.processManager, services.registry);
  registerChromeDetect(ipc, deps.chromeDeps ?? createDefaultChromeDeps());

  const rl = createInterface({ input: deps.stdin });

  rl.on("line", (line: string) => {
    void (async () => {
      try {
        const response = await ipc.handleRequest(line);
        deps.stdout.write(response + "\n");
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        deps.stderr.write(`IPC error: ${message}\n`);
      }
    })();
  });

  deps.onSignal("SIGTERM", () => {
    rl.close();
    void services.processManager.stopAll().then(() => {
      services.configPoller.stop();
      services.periodicSync.stop();
      deps.exit(0);
    });
  });

  return {
    ipc: {
      sendNotification: ipc.sendNotification,
    },
  };
}
