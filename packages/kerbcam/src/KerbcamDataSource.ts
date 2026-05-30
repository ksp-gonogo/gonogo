import type {
  ConfigField,
  DataKey,
  DataSource,
  DataSourceStatus,
} from "@gonogo/core";
import { PerfBudget, registerDataSource } from "@gonogo/core";
import {
  type CameraState,
  type ClientMessage,
  KerbcamClient,
  type KerbcamConnectionState,
  type KerbcamDataChannel,
  type KerbcamPeer,
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

const PING_WATCHDOG_MS = 15_000;
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

// The kerbcam WebRTC stream needs the same TURN relay the PeerJS host uses
// for non-LAN delivery. The gonogo relay bundles coturn and serves the
// rotated creds at `/ice-config` (see packages/relay). We fetch them here and
// hand them to the SDK client; with no relay reachable we fall back to the
// SDK's STUN-only default so kerbcam-on-LAN keeps working untouched. Mirrors
// the host's app/peer/iceServers.ts (kerbcam can't import across that package
// boundary, so the small fetch is duplicated rather than shared).
const RELAY_DEFAULT_URL = "http://localhost:3002";
const ICE_FETCH_TIMEOUT_MS = 4_000;

function relayBaseUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  return (env?.VITE_RELAY_URL ?? RELAY_DEFAULT_URL).replace(/\/$/, "");
}

/**
 * Fetch the relay's TURN credentials. Returns `[]` on any failure — a 503
 * (coturn down), a timeout, or no relay at all — so the caller leaves the SDK
 * on its `stun:stun.l.google.com` default rather than breaking connect.
 */
