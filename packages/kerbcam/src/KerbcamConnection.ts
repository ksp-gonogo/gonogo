import type {
  CameraState,
  ClientMessage,
  ServerMessage,
} from "@jonpepler/kerbcam";
import { logger } from "@gonogo/logger";

/**
 * Receiver-side mirror of the kerbcam sidecar wire contract.
 *
 * The class owns:
 *
 *   - a single `RTCPeerConnection` to the sidecar's HTTP signalling
 *     endpoint
 *   - the `kerbcam-control` data channel for bidirectional protocol
 *     messages
 *   - one `MediaStream` per subscribed camera (keyed by KSP flight ID)
 *   - a cached camera registry kept in sync with the sidecar's
 *     `camera-snapshot` / `camera-state-changed` pushes
 *
 * The data-source layer ({@link KerbcamDataSource}) wraps this with
 * the gonogo `DataSource` shape so the connection state surfaces in
 * the Data Sources widget. Widgets consume the per-camera state via
 * hooks ({@link useKerbcamCameras}, {@link useKerbcamStream}) rather
 * than this class directly.
 */

const log = logger.tag("kerbcam");

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "failed";

export interface KerbcamConnectionConfig {
  /** Host where the kerbcam sidecar's HTTP signalling lives. */
  host: string;
  /** Port matching the sidecar's `--http-bind` setting. */
  port: number;
}

export interface DiscoveredCamera {
  flightId: number;
  partTitle: string;
  cameraName: string;
  vesselName: string;
  maxWidth: number;
  maxHeight: number;
}

/**
 * Minimal transport abstraction so the WebRTC pieces stay swappable
 * for tests. Production uses {@link BrowserWebRtcTransport} which
 * delegates straight to the browser's `RTCPeerConnection`; unit tests
 * substitute an in-memory implementation that drives the same state
 * transitions without needing a real datagram session.
 */
export interface WebRtcTransport {
  createPeer(iceServers: RTCIceServer[]): WebRtcPeer;
}

export interface WebRtcPeer {
  addTransceiver(direction: "recvonly"): void;
  createDataChannel(label: string): WebRtcDataChannel;
  setOntrack(handler: (track: MediaStreamTrack, idx: number) => void): void;
  setOnConnectionStateChange(handler: (state: ConnectionStatus) => void): void;
  createOffer(): Promise<string>;
  setLocalDescription(sdp: string): Promise<void>;
  setRemoteAnswer(sdp: string): Promise<void>;
  waitForIceComplete(): Promise<void>;
  localSdp(): string;
  close(): void;
}

export interface WebRtcDataChannel {
  send(payload: string): void;
  setOnOpen(handler: () => void): void;
  setOnMessage(handler: (raw: string) => void): void;
  setOnClose(handler: () => void): void;
}

/**
 * Production transport: defers to `RTCPeerConnection` directly. Kept
 * small and dependency-free so the test transport can stay equally
 * simple.
 */
