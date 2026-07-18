import type {
  ConfigField,
  DataKey,
  DataSource,
  DataSourceStatus,
} from "@ksp-gonogo/core";
import {
  GAME_HOST_KEY,
  getGameHost,
  PerfBudget,
  registerDataSource,
  registerUplinkHandle,
  subscribeSetting,
} from "@ksp-gonogo/core";
import {
  type CameraState,
  type ClientMessage,
  KerbcastClient,
  type KerbcastConnectionState,
  type KerbcastDataChannel,
  type KerbcastPeer,
  type KerbcastTransport,
  type Layer,
} from "@ksp-gonogo/kerbcast";
import { logger } from "@ksp-gonogo/logger";

/**
 * gonogo `DataSource` wrapper around `KerbcastClient`. Surfaces the
 * sidecar connection in the Data Sources widget and re-exposes the
 * cached camera registry under the `kerbcast.cameras` data key.
 *
 * Video frames bind via {@link useKerbcastStream} (returns a
 * `MediaStream` directly — not a value channel) and the camera list
 * via {@link useKerbcastCameras}, both of which reach into the
 * underlying client via {@link getClient}.
 */

export interface KerbcastConfig extends Record<string, unknown> {
  port: number;
}

/**
 * Station-side broker. A station can't reach the sidecar's address, so instead
 * of the default localhost handshake the data source relays the WebRTC
 * offer→answer through the main screen and sources its TURN creds from the
 * host's relay broadcast (NOT a localhost `/ice-config` fetch). Media still
 * flows station↔sidecar directly off the answer's ICE candidates — nothing
 * about the video crosses PeerJS. The app builds this from `PeerClientService`.
 */
export interface KerbcastBroker {
  /** Relay one offer to the sidecar via the host; resolve with the answer. */
  negotiate(offer: {
    sdp: string;
    cameras: number[];
    slots?: number;
  }): Promise<{ sdp: string; cameras: number[] }>;
  /** Current relay TURN creds (empty until the host has broadcast some). */
  iceServers(): RTCIceServer[];
  /** Notified when the host broadcasts fresh relay TURN creds. */
  onIceServersChange(cb: (servers: RTCIceServer[]) => void): () => void;
}

const DEFAULT_CONFIG: KerbcastConfig = { port: 8088 };

const STORAGE_KEY = "gonogo.datasource.kerbcast";

const PING_WATCHDOG_MS = 15_000;
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

// Dynamic slot-pool size negotiated up front. Each displayed camera widget
// binds a free slot at runtime via subscribeCamera(); the spare slots let the
// operator switch cameras with no renegotiation. The Deck only renders/encodes
// the cameras actually bound to a slot, so the pool size is a cap on
// simultaneous on-screen feeds, not a steady-state cost.
const SLOT_COUNT = 6;

// The kerbcast WebRTC stream needs the same TURN relay the PeerJS host uses
// for non-LAN delivery. The gonogo relay bundles coturn and serves the
// rotated creds at `/ice-config` (see packages/relay). We fetch them here and
// hand them to the SDK client; with no relay reachable we fall back to the
// SDK's STUN-only default so kerbcast-on-LAN keeps working untouched. Mirrors
// the host's app/peer/iceServers.ts (kerbcast can't import across that package
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

const KERBCAST_CAMERAS_BUDGET = new PerfBudget({
  name: "KerbcastDataSource cameras updates/sec",
  threshold: 50,
  windowMs: 1000,
  unit: "updates",
});