async function fetchRelayIceServers(): Promise<RTCIceServer[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ICE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${relayBaseUrl()}/ice-config`, {
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { iceServers?: RTCIceServer[] };
    return Array.isArray(body.iceServers) ? body.iceServers : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

const KERBCAM_CAMERAS_BUDGET = new PerfBudget({
  name: "KerbcamDataSource cameras updates/sec",
  threshold: 50,
  windowMs: 1000,
  unit: "updates",
});

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

// ---------------------------------------------------------------------------
// BrowserRTCTransport — mirrors the SDK's private BrowserKerbcamTransport.
// Copied from @jonpepler/kerbcam/dist/client.js so KeepaliveTransport can
// wrap it without depending on the SDK's unexported class.
// ---------------------------------------------------------------------------

function mapRTCState(state: RTCPeerConnectionState): KerbcamConnectionState {
  switch (state) {
    case "new":
    case "connecting":
      return "connecting";
    case "connected":
      return "connected";
    case "failed":
      return "failed";
    case "disconnected":
    case "closed":
      return "disconnected";
  }
}

function wrapRTCDataChannel(dc: RTCDataChannel): KerbcamDataChannel {
  let onOpen: (() => void) | null = null;
  let onMessage: ((raw: string) => void) | null = null;
  let onClose: (() => void) | null = null;
  dc.onopen = () => onOpen?.();
  dc.onclose = () => onClose?.();
  dc.onmessage = (ev) => {
    if (typeof ev.data === "string") onMessage?.(ev.data);
  };
  return {
    send: (s) => {
      dc.send(s);
    },
    onOpen: (h) => {
      onOpen = h;
    },
    onMessage: (h) => {
      onMessage = h;
    },
    onClose: (h) => {
      onClose = h;
    },
  };
}

export class BrowserRTCTransport implements KerbcamTransport {
  createPeer(iceServers: RTCIceServer[]): KerbcamPeer {
    const pc = new RTCPeerConnection({ iceServers });
    let trackIdx = 0;
    let onTrack: ((track: MediaStreamTrack, idx: number) => void) | null = null;
    let onStateChange: ((state: KerbcamConnectionState) => void) | null = null;
    pc.ontrack = (ev) => {
      onTrack?.(ev.track, trackIdx++);
    };
    pc.onconnectionstatechange = () => {
      onStateChange?.(mapRTCState(pc.connectionState));
    };
    return {
      addRecvOnlyTransceiver: () => {
        pc.addTransceiver("video", { direction: "recvonly" });
      },
      createDataChannel: (label) =>
        wrapRTCDataChannel(pc.createDataChannel(label)),
      onTrack: (h) => {
        onTrack = h;
      },
      onStateChange: (h) => {
        onStateChange = h;
      },
      createOffer: async () => {
        const offer = await pc.createOffer();
        return offer.sdp ?? "";
      },
      setLocalDescription: async (sdp) => {
        await pc.setLocalDescription({ type: "offer", sdp });
      },
      setRemoteAnswer: async (sdp) => {
        await pc.setRemoteDescription({ type: "answer", sdp });
      },
      waitForIceComplete: () =>
        new Promise<void>((resolve) => {
          if (pc.iceGatheringState === "complete") return resolve();
          const check = () => {
            if (pc.iceGatheringState === "complete") {
              pc.removeEventListener("icegatheringstatechange", check);
              resolve();
            }
          };
          pc.addEventListener("icegatheringstatechange", check);
        }),
      localSdp: () => pc.localDescription?.sdp ?? "",
      close: () => {
        pc.close();
      },
    };
  }
}

// ---------------------------------------------------------------------------
// KeepaliveTransport — wraps any inner KerbcamTransport and intercepts
// ping messages on the data channel, responding with pong automatically.
// Non-ping messages pass through to the SDK handler unchanged.
//
// TODO: ping→pong handling belongs in @jonpepler/kerbcam itself — move here
// once the SDK supports a reconnect policy hook.
// ---------------------------------------------------------------------------

export class KeepaliveTransport implements KerbcamTransport {
  constructor(
    private readonly inner: KerbcamTransport,
    private readonly onPingReceived: (
      sendFn: (msg: ClientMessage) => void,
    ) => void,
  ) {}

  createPeer(iceServers: RTCIceServer[]): KerbcamPeer {
    const peer = this.inner.createPeer(iceServers);
    const wrapChannel = (ch: KerbcamDataChannel): KerbcamDataChannel => {
      let sdkHandler: ((raw: string) => void) | null = null;

      // Install our ping filter on the inner channel immediately so
      // the test's captured.onMessage points at this filter, not the SDK.
      ch.onMessage((raw: string) => {
        let msg: { type?: string } | null = null;
        try {
          msg = JSON.parse(raw) as { type?: string };
        } catch {
          sdkHandler?.(raw);
          return;
        }
        if (msg?.type === "ping") {
          this.onPingReceived((pongMsg) => {
            ch.send(JSON.stringify(pongMsg));
          });
          // Do NOT forward ping to SDK handler.
          return;
        }
        sdkHandler?.(raw);
      });

      return {
        send: (s) => ch.send(s),
        onOpen: (h) => ch.onOpen(h),
        onMessage: (h) => {
          sdkHandler = h;
        },
        onClose: (h) => ch.onClose(h),
      };
    };

    return {
      addRecvOnlyTransceiver: () => peer.addRecvOnlyTransceiver(),
      createDataChannel: (label) => wrapChannel(peer.createDataChannel(label)),
      onTrack: (h) => peer.onTrack(h),
      onStateChange: (h) => peer.onStateChange(h),
      createOffer: async () => peer.createOffer(),
      setLocalDescription: async (sdp) => peer.setLocalDescription(sdp),
      setRemoteAnswer: async (sdp) => peer.setRemoteAnswer(sdp),
      waitForIceComplete: async () => peer.waitForIceComplete(),
      localSdp: () => peer.localSdp(),
      close: () => peer.close(),
    };
  }
}

// ---------------------------------------------------------------------------
// KerbcamDataSource
// ---------------------------------------------------------------------------

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
  private baseTransport: KerbcamTransport | undefined;
  private client: KerbcamClient;
  private clientUnsubs: Array<() => void> = [];
  // TURN creds fetched from the relay's /ice-config; empty until the first
  // connect resolves them (and stays empty when no relay is reachable, in
  // which case the SDK uses its STUN-only default).
  private iceServers: RTCIceServer[] = [];
  private statusListeners = new Set<(status: DataSourceStatus) => void>();
  private camerasKeySubs = new Set<(value: unknown) => void>();

  private pingWatchdog: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private reconnectEnabled = false;

  constructor(config?: KerbcamConfig, transport?: KerbcamTransport) {
    this.cfg = config ?? loadConfig();
    this.baseTransport = transport;
    this.client = this.buildClient();
  }

  /** Underlying client (hooks reach in directly via this). */
  getClient(): KerbcamClient {
    return this.client;
  }

  // -- DataSource contract --

  async connect(): Promise<void> {
    this.reconnectEnabled = true;
    await this.applyRelayIce();
    try {
      await this.client.connect();
    } catch (err) {
      this.scheduleReconnect();
      throw err;
    }
  }

  disconnect(): void {
    this.reconnectEnabled = false;
    this.clearTimers();
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
      case "set-pan": {
        const [yaw, pitch] = rest;
        if (!yaw || !pitch) return;
        await cam.setPan(Number(yaw), Number(pitch));
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
    const wasEnabled = this.reconnectEnabled;
    this.cfg = {
      host: typeof config.host === "string" ? config.host : this.cfg.host,
      port:
        typeof config.port === "number"
          ? config.port
          : Number(config.port) || this.cfg.port,
    };
    persistConfig(this.cfg);
    this.reconnectEnabled = false;
    this.teardownClient();
    this.client = this.buildClient();
    if (wasEnabled) void this.connect();
  }

  // -- private --

  private buildClient(): KerbcamClient {
    const keepaliveTransport = new KeepaliveTransport(
      this.baseTransport ?? new BrowserRTCTransport(),
      (sendFn) => {
        sendFn({ type: "pong" });
        this.startWatchdog();
      },
    );

    const client = new KerbcamClient(
      {
        host: this.cfg.host,
        port: this.cfg.port,
        // Pass the relay's TURN servers when we have them; `undefined` lets
        // the SDK apply its STUN-only default (LAN / no relay).
        iceServers: this.iceServers.length > 0 ? this.iceServers : undefined,
      },
      keepaliveTransport,
    );
    this.clientUnsubs.push(
      client.on("state-change", (s) => {
        const status = mapStatus(s);
        this.setStatus(status);
        if (s === "connected") {
          this.reconnectAttempts = 0;
          if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          this.startWatchdog();
        } else if (s === "failed" && this.reconnectEnabled) {
          this.scheduleReconnect();
        }
      }),
      client.on("cameras-change", (cams) => {
        KERBCAM_CAMERAS_BUDGET.record();
        this.camerasKeySubs.forEach((cb) => {
          cb(cams);
        });
      }),
    );
    return client;
  }

  /**
   * Fetch the relay's TURN creds and, if any came back, rebuild the client to
   * use them. A no-op (keeps the current STUN-default client) when the relay
   * is unreachable, so LAN streaming is unaffected. Run on every
   * connect/reconnect because the relay rotates its secret per restart, so a
   * reconnect after a relay bounce needs to re-fetch the fresh credentials.
   */
  private async applyRelayIce(): Promise<void> {
    const ice = await fetchRelayIceServers();
    if (ice.length === 0) return;
    this.iceServers = ice;
    this.teardownClient();
    this.client = this.buildClient();
  }

  private teardownClient(): void {
    this.clearTimers();
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

  private clearTimers(): void {
    if (this.pingWatchdog !== null) {
      clearTimeout(this.pingWatchdog);
      this.pingWatchdog = null;
    }
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startWatchdog(): void {
    if (this.pingWatchdog !== null) {
      clearTimeout(this.pingWatchdog);
      this.pingWatchdog = null;
    }
    this.pingWatchdog = setTimeout(() => {
      this.pingWatchdog = null;
      if (this.reconnectEnabled) {
        void this.attemptReconnect();
      }
    }, PING_WATCHDOG_MS);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempts,
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.reconnectEnabled) {
        void this.attemptReconnect();
      }
    }, delay);
  }

  private async attemptReconnect(): Promise<void> {
    await this.applyRelayIce();
    try {
      await this.client.connect();
    } catch {
      this.scheduleReconnect();
    }
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