export class BrowserWebRtcTransport implements WebRtcTransport {
  createPeer(iceServers: RTCIceServer[]): WebRtcPeer {
    const pc = new RTCPeerConnection({ iceServers });
    let trackIdx = 0;
    let onTrack: ((t: MediaStreamTrack, idx: number) => void) | null = null;
    pc.ontrack = (ev) => {
      onTrack?.(ev.track, trackIdx++);
    };
    let onStateChange: ((s: ConnectionStatus) => void) | null = null;
    pc.onconnectionstatechange = () => {
      const mapped = mapPeerState(pc.connectionState);
      onStateChange?.(mapped);
    };

    return {
      addTransceiver: (dir) => {
        pc.addTransceiver("video", { direction: dir });
      },
      createDataChannel: (label) => wrapDataChannel(pc.createDataChannel(label)),
      setOntrack: (h) => {
        onTrack = h;
      },
      setOnConnectionStateChange: (h) => {
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

function wrapDataChannel(dc: RTCDataChannel): WebRtcDataChannel {
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
    setOnOpen: (h) => {
      onOpen = h;
    },
    setOnMessage: (h) => {
      onMessage = h;
    },
    setOnClose: (h) => {
      onClose = h;
    },
  };
}

function mapPeerState(state: RTCPeerConnectionState): ConnectionStatus {
  switch (state) {
    case "new":
    case "connecting":
      return "connecting";
    case "connected":
      return "connected";
    case "disconnected":
    case "failed":
    case "closed":
      return state === "failed" ? "failed" : "disconnected";
  }
}

/**
 * Receiver-side kerbcam connection. Holds a single peer + control
 * channel + cached camera registry. Exposes RxJS-flavoured listener
 * APIs because the gonogo DataSource interface is callback-based
 * (no rx dep).
 */
export class KerbcamConnection {
  private cfg: KerbcamConnectionConfig;
  private transport: WebRtcTransport;
  private peer: WebRtcPeer | null = null;
  private control: WebRtcDataChannel | null = null;
  private status: ConnectionStatus = "disconnected";
  private statusListeners = new Set<(s: ConnectionStatus) => void>();
  private cameras: CameraState[] = [];
  private cameraListeners = new Set<(cams: CameraState[]) => void>();
  private streams = new Map<number, MediaStream>();
  private streamListeners = new Map<
    number,
    Set<(stream: MediaStream | null) => void>
  >();
  /** flight_ids requested at the most recent connect; tracks arrive in this order. */
  private requestedOrder: number[] = [];
  private trackIdx = 0;

  constructor(cfg: KerbcamConnectionConfig, transport?: WebRtcTransport) {
    this.cfg = cfg;
    this.transport = transport ?? new BrowserWebRtcTransport();
  }

  // -- public surface --

  getStatus(): ConnectionStatus {
    return this.status;
  }

  onStatusChange(cb: (s: ConnectionStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  getCameras(): CameraState[] {
    return this.cameras;
  }

  onCamerasChange(cb: (cams: CameraState[]) => void): () => void {
    this.cameraListeners.add(cb);
    return () => this.cameraListeners.delete(cb);
  }

  getStream(flightId: number): MediaStream | null {
    return this.streams.get(flightId) ?? null;
  }

  onStreamChange(
    flightId: number,
    cb: (stream: MediaStream | null) => void,
  ): () => void {
    let set = this.streamListeners.get(flightId);
    if (!set) {
      set = new Set();
      this.streamListeners.set(flightId, set);
    }
    set.add(cb);
    return () => set?.delete(cb);
  }

  /**
   * Pre-handshake discovery via the sidecar's HTTP /cameras endpoint.
   * Used by the widget instance config UI so the operator can pick a
   * specific Hullcam before opening a peer connection. Doesn't touch
   * `this.cameras` (that's populated post-handshake from the data
   * channel's camera-snapshot push).
   */
  async discover(): Promise<DiscoveredCamera[]> {
    const res = await fetch(`http://${this.cfg.host}:${this.cfg.port}/cameras`);
    if (!res.ok) throw new Error(`/cameras returned ${res.status}`);
    const body = (await res.json()) as {
      cameras: Array<
        DiscoveredCamera & Record<string, unknown> // camelCase fields from CameraInfo
      >;
    };
    return body.cameras.map((c) => ({
      flightId: c.flightId,
      partTitle: c.partTitle,
      cameraName: c.cameraName,
      vesselName: c.vesselName,
      maxWidth: c.maxWidth,
      maxHeight: c.maxHeight,
    }));
  }

  /**
   * Open a WebRTC connection subscribing to the given cameras (empty
   * = subscribe to all currently-known cameras, mirroring the
   * sidecar's POST /offer convenience). Idempotent: calling connect
   * while already connected tears down the previous peer first.
   */
  async connect(requestedCameras: number[] = []): Promise<void> {
    this.disconnect();
    this.setStatus("connecting");
    this.requestedOrder = [...requestedCameras];
    this.trackIdx = 0;

    const peer = this.transport.createPeer([
      { urls: "stun:stun.l.google.com:19302" },
    ]);
    this.peer = peer;

    for (const _ of this.requestedOrder.length > 0
      ? this.requestedOrder
      : [null]) {
      peer.addTransceiver("recvonly");
    }

    peer.setOntrack((track, idx) => {
      const flightId = this.requestedOrder[idx];
      if (flightId === undefined) {
        log.warn("track arrived without a matching flight_id slot", {
          idx,
          requested: this.requestedOrder,
        });
        return;
      }
      const stream = new MediaStream([track]);
      this.streams.set(flightId, stream);
      this.streamListeners.get(flightId)?.forEach((cb) => cb(stream));
    });

    peer.setOnConnectionStateChange((s) => {
      this.setStatus(s);
      if (s === "disconnected" || s === "failed") {
        this.cleanupStreams();
      }
    });

    this.control = peer.createDataChannel("kerbcam-control");
    this.control.setOnOpen(() => {
      this.send({ type: "hello" });
    });
    this.control.setOnMessage((raw) => {
      this.handleServerMessage(raw);
    });
    this.control.setOnClose(() => {
      log.info("control channel closed");
    });

    await peer.createOffer().then((sdp) => peer.setLocalDescription(sdp));
    await peer.waitForIceComplete();

    const offerSdp = peer.localSdp();
    const res = await fetch(`http://${this.cfg.host}:${this.cfg.port}/offer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sdp: offerSdp,
        cameras: this.requestedOrder,
      }),
    });
    if (!res.ok) {
      this.setStatus("failed");
      throw new Error(`POST /offer returned ${res.status}`);
    }
    const answer = (await res.json()) as { sdp: string; cameras: number[] };
    await peer.setRemoteAnswer(answer.sdp);
    // If the sidecar dropped any requested cameras (unknown flight IDs),
    // overwrite our requested order to match what's actually wired.
    this.requestedOrder = answer.cameras;
  }

  disconnect(): void {
    this.peer?.close();
    this.peer = null;
    this.control = null;
    this.cleanupStreams();
    this.setStatus("disconnected");
  }

  sendSetLayers(flightId: number, layers: string[]): void {
    this.send({
      type: "set-layers",
      content: { flightId, layers: layers as never },
    });
  }

  sendSetRenderSize(flightId: number, width: number, height: number): void {
    this.send({
      type: "set-render-size",
      content: { flightId, width, height },
    });
  }

  sendSetFov(flightId: number, fov: number): void {
    this.send({
      type: "set-fov",
      content: { flightId, fov },
    });
  }

  sendRequestKeyframe(flightId: number): void {
    this.send({
      type: "request-keyframe",
      content: { flightId },
    });
  }

  // -- private --

  private send(msg: ClientMessage): void {
    if (!this.control) {
      log.warn("dropping message — control channel not open", {
        type: msg.type,
      });
      return;
    }
    this.control.send(JSON.stringify(msg));
  }

  private handleServerMessage(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch (err) {
      log.warn("server message parse failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    switch (msg.type) {
      case "hello":
        log.info("sidecar handshake", {
          version: msg.content.sidecarVersion,
          encoder: msg.content.encoderBackend,
        });
        break;
      case "camera-snapshot":
        this.cameras = msg.content.cameras;
        this.cameraListeners.forEach((cb) => cb(this.cameras));
        break;
      case "camera-state-changed": {
        const next = this.cameras.filter(
          (c) => c.flightId !== msg.content.state.flightId,
        );
        next.push(msg.content.state);
        next.sort((a, b) => a.flightId - b.flightId);
        this.cameras = next;
        this.cameraListeners.forEach((cb) => cb(this.cameras));
        break;
      }
      case "adaptive-shed":
        log.info("adaptive shed", {
          level: msg.content.level,
          kspFps: msg.content.kspFps,
          reason: msg.content.reason,
        });
        break;
      case "error":
        log.warn("sidecar error", { message: msg.content.message });
        break;
    }
  }

  private setStatus(s: ConnectionStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.statusListeners.forEach((cb) => cb(s));
  }

  private cleanupStreams(): void {
    for (const [flightId, listeners] of this.streamListeners) {
      listeners.forEach((cb) => cb(null));
      // Note: we keep the listener sets alive across reconnects — the
      // widget might still be mounted; it'll get the new MediaStream
      // when the next connect's ontrack fires.
      this.streams.delete(flightId);
    }
  }
}
