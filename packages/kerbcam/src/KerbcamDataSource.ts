import type {
  ConfigField,
  DataKey,
  DataSource,
  DataSourceStatus,
} from "@gonogo/core";
import { registerDataSource } from "@gonogo/core";
import {
  type CameraState,
  KerbcamClient,
  type KerbcamConnectionState,
  type KerbcamTransport,
  type Layer,
} from "@jonpepler/kerbcam";

/**
 * gonogo `DataSource` wrapper around `KerbcamClient`. Surfaces the
 * sidecar connection in the Data Sources widget and re-exposes the
 * cached camera registry under the `kerbcam.cameras` data key.
 *
 * Video frames bind via {@link useKerbcamStream} (returns a
 * `MediaStream` directly — not a value channel) and the camera list
 * via {@link useKerbcamCameras}, both of which reach into the
 * underlying client via {@link getClient}.
 */

export interface KerbcamConfig extends Record<string, unknown> {
  host: string;
  port: number;
}

const DEFAULT_CONFIG: KerbcamConfig = { host: "127.0.0.1", port: 8088 };

const STORAGE_KEY = "gonogo.datasource.kerbcam";

function loadConfig(): KerbcamConfig {
  if (typeof localStorage === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<KerbcamConfig>;
    return {
      host: typeof parsed.host === "string" ? parsed.host : DEFAULT_CONFIG.host,
      port: typeof parsed.port === "number" ? parsed.port : DEFAULT_CONFIG.port,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function persistConfig(cfg: KerbcamConfig): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    /* localStorage full / disabled — config still applies in-memory */
  }
}

export class KerbcamDataSource implements DataSource<KerbcamConfig> {
  id = "kerbcam";
  name = "Kerbcam";
  status: DataSourceStatus = "disconnected";
  /**
   * Kerbcam streams are independent of CommNet — losing the in-game
   * antenna doesn't affect the WebRTC connection to the sidecar.
   * Camera widgets visualise signal loss via `set-degrade` instead.
   */
  affectedBySignalLoss = false;

  private cfg: KerbcamConfig;
  private transport: KerbcamTransport | undefined;
  private client: KerbcamClient;
  private clientUnsubs: Array<() => void> = [];
  private statusListeners = new Set<(status: DataSourceStatus) => void>();
  private camerasKeySubs = new Set<(value: unknown) => void>();

  constructor(config?: KerbcamConfig, transport?: KerbcamTransport) {
    this.cfg = config ?? loadConfig();
    this.transport = transport;
    this.client = this.buildClient();
  }

  /** Underlying client (hooks reach in directly via this). */
  getClient(): KerbcamClient {
    return this.client;
  }

  // -- DataSource contract --

  async connect(): Promise<void> {
    await this.client.connect();
  }

  disconnect(): void {
    this.client.disconnect();
  }

  schema(): DataKey[] {
    return [{ key: "kerbcam.cameras" }];
  }

  subscribe(key: string, cb: (value: unknown) => void): () => void {
    if (key !== "kerbcam.cameras") return () => {};
    this.camerasKeySubs.add(cb);
    queueMicrotask(() => cb(this.client.cameras));
    return () => this.camerasKeySubs.delete(cb);
  }

  async execute(action: string): Promise<void> {
    const [name, args] = parseAction(action);
    const [flightIdRaw, ...rest] = args;
    if (!flightIdRaw) return;
    const cam = this.client.camera(Number(flightIdRaw));
    switch (name) {
      case "set-layers":
        await cam.setLayers(rest as Layer[]);
        break;
      case "set-render-size": {
        const [w, h] = rest;
        if (!w || !h) return;
        await cam.setRenderSize(Number(w), Number(h));
        break;
      }
      case "set-fov": {
        const [fov] = rest;
        if (!fov) return;
        await cam.setFov(Number(fov));
        break;
      }
      case "set-degrade": {
        const [level] = rest;
        if (!level) return;
        await cam.setDegrade(Number(level));
        break;
      }
      case "request-keyframe":
        await cam.requestKeyframe();
        break;
    }
  }

  onStatusChange(cb: (status: DataSourceStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  configSchema(): ConfigField[] {
    return [
      {
        key: "host",
        label: "Sidecar host",
        type: "text",
        placeholder: "127.0.0.1",
      },
      {
        key: "port",
        label: "Sidecar port",
        type: "number",
        placeholder: "8088",
      },
    ];
  }

  getConfig(): KerbcamConfig {
    return { ...this.cfg };
  }

  configure(config: Record<string, unknown>): void {
    this.cfg = {
      host: typeof config.host === "string" ? config.host : this.cfg.host,
      port:
        typeof config.port === "number"
          ? config.port
          : Number(config.port) || this.cfg.port,
    };
    persistConfig(this.cfg);
    this.teardownClient();
    this.client = this.buildClient();
  }

  // -- private --

  private buildClient(): KerbcamClient {
    const client = new KerbcamClient(
      { host: this.cfg.host, port: this.cfg.port },
      this.transport,
    );
    this.clientUnsubs.push(
      client.on("state-change", (s) => this.setStatus(mapStatus(s))),
      client.on("cameras-change", (cams) => {
        this.camerasKeySubs.forEach((cb) => {
          cb(cams);
        });
      }),
    );
    return client;
  }

  private teardownClient(): void {
    this.client.disconnect();
    this.clientUnsubs.forEach((off) => {
      off();
    });
    this.clientUnsubs = [];
  }

  private setStatus(status: DataSourceStatus): void {
    this.status = status;
    this.statusListeners.forEach((cb) => {
      cb(status);
    });
  }
}

function mapStatus(s: KerbcamConnectionState): DataSourceStatus {
  switch (s) {
    case "connected":
      return "connected";
    case "connecting":
      return "reconnecting";
    case "disconnected":
      return "disconnected";
    case "failed":
      return "error";
  }
}

function parseAction(action: string): [string, string[]] {
  const dot = action.indexOf(".");
  const rest = dot === -1 ? action : action.slice(dot + 1);
  const bracket = rest.indexOf("[");
  if (bracket === -1) return [rest, []];
  const name = rest.slice(0, bracket);
  const argList = rest.slice(bracket + 1, rest.lastIndexOf("]"));
  const args = argList
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
  return [name, args];
}

export const kerbcamSource = new KerbcamDataSource();
registerDataSource(kerbcamSource);

export type { CameraState };
