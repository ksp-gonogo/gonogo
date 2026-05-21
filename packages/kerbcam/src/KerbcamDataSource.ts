import type {
  ConfigField,
  DataKey,
  DataSource,
  DataSourceStatus,
} from "@gonogo/core";
import { registerDataSource } from "@gonogo/core";
import type { CameraState } from "@jonpepler/kerbcam";
import {
  type ConnectionStatus,
  KerbcamConnection,
  type KerbcamConnectionConfig,
} from "./KerbcamConnection";

/**
 * gonogo `DataSource` wrapper around the kerbcam sidecar.
 *
 * Surfaces in the Data Sources widget so the operator can see at a
 * glance whether kerbcam is reachable and edit the sidecar host/port
 * from the same config UI as every other source.
 *
 * Doesn't expose telemetry-style data keys — kerbcam streams video,
 * which doesn't fit the scalar `subscribe(key, cb)` shape — but does
 * cache the per-camera registry from the sidecar's `camera-snapshot`
 * pushes so other widgets can read it via {@link useKerbcamCameras}.
 * Video frames bind via {@link useKerbcamStream} (returns a
 * `MediaStream` directly; not a value channel).
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
   */
  affectedBySignalLoss = false;

  private cfg: KerbcamConfig;
  private connection: KerbcamConnection;
  private statusListeners = new Set<(status: DataSourceStatus) => void>();
  private camerasKeySubs = new Set<(value: unknown) => void>();

  constructor(config?: KerbcamConfig) {
    this.cfg = config ?? loadConfig();
    this.connection = new KerbcamConnection(this.cfg);
    this.connection.onStatusChange((s) => this.setStatus(mapStatus(s)));
    this.connection.onCamerasChange((cams) => {
      this.camerasKeySubs.forEach((cb) => cb(cams));
    });
  }

  /** Underlying connection (hooks reach in directly via this). */
  getConnection(): KerbcamConnection {
    return this.connection;
  }

  // -- DataSource contract --

  async connect(): Promise<void> {
    await this.connection.connect();
  }

  disconnect(): void {
    this.connection.disconnect();
  }

  schema(): DataKey[] {
    return [
      {
        key: "kerbcam.cameras",
      },
    ];
  }

  subscribe(key: string, cb: (value: unknown) => void): () => void {
    if (key !== "kerbcam.cameras") {
      // Unknown key — no-op so callers don't crash on typos, matching
      // the other sources' tolerance.
      return () => {};
    }
    this.camerasKeySubs.add(cb);
    // Replay the cached snapshot on the next tick so subscribers don't
    // need to wait for the next sidecar push to render.
    queueMicrotask(() => cb(this.connection.getCameras()));
    return () => this.camerasKeySubs.delete(cb);
  }

  async execute(action: string): Promise<void> {
    // Action grammar: `kerbcam.set-layers[flightId,NEAR,SCALED]` etc.
    // Parsing is intentionally tiny — the hooks layer is the
    // ergonomic surface; this exists for parity with how the alarms
    // widget actions get triggered via the action-dispatch system.
    const [name, args] = parseAction(action);
    switch (name) {
      case "set-layers": {
        const [flightId, ...layers] = args;
        if (!flightId) return;
        this.connection.sendSetLayers(Number(flightId), layers);
        break;
      }
      case "set-render-size": {
        const [flightId, w, h] = args;
        if (!flightId || !w || !h) return;
        this.connection.sendSetRenderSize(Number(flightId), Number(w), Number(h));
        break;
      }
      case "set-fov": {
        const [flightId, fov] = args;
        if (!flightId || !fov) return;
        this.connection.sendSetFov(Number(flightId), Number(fov));
        break;
      }
      case "request-keyframe": {
        const [flightId] = args;
        if (!flightId) return;
        this.connection.sendRequestKeyframe(Number(flightId));
        break;
      }
    }
  }

  onStatusChange(cb: (status: DataSourceStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  configSchema(): ConfigField[] {
    return [
      { key: "host", label: "Sidecar host", type: "text", placeholder: "127.0.0.1" },
      { key: "port", label: "Sidecar port", type: "number", placeholder: "8088" },
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
    this.connection.disconnect();
    this.connection = new KerbcamConnection(this.cfg);
    this.connection.onStatusChange((s) => this.setStatus(mapStatus(s)));
    this.connection.onCamerasChange((cams) => {
      this.camerasKeySubs.forEach((cb) => cb(cams));
    });
  }

  // -- private --

  private setStatus(status: DataSourceStatus): void {
    this.status = status;
    this.statusListeners.forEach((cb) => cb(status));
  }
}

function mapStatus(s: ConnectionStatus): DataSourceStatus {
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
