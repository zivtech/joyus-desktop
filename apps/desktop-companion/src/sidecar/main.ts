import { createInterface } from "node:readline";
import { createIpcHandler } from "./ipc-handler";
import { createServices, registerHealthCheck } from "./services";
import type { ServiceDeps } from "./services";

export interface SidecarDeps {
  stdin: NodeJS.ReadableStream;
  stdout: { write: (data: string) => void };
  stderr: { write: (data: string) => void };
  exit: (code: number) => void;
  onSignal: (signal: string, handler: () => void) => void;
  onUncaughtException: (handler: (err: unknown) => void) => void;
  onUnhandledRejection: (handler: (reason: unknown) => void) => void;
  nowFn: () => number;
  serviceDeps: ServiceDeps;
  isOptedOut: () => boolean;
  emitTelemetry: (params: {
    toolName: string;
    source: string;
    message: string;
  }) => Promise<void>;
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

  function handleFatalError(source: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    deps.stderr.write(`Fatal error [${source}]: ${message}\n`);

    ipc.sendNotification("state.error", { source, message, fatal: true });

    if (!deps.isOptedOut()) {
      void deps.emitTelemetry({ toolName: "app_error", source, message });
    }

    deps.exit(1);
  }

  deps.onUncaughtException((err: unknown) => {
    handleFatalError("uncaughtException", err);
  });

  deps.onUnhandledRejection((reason: unknown) => {
    handleFatalError("unhandledRejection", reason);
  });

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