function loadConfig(): KerbcastConfig {
  if (typeof localStorage === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<KerbcastConfig>;
    return {
      port: typeof parsed.port === "number" ? parsed.port : DEFAULT_CONFIG.port,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function persistConfig(cfg: KerbcastConfig): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    /* localStorage full / disabled — config still applies in-memory */
  }
}

// ---------------------------------------------------------------------------
// BrowserRTCTransport — mirrors the SDK's private BrowserKerbcastTransport.
// Copied from @ksp-gonogo/kerbcast/dist/client.js so KeepaliveTransport can
// wrap it without depending on the SDK's unexported class.
// ---------------------------------------------------------------------------

function mapRTCState(state: RTCPeerConnectionState): KerbcastConnectionState {
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

function wrapRTCDataChannel(dc: RTCDataChannel): KerbcastDataChannel {
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

export class BrowserRTCTransport implements KerbcastTransport {
  /**
   * `RTCRtpReceiver` for every track this transport has ever delivered via
   * `ontrack`, keyed by the exact `MediaStreamTrack` object reference —
   * encoded-transform video-delay work, 2026-07-16 (see
   * `local_docs/reports/encoded-video-delay-report.md`'s reconciliation:
   * the SDK's own `KerbcastClient` wraps this SAME track reference into
   * `cam.mediaStream` via `new MediaStream([track])`, never cloning it —
   * confirmed against the installed `@ksp-gonogo/kerbcast` dist — so a
   * `WeakMap` keyed by that reference is an exact, leak-free correlation
   * from a `MediaStream` handed to a widget back to the `RTCRtpReceiver`
   * needed to attach `receiver.transform = new RTCRtpScriptTransform(...)`.
   * `WeakMap` rather than a `Map`: entries fall out on their own once a
   * track is GC'd (camera switch / teardown), no manual eviction needed.
   */
  private readonly receiversByTrack = new WeakMap<
    MediaStreamTrack,
    RTCRtpReceiver
  >();

  /** Look up the `RTCRtpReceiver` for a track this transport delivered.
   *  `undefined` for a track from anywhere else (a different transport
   *  instance, a test fixture, or a track this transport never saw). */
  getReceiverForTrack(track: MediaStreamTrack): RTCRtpReceiver | undefined {
    return this.receiversByTrack.get(track);
  }

  createPeer(iceServers: RTCIceServer[]): KerbcastPeer {
    const pc = new RTCPeerConnection({ iceServers });
    let trackIdx = 0;
    let onTrack:
      | ((track: MediaStreamTrack, idx: number, mid: string) => void)
      | null = null;
    let onStateChange: ((state: KerbcastConnectionState) => void) | null = null;
    pc.ontrack = (ev) => {
      this.receiversByTrack.set(ev.track, ev.receiver);
      // mid is the stable transceiver id the sidecar keys SlotMap on (set by
      // the time ontrack fires, post-answer); the SDK routes dynamic-mode
      // tracks by it.
      onTrack?.(ev.track, trackIdx++, ev.transceiver.mid ?? "");
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
// KeepaliveTransport — wraps any inner KerbcastTransport and intercepts
// ping messages on the data channel, responding with pong automatically.
// Non-ping messages pass through to the SDK handler unchanged.
//
// TODO: ping→pong handling belongs in @ksp-gonogo/kerbcast itself — move here
// once the SDK supports a reconnect policy hook.
// ---------------------------------------------------------------------------

export class KeepaliveTransport implements KerbcastTransport {
  constructor(
    private readonly inner: KerbcastTransport,
    private readonly onPingReceived: (
      sendFn: (msg: ClientMessage) => void,
    ) => void,
  ) {}

  createPeer(iceServers: RTCIceServer[]): KerbcastPeer {
    const peer = this.inner.createPeer(iceServers);
    const wrapChannel = (ch: KerbcastDataChannel): KerbcastDataChannel => {
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
// KerbcastDataSource
// ---------------------------------------------------------------------------

export class KerbcastDataSource implements DataSource<KerbcastConfig> {
  id = "kerbcast";
  name = "Kerbcast";
  status: DataSourceStatus = "disconnected";
  /**
   * Kerbcast streams are independent of CommNet — losing the in-game
   * antenna doesn't affect the WebRTC connection to the sidecar.
   * Camera widgets visualise signal loss via `set-degrade` instead.
   */
  affectedBySignalLoss = false;

  private cfg: KerbcastConfig;
  private baseTransport: KerbcastTransport | undefined;
  /** The concrete `BrowserRTCTransport` `buildClient()` actually wired up
   *  (main-screen AND station/broker mode both use it — see that method).
   *  `undefined` when a test supplied a `baseTransport` that isn't one
   *  (e.g. a mock) — `getReceiverForStream` degrades to `undefined` then,
   *  matching "can't attach the encoded transform here" rather than
   *  throwing. Encoded-transform video-delay work, 2026-07-16. */
  private rtcTransport: BrowserRTCTransport | undefined;
  private client: KerbcastClient;
  private clientUnsubs: Array<() => void> = [];
  /**
   * Monotonic id stamped on every `KerbcastClient` we build, so the
   * `kerbcast:clock` diagnostic can tell whether the instance that receives
   * `settings-state` (this data source's connected client) is the same one
   * `CameraFeed`'s provider holds and `useKerbcastClock` reads. A mismatch
   * means a reconnect/TURN rebuild orphaned the clock onto a dead instance.
   */
  private static clientInstanceSeq = 0;
  // TURN creds: on the main screen, fetched from the relay's /ice-config; on a
  // brokered station, pushed in from the host's relay broadcast. Empty until
  // resolved (SDK then uses its STUN-only default).
  private iceServers: RTCIceServer[] = [];
  // TURN-on-demand, main-screen path only. The main→sidecar leg is LAN (Steam
  // Deck ↔ MacBook, same WiFi), so it connects on host/STUN candidates and
  // never needs a relay — yet fetching /ice-config up front made every camera
  // connection *gather* a TURN relay candidate it then discarded, burning a
  // coturn relay port per feed. So we stay STUN-only until a connection attempt
  // has actually failed, then pull the relay's TURN creds and let the reconnect
  // pick them up (see connect / attemptReconnect / the "failed" state handler).
  // Worst case is one failed STUN attempt before we fall back to today's
  // always-TURN behaviour; the common LAN case never allocates a relay port.
  //
  // The asymmetry with the data channel's TURN-on-demand (which escalates on a
  // short timer) is deliberate, not an oversight: that path spans the internet,
  // so fast escalation earns its keep; this path is LAN, where a STUN-only
  // attempt should *succeed*, and waiting for a genuine failure avoids tearing
  // down a slow-but-valid local connect. The remote-camera case rides the
  // broker/station path (attachBroker), which takes TURN from the host
  // broadcast and is untouched by this flag.
  private turnEscalated = false;
  // Set on a station via attachBroker(); switches connect() off the localhost
  // /offer + /ice-config path and onto the host-relayed handshake.
  private broker: KerbcastBroker | undefined;
  private brokerIceUnsub: (() => void) | undefined;
  private statusListeners = new Set<(status: DataSourceStatus) => void>();
  private camerasKeySubs = new Set<(value: unknown) => void>();
  // flightId -> refcount of widgets currently displaying that camera. Drives
  // the dynamic slot subscription: 0->1 binds a slot, 1->0 frees it. Passed as
  // the initial set on (re)connect so a reconnect re-binds whatever's on screen
  // without a client-side round-trip (the sidecar pushes the SlotMaps on Hello).
  private desiredSubs = new Map<number, number>();

  /* Listeners notified when the throttle state changes via settings-change. */
  private throttleListeners = new Set<(enabled: boolean) => void>();

  private pingWatchdog: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private reconnectEnabled = false;
  private unsubGameHost: (() => void) | null = null;

  constructor(config?: KerbcastConfig, transport?: KerbcastTransport) {
    this.cfg = config ?? loadConfig();
    this.baseTransport = transport;
    this.client = this.buildClient();
    this.unsubGameHost = subscribeSetting(GAME_HOST_KEY, () => {
      // Host moved — same effect as a reconfigure: rebuild the client against
      // the new host, preserving the connected/disconnected state.
      this.applyConfig({ ...this.cfg });
    });
  }

  /** Underlying client (hooks reach in directly via this). */
  getClient(): KerbcastClient {
    return this.client;
  }

  /**
   * The `RTCRtpReceiver` behind a camera's `MediaStream` — the encoded
   * transform's attach point (`receiver.transform = new
   * RTCRtpScriptTransform(...)`, `encodedFrameDelay.ts`). Correlates via
   * the stream's first video track's object identity against the registry
   * `BrowserRTCTransport` populated in `ontrack` (see that class's doc for
   * why this is exact, not fuzzy matching). Returns `undefined` when there
   * is no video track, the current transport isn't a `BrowserRTCTransport`
   * (a test-injected mock), or the track wasn't delivered by THIS
   * transport instance (a stale reference from a torn-down connection) —
   * every case degrades to "encoded backend unavailable here", never a
   * throw, matching every other backend-selection guard in this pipeline.
   */
  getReceiverForStream(stream: MediaStream): RTCRtpReceiver | undefined {
    const track = stream.getVideoTracks()[0];
    if (!track) return undefined;
    return this.rtcTransport?.getReceiverForTrack(track);
  }

  /* Current plugin-reported throttle state. False until the first SettingsState arrives. */
  getThrottleMainScreen(): boolean {
    return this.client.throttleMainScreen;
  }

  /* Subscribe to throttle state changes. Returns an unsubscribe function. */
  onThrottleChange(cb: (enabled: boolean) => void): () => void {
    this.throttleListeners.add(cb);
    return () => this.throttleListeners.delete(cb);
  }

  /* Send a set-throttle-main-screen command to the sidecar. */
  async setThrottleMainScreen(enabled: boolean): Promise<void> {
    await this.client.setThrottleMainScreen(enabled);
  }

  /**
   * Dev diagnostic: a JSON-serialisable snapshot of the stream-routing state,
   * for chasing black-feed / no-track issues. Reaches into the SDK client's
   * internals (private — read-only, best-effort).
   */
  debugDump(): unknown {
    const c = this.client as unknown as {
      dynamicMode?: boolean;
      cameras?: Array<{ flightId: number }>;
      trackByMid?: Map<string, MediaStreamTrack>;
      flightByMid?: Map<string, number>;
      handles?: Map<number, { mediaStream?: MediaStream | null }>;
      peer?: unknown;
    };
    const trackInfo = (t?: MediaStreamTrack | null) =>
      t
        ? { readyState: t.readyState, muted: t.muted, enabled: t.enabled }
        : null;
    return {
      status: this.status,
      reconnectEnabled: this.reconnectEnabled,
      brokered: !!this.broker,
      desiredSubs: [...this.desiredSubs.entries()],
      dynamicMode: c.dynamicMode ?? null,
      cameras: c.cameras?.map((cam) => cam.flightId) ?? null,
      slotTracks: c.trackByMid
        ? [...c.trackByMid.entries()].map(([mid, t]) => [mid, trackInfo(t)])
        : null,
      slotBindings: c.flightByMid ? [...c.flightByMid.entries()] : null,
      handles: c.handles
        ? [...c.handles.entries()].map(([fid, h]) => [
            fid,
            {
              hasStream: !!h.mediaStream,
              tracks: h.mediaStream?.getTracks().map(trackInfo) ?? [],
            },
          ])
        : null,
    };
  }

  // -- DataSource contract --

  async connect(): Promise<void> {
    this.reconnectEnabled = true;
    // Brokered (station) mode gets its TURN creds from the host's relay
    // broadcast via attachBroker(); the localhost /ice-config fetch would hit the
    // station's own loopback, so skip it. On the main screen we stay STUN-only
    // until a failed attempt has flipped `turnEscalated` (see the field comment).
    if (!this.broker && this.turnEscalated) await this.applyRelayIce();
    try {
      await this.client.connect([...this.desiredSubs.keys()], {
        slots: SLOT_COUNT,
      });
    } catch (err) {
      this.turnEscalated = true;
      this.scheduleReconnect();
      throw err;
    }
  }

  /**
   * Open the connection if nothing has yet — the lazy entry point for a mounted
   * camera widget that needs the camera list + slot pool *before* it can pick a
   * specific camera to display. Without this a brokered (station) source
   * deadlocks: the widget only subscribes once it has a flightId, but the
   * flightId comes from the camera list, which only arrives after connecting.
   * A no-op once connecting/connected; on the main screen the data-source
   * manager connects eagerly, so this just returns.
   */
  ensureConnected(): void {
    if (!this.reconnectEnabled) {
      void this.connect().catch(() => {});
    }
  }

  /**
   * Bind a camera to a slot for display (dynamic-mode subscription).
   * Refcounted: the first widget to show `flightId` sends `subscribe` to the
   * sidecar — allocating a slot and starting render/encode for that camera —
   * and the last one to stop showing it frees the slot. Called by
   * {@link useKerbcastStream} on mount/unmount.
   *
   * Safe to call while disconnected: the camera is recorded and bound via the
   * initial set on the next connect, so a widget that mounts before the sidecar
   * is up still gets its feed once the connection lands.
   *
   * On a brokered (station) source this also drives the **lazy connect** — the
   * source stays disconnected until the first camera widget asks for a stream,
   * so a station with no camera widget never opens a sidecar peer.
   */
  subscribeCamera(flightId: number): void {
    const count = this.desiredSubs.get(flightId) ?? 0;
    this.desiredSubs.set(flightId, count + 1);
    if (this.status === "connected") {
      if (count === 0) {
        void this.client.subscribe(flightId).catch(() => {
          /* channel raced closed — re-bound on next connect via initial set */
        });
      }
      return;
    }
    // Not connected. A brokered station source isn't eager-connected anywhere,
    // so the first widget that wants a stream triggers the connect; the camera
    // binds via the initial set (desiredSubs). The main screen connects all
    // sources up front (no broker set), so this stays a no-op there.
    if (this.broker && !this.reconnectEnabled) {
      void this.connect().catch(() => {});
    }
  }

  /** Release a display reference taken by {@link subscribeCamera}. */
  unsubscribeCamera(flightId: number): void {
    const count = this.desiredSubs.get(flightId) ?? 0;
    if (count === 0) return;
    if (count > 1) {
      this.desiredSubs.set(flightId, count - 1);
      return;
    }
    this.desiredSubs.delete(flightId);
    if (this.status === "connected") {
      void this.client.unsubscribe(flightId).catch(() => {
        /* already tearing down */
      });
    }
  }

  /**
   * Main-screen half of the station broker: forward a station's WebRTC offer to
   * the sidecar's HTTP `/offer` (only the main screen can reach the sidecar's
   * address) and return the answer. Signaling only — the answer's ICE
   * candidates let the station's PeerConnection reach the sidecar directly for
   * media, so video frames never cross PeerJS. Mirrors the SDK's internal
   * `httpNegotiate`; kept here (not on the client) because the host relays on
   * behalf of a remote peer, independent of its own connection.
   */
  async relayOffer(offer: {
    sdp: string;
    cameras: number[];
    slots?: number;
  }): Promise<{ sdp: string; cameras: number[] }> {
    const res = await fetch(`http://${getGameHost()}:${this.cfg.port}/offer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(offer),
    });
    if (!res.ok) {
      throw new Error(`kerbcast /offer returned ${res.status}`);
    }
    return (await res.json()) as { sdp: string; cameras: number[] };
  }

  /**
   * Switch this source into station/brokered mode: route the WebRTC handshake
   * through the host (no sidecar address needed) and take TURN creds from the
   * host's relay broadcast instead of a localhost `/ice-config` fetch. The app
   * calls this on a station once its `PeerClientService` is up. Rebuilds the
   * client so the camera hooks rebind to the brokered instance; if a connection
   * was already live it reconnects through the broker.
   *
   * (Named `attachBroker`, not `useBroker`, to avoid the React-hook naming
   * heuristic — it's a plain method, safe to call outside render.)
   */
  attachBroker(broker: KerbcastBroker): void {
    this.broker = broker;
    this.iceServers = broker.iceServers();
    this.brokerIceUnsub?.();
    this.brokerIceUnsub = broker.onIceServersChange((servers) => {
      // Mutate the live client's cfg in place (same reasoning as applyRelayIce)
      // so the next connect/reconnect picks up rotated creds without orphaning
      // the camera hooks bound to this client instance.
      this.iceServers = servers;
      (
        this.client as unknown as { cfg: { iceServers?: RTCIceServer[] } }
      ).cfg.iceServers = servers.length > 0 ? servers : undefined;
    });
    const wasEnabled = this.reconnectEnabled;
    this.teardownClient();
    this.client = this.buildClient();
    // Connect through the broker if a connection was already live, OR if a
    // camera widget already wants a stream — it may have mounted and subscribed
    // before this ran (React runs child effects before the parent's). Swallow
    // the initial rejection (the reconnect loop retries); without this an
    // immediate WebRTC failure would surface as an unhandled rejection.
    if (wasEnabled || this.desiredSubs.size > 0) {
      void this.connect().catch(() => {});
    }
  }

  disconnect(): void {
    this.reconnectEnabled = false;
    this.turnEscalated = false;
    this.clearTimers();
    this.client.disconnect();
    this.unsubGameHost?.();
  }

  schema(): DataKey[] {
    return [{ key: "kerbcast.cameras" }];
  }

  subscribe(key: string, cb: (value: unknown) => void): () => void {
    if (key !== "kerbcast.cameras") return () => {};
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
      case "set-pan-rate": {
        // Velocity, not position — "0" is a valid (stop) value, so guard on
        // undefined rather than falsiness.
        const [yawRate, pitchRate] = rest;
        if (yawRate === undefined || pitchRate === undefined) return;
        await cam.setPanRate(Number(yawRate), Number(pitchRate));
        break;
      }
      case "set-zoom-rate": {
        const [rate] = rest;
        if (rate === undefined) return;
        await cam.setZoomRate(Number(rate));
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
        key: "port",
        label: "Sidecar port",
        type: "number",
        placeholder: "8088",
      },
    ];
  }

  getConfig(): KerbcastConfig {
    return { ...this.cfg };
  }

  configure(config: Record<string, unknown>): void {
    const next: KerbcastConfig = {
      port:
        typeof config.port === "number"
          ? config.port
          : Number(config.port) || this.cfg.port,
    };
    persistConfig(next);
    this.applyConfig(next);
  }

  private applyConfig(next: KerbcastConfig): void {
    const wasEnabled = this.reconnectEnabled;
    this.cfg = next;
    this.reconnectEnabled = false;
    // A host/port change is a fresh start — re-probe STUN-only against the new
    // sidecar rather than carrying a stale escalation across the reconfigure.
    this.turnEscalated = false;
    this.teardownClient();
    this.client = this.buildClient();
    if (wasEnabled) void this.connect().catch(() => {});
  }

  // -- private --

  private buildClient(): KerbcastClient {
    // Same transport instance for main-screen AND station/broker mode —
    // only `negotiate` below differs by mode; the RTCPeerConnection/ontrack
    // wiring (and therefore the receiver registry) is identical either way.
    const innerTransport = this.baseTransport ?? new BrowserRTCTransport();
    this.rtcTransport =
      innerTransport instanceof BrowserRTCTransport
        ? innerTransport
        : undefined;
    const keepaliveTransport = new KeepaliveTransport(
      innerTransport,
      (sendFn) => {
        sendFn({ type: "pong" });
        this.startWatchdog();
      },
    );

    // Capture the broker locally so the negotiate closure is stable across a
    // later rebuild and doesn't re-read `this.broker` after a teardown.
    const broker = this.broker;
    const client = new KerbcastClient(
      {
        host: getGameHost(),
        port: this.cfg.port,
        // Pass the relay's TURN servers when we have them; `undefined` lets
        // the SDK apply its STUN-only default (LAN / no relay).
        iceServers: this.iceServers.length > 0 ? this.iceServers : undefined,
        // Brokered (station) mode: route the offer→answer through the host
        // instead of POSTing localhost:port/offer. Default (main) mode leaves
        // this undefined so the SDK uses its built-in httpNegotiate.
        negotiate: broker ? (offer) => broker.negotiate(offer) : undefined,
      },
      keepaliveTransport,
    );
    const instanceId = ++KerbcastDataSource.clientInstanceSeq;
    (client as unknown as { __kcInstanceId?: number }).__kcInstanceId =
      instanceId;
    logger.tag("kerbcast:clock").debug("built KerbcastClient", { instanceId });
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
          // A STUN-only attempt that reached ICE "failed" couldn't traverse —
          // escalate so the reconnect fetches the relay's TURN creds.
          this.turnEscalated = true;
          this.scheduleReconnect();
        }
      }),
      client.on("cameras-change", (cams) => {
        KERBCAST_CAMERAS_BUDGET.record();
        this.camerasKeySubs.forEach((cb) => {
          cb(cams);
        });
      }),
      client.on("settings-change", (payload) => {
        // Diagnostic: is THIS connected instance receiving + applying the
        // ~1Hz capture clock? Pairs with the `CameraFeed`/consumer-side
        // `kerbcast:clock` logs (same `instanceId`) to localise a null
        // `useKerbcastClock().captureUt` to either "clock never reaches the
        // connected client" or "a different client instance is read".
        logger
          .tag("kerbcast:clock")
          .debug("settings-change on connected client", {
            instanceId,
            payloadCaptureUt: payload.captureUt ?? null,
            clockCaptureUt: client.clock.captureUt,
          });
        this.throttleListeners.forEach((cb) => {
          cb(payload.throttleMainScreen);
        });
      }),
    );
    return client;
  }

  /**
   * Fetch the relay's TURN creds and, if any came back, set them on the
   * client. A no-op (keeps the SDK's STUN default) when the relay is
   * unreachable, so LAN streaming is unaffected. Run on every
   * connect/reconnect because the relay rotates its secret per restart, so a
   * reconnect after a relay bounce needs the fresh credentials.
   *
   * Crucially this sets the creds on the *existing* client rather than
   * rebuilding it: `KerbcastClient.connect()` re-reads `cfg.iceServers` every
   * time it creates a peer (so the connect that immediately follows, and each
   * reconnect, picks the mutation up), and swapping the instance instead would
   * orphan the camera hooks. `useKerbcastStream` / `useKerbcastCameras` capture
   * `getClient()` once and bind to its events; a rebuilt client would fire
   * onto a dead instance — a black camera on exactly the TURN path this
   * targets. `cfg` is private in the SDK, but we own kerbcast and the
   * "threads TURN servers" test drives the real client, so a field rename
   * reddens CI rather than silently regressing.
   */
  private async applyRelayIce(): Promise<void> {
    const ice = await fetchRelayIceServers();
    if (ice.length === 0) return;
    this.iceServers = ice;
    (
      this.client as unknown as { cfg: { iceServers?: RTCIceServer[] } }
    ).cfg.iceServers = ice;
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
    if (!this.broker && this.turnEscalated) await this.applyRelayIce();
    try {
      await this.client.connect([...this.desiredSubs.keys()], {
        slots: SLOT_COUNT,
      });
    } catch {
      this.turnEscalated = true;
      this.scheduleReconnect();
    }
  }
}

function mapStatus(s: KerbcastConnectionState): DataSourceStatus {
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

export const kerbcastSource = new KerbcastDataSource();
registerDataSource(kerbcastSource);

// Host-side relay handle for station peer-relayed calls (see
// PeerHostService.handleUplinkRelay / PeerClientDataSource.relay). Delegates
// to the existing relayOffer() — the handle is just its dispatch entry
// point, relayOffer itself is unchanged.
registerUplinkHandle("kerbcast", {
  async relay(method: string, args: unknown): Promise<unknown> {
    if (method === "negotiate") {
      return kerbcastSource.relayOffer(
        args as { sdp: string; cameras: number[]; slots?: number },
      );
    }
    throw new Error(`kerbcast relay handle: unknown method "${method}"`);
  },
});

// Dev-only debug handle: inspect the live stream-routing state from the console
// (or via automation) to diagnose black-feed / no-track issues.
//   __kerbcast.debugDump()  →  status, desiredSubs, slot routing, per-camera tracks
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
  (globalThis as unknown as { __kerbcast?: KerbcastDataSource }).__kerbcast =
    kerbcastSource;
}

export type { CameraState };
