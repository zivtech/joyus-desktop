import { createInterface } from "node:readline";
import { createIpcHandler } from "./ipc-handler";
import { createServices, registerAllMethods, registerSessionMethods } from "./services";
import type { ServiceDeps } from "./services";
import {
  createConfigChangeHandler,
  createConfigCheckWiring,
  resolveSidecarManagedToolingConfigFromEnv,
  type ConfigCheckWiringConfig,
  type SidecarManagedToolingConfig,
} from "./configCheckWiring";
import type { PollerHandle } from "./configCheckPoller";
import { createSessionWiring } from "./sessionWiring";
import type { SessionWiringDeps } from "./sessionWiring";

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
  managedToolingConfig?: SidecarManagedToolingConfig;
  createConfigCheckWiringFn?: (
    config: ConfigCheckWiringConfig,
  ) => PollerHandle;
  createSessionWiringFn?: (deps: SessionWiringDeps) => Promise<{
    sessionManager: unknown;
    store: unknown;
    detector: unknown;
    driftDetector: unknown;
    shutdown: () => Promise<void>;
  }>;
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

  registerAllMethods(ipc, services, startTime, deps.nowFn);

  const managedToolingConfig =
    deps.managedToolingConfig ?? resolveSidecarManagedToolingConfigFromEnv();
  const configCheckWiringFn =
    deps.createConfigCheckWiringFn ?? createConfigCheckWiring;
  const configCheckHandle =
    managedToolingConfig !== undefined
      ? configCheckWiringFn({
          manifestUrl: managedToolingConfig.manifestUrl,
          ...(
            managedToolingConfig.intervalMs !== undefined
              ? { intervalMs: managedToolingConfig.intervalMs }
              : {}
          ),
          onSync: createConfigChangeHandler({
            syncConfig: managedToolingConfig.syncConfig,
            ...(
              managedToolingConfig.reconcileConfig !== undefined
                ? { reconcileConfig: managedToolingConfig.reconcileConfig }
                : {}
            ),
            ...(
              managedToolingConfig.tenantConfigPath !== undefined
                ? { tenantConfigPath: managedToolingConfig.tenantConfigPath }
                : {}
            ),
            logger: {
              error: (message: string) => {
                deps.stderr.write(message + "\n");
              },
              warn: (message: string) => {
                deps.stderr.write(message + "\n");
              },
            },
          }),
          onPollError: (error: Error) => {
            deps.stderr.write(
              `configCheckWiring: poll failed: ${error.message}\n`,
            );
          },
        })
      : undefined;

  // Wire session methods asynchronously — keep startSidecar synchronous
  const sessionWiringFn = deps.createSessionWiringFn ?? createSessionWiring;
  let sessionShutdown: (() => Promise<void>) | undefined;

  void sessionWiringFn({
    sendNotification: ipc.sendNotification.bind(ipc),
  }).then((wiring) => {
    // Cast needed since the injectable type uses `unknown` for testability
    registerSessionMethods(ipc, wiring as Parameters<typeof registerSessionMethods>[1]);
    sessionShutdown = wiring.shutdown;
  }).catch((_err: unknown) => {
    // Session wiring failure is non-fatal: sidecar continues without session methods
  });

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
    const cleanup = sessionShutdown !== undefined ? sessionShutdown() : Promise.resolve();
    void cleanup.then(() =>
      services.processManager.stopAll().then(() => {
        configCheckHandle?.stop();
        services.configPoller.stop();
        services.periodicSync.stop();
        deps.exit(0);
      }),
    );
  });

  return {
    ipc: {
      sendNotification: ipc.sendNotification,
    },
  };
}
