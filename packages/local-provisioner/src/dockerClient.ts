import { request as httpRequest } from "node:http";
import type { RequestOptions } from "node:http";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DockerInfo {
  readonly serverVersion: string | undefined;
  readonly ncpu: number | undefined;
  readonly memTotal: number | undefined;
  readonly containers: number | undefined;
  readonly containersRunning: number | undefined;
}

export interface DockerContainer {
  readonly id: string;
  readonly names: readonly string[];
  readonly state: string;
}

export interface DockerCpuStats {
  readonly cpuDelta: number;
  readonly systemDelta: number;
  readonly onlineCpus: number;
  readonly memoryUsageBytes: number;
  readonly memoryLimitBytes: number;
}

// ─── HTTP adapter ────────────────────────────────────────────────────────────

export type HttpRequestFn = (
  opts: RequestOptions,
  cb: (res: HttpResponse) => void,
) => HttpRequestHandle;

export interface HttpResponse {
  readonly statusCode: number | undefined;
  on(event: "data", cb: (chunk: Buffer) => void): this;
  on(event: "end", cb: () => void): this;
  on(event: "error", cb: (err: Error) => void): this;
}

export interface HttpRequestHandle {
  on(event: "error", cb: (err: Error) => void): this;
  end(): void;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function doRequest(
  httpReq: HttpRequestFn,
  socketPath: string,
  path: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpReq(
      {
        socketPath,
        path,
        method: "GET",
        headers: { Host: "localhost" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({
            /* v8 ignore next -- statusCode always set by http module */
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ─── DockerClient ────────────────────────────────────────────────────────────

export interface DockerClient {
  /** Returns true if the Docker daemon responds to /_ping. */
  ping(): Promise<boolean>;

  /** Returns system info from /info, or undefined if the daemon is unreachable. */
  info(): Promise<DockerInfo | undefined>;

  /** Returns the list of running containers from /containers/json. */
  listContainers(): Promise<readonly DockerContainer[]>;

  /** Returns CPU/memory stats for a container. Returns undefined on error. */
  containerStats(id: string): Promise<DockerCpuStats | undefined>;
}

export function createDockerClient(
  socketPath: string,
  httpReq: HttpRequestFn = httpRequest as unknown as HttpRequestFn,
): DockerClient {
  return {
    async ping(): Promise<boolean> {
      try {
        const { status, body } = await doRequest(httpReq, socketPath, "/_ping");
        return status === 200 && body.trim() === "OK";
      } catch {
        return false;
      }
    },

    async info(): Promise<DockerInfo | undefined> {
      try {
        const { status, body } = await doRequest(httpReq, socketPath, "/info");
        if (status !== 200) return undefined;
        const raw = JSON.parse(body) as Record<string, unknown>;
        return {
          serverVersion:
            typeof raw["ServerVersion"] === "string"
              ? raw["ServerVersion"]
              : undefined,
          ncpu: typeof raw["NCPU"] === "number" ? raw["NCPU"] : undefined,
          memTotal:
            typeof raw["MemTotal"] === "number" ? raw["MemTotal"] : undefined,
          containers:
            typeof raw["Containers"] === "number"
              ? raw["Containers"]
              : undefined,
          containersRunning:
            typeof raw["ContainersRunning"] === "number"
              ? raw["ContainersRunning"]
              : undefined,
        };
      } catch {
        return undefined;
      }
    },

    async listContainers(): Promise<readonly DockerContainer[]> {
      try {
        const { status, body } = await doRequest(
          httpReq,
          socketPath,
          "/containers/json",
        );
        if (status !== 200) return [];
        const raw = JSON.parse(body) as Array<Record<string, unknown>>;
        return raw.map((c) => ({
          id: typeof c["Id"] === "string" ? c["Id"] : "",
          names: Array.isArray(c["Names"])
            ? (c["Names"] as unknown[]).filter(
                (n): n is string => typeof n === "string",
              )
            : [],
          state: typeof c["State"] === "string" ? c["State"] : "",
        }));
      } catch {
        return [];
      }
    },

    async containerStats(id: string): Promise<DockerCpuStats | undefined> {
      try {
        const { status, body } = await doRequest(
          httpReq,
          socketPath,
          `/containers/${id}/stats?stream=false`,
        );
        if (status !== 200) return undefined;
        const raw = JSON.parse(body) as Record<string, unknown>;

        const cpuStats = raw["cpu_stats"] as
          | Record<string, unknown>
          | undefined;
        const preCpuStats = raw["precpu_stats"] as
          | Record<string, unknown>
          | undefined;
        const memStats = raw["memory_stats"] as
          | Record<string, unknown>
          | undefined;

        if (
          cpuStats === undefined ||
          preCpuStats === undefined ||
          memStats === undefined
        ) {
          return undefined;
        }

        const cpuUsage = cpuStats["cpu_usage"] as
          | Record<string, unknown>
          | undefined;
        const preCpuUsage = preCpuStats["cpu_usage"] as
          | Record<string, unknown>
          | undefined;

        if (cpuUsage === undefined || preCpuUsage === undefined) {
          return undefined;
        }

        const totalUsage =
          typeof cpuUsage["total_usage"] === "number"
            ? cpuUsage["total_usage"]
            : 0;
        const preTotalUsage =
          typeof preCpuUsage["total_usage"] === "number"
            ? preCpuUsage["total_usage"]
            : 0;
        const systemCpuUsage =
          typeof cpuStats["system_cpu_usage"] === "number"
            ? cpuStats["system_cpu_usage"]
            : 0;
        const preSystemCpuUsage =
          typeof preCpuStats["system_cpu_usage"] === "number"
            ? preCpuStats["system_cpu_usage"]
            : 0;
        const onlineCpus =
          typeof cpuStats["online_cpus"] === "number"
            ? cpuStats["online_cpus"]
            : 1;

        const memUsage =
          typeof memStats["usage"] === "number" ? memStats["usage"] : 0;
        const memLimit =
          typeof memStats["limit"] === "number" ? memStats["limit"] : 0;

        return {
          cpuDelta: totalUsage - preTotalUsage,
          systemDelta: systemCpuUsage - preSystemCpuUsage,
          onlineCpus,
          memoryUsageBytes: memUsage,
          memoryLimitBytes: memLimit,
        };
      } catch {
        return undefined;
      }
    },
  };
}
