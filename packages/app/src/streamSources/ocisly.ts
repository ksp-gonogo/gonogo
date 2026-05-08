import type { DataSourceStatus, StreamInfo, StreamSource } from "@gonogo/core";
import { registerStreamSource } from "@gonogo/core";
import { logger } from "@gonogo/logger";
import type { DataConnection, MediaConnection, Peer } from "peerjs";
import { peerHostService } from "../peer/PeerHostService";

const cameraLog = logger.tag("camera");
const streamLog = logger.tag("peer:stream");

/**
 * Maximum time we'll wait for the data-connection to settle during connect().
 * Past this the source goes to "error" so the UI stops sitting on orange
 * "connecting" forever — the live-test symptom on at least one station.
 */
const CONNECT_TIMEOUT_MS = 15_000;

/**
 * Backoff schedule for connect-failure retries: 2s, 4s, 8s, 16s, then a
 * 30s cap. The host's first connect can happen during a broker race
 * (`unavailable-id` window after a refresh), grab a Peer reference that
 * gets destroyed by the auto-rotate path, and then go silent forever
 * because nothing re-pumps `connect()`. The per-attempt cap is high so
 * a long-lived recovery (e.g., relay container rebuild) eventually
 * succeeds without hammering the broker.
 */
function backoffMs(attempt: number): number {
  return Math.min(2000 * 2 ** attempt, 30_000);
}

type ProxyOut =
  | { type: "hello"; version: string; buildTime: string }
  | { type: "cameras"; cameras: string[] }
  | { type: "subscribed"; cameraId: string }
  | { type: "unsubscribed"; cameraId: string }
  | {
      type: "metadata";
      metadata: {
        cameraId: string;
        cameraName: string;
        speed: string;
        altitude: string;
      };
    }
  | { type: "error"; message: string; cameraId?: string };

type ProxyIn =
  | { type: "listCameras" }
  | { type: "subscribe"; cameraId: string }
  | { type: "unsubscribe"; cameraId: string };

interface Subscription {
  refCount: number;
  stream: MediaStream | null;
  call: MediaConnection | null;
  pending: Array<(s: MediaStream | null) => void>;
}

export interface OcislyStreamSourceOptions {
  /** Returns the local Peer used to call the proxy. */
  peerProvider: () => Promise<Peer>;
  /** Resolves the proxy's PeerJS peer id. */
  proxyPeerIdProvider: () => Promise<string>;
  /**
   * Called when the proxy peer id is resolved (host-side only).
   * The main screen uses this to broadcast the id to stations over the
   * existing host↔station data channel.
   */
  onProxyPeerIdResolved?: (peerId: string | null) => void;
  /** Poll interval for re-fetching the camera list from the proxy. Default: 2000ms. */
  listPollMs?: number;
  /**
   * Subscribe to "the underlying Peer changed" events. When the
   * subscription fires, the source resets its retry counter and
   * triggers a fresh `connect()` attempt — this is how the host-side
   * registration (which calls `peerHostService.waitForPeer()`)
   * recovers from `regeneratePeerId()` invalidating its captured
   * peer reference. Optional — stations don't need it because their
   * PeerClientService doesn't rotate peer instances mid-session.
   * Returns an unsubscribe function.
   */
  onPeerChange?: (cb: () => void) => () => void;
}

export class OcislyStreamSource implements StreamSource {
  id = "ocisly";
  name = "OCISLY cameras";
  status: DataSourceStatus = "disconnected";

  private readonly opts: OcislyStreamSourceOptions;
  private proxyPeerId: string | null = null;
  private dataConnection: DataConnection | null = null;
  private peer: Peer | null = null;
  private callListenerAttached = false;
  // Bumped every disconnect; connect() bails if the generation changes
  // while it's awaiting async work (StrictMode double-mount race).
  private connectGeneration = 0;
  private subscriptions = new Map<string, Subscription>();
  private streams: StreamInfo[] = [];
  private listPollTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private peerChangeUnsub: (() => void) | null = null;

  private statusListeners = new Set<(s: DataSourceStatus) => void>();
  private streamsListeners = new Set<(s: StreamInfo[]) => void>();
  private remoteVersion: { version: string; buildTime: string } | null = null;
  private remoteVersionListeners = new Set<
    (info: { version: string; buildTime: string } | null) => void
  >();

  private readonly onIncomingCall = (call: MediaConnection) => {
    this.handleIncomingCall(call);
  };

  constructor(opts: OcislyStreamSourceOptions) {
    this.opts = { listPollMs: 2000, ...opts };
    if (this.opts.onPeerChange) {
      this.peerChangeUnsub = this.opts.onPeerChange(() => {
        cameraLog.info(
          "peer changed — resetting retry counter and reconnecting",
        );
        // A peer rotation invalidates any captured Peer reference inside
        // an in-flight or already-failed connect. Cancel pending retries,
        // reset attempt counter, force a fresh connect.
        this.cancelRetry();
        this.retryAttempt = 0;
        // Bump generation so any in-flight connect bails before its
        // post-await work touches the new peer.
        this.connectGeneration += 1;
        // Disconnect any state from the old peer before trying again.
        if (this.dataConnection) {
          try {
            this.dataConnection.close();
          } catch {
            // already closed
          }
          this.dataConnection = null;
        }
        this.peer = null;
        this.callListenerAttached = false;
        this.setStatus("disconnected");
        void this.connect();
      });
    }
  }

  async connect(): Promise<void> {
    if (this.status === "connected" || this.status === "reconnecting") return;
    this.setStatus("reconnecting");
    const gen = ++this.connectGeneration;
    const isStale = () => gen !== this.connectGeneration;
    const startedAt = Date.now();
    cameraLog.info("connect: begin", {
      generation: gen,
      attempt: this.retryAttempt,
    });

    try {
      const peerId = await this.opts.proxyPeerIdProvider();
      if (isStale()) return;
      this.proxyPeerId = peerId;
      this.opts.onProxyPeerIdResolved?.(peerId);
      cameraLog.debug("connect: proxyPeerId resolved", { peerId });

      const peer = await this.opts.peerProvider();
      if (isStale()) return;
      this.peer = peer;
      // Guard against double-attach under StrictMode: attaching this handler
      // twice would make every incoming call fire handleIncomingCall twice,
      // each calling call.answer() — which produced the empty peer error on
      // _makeAnswer and attached duplicate tracks to dead PeerConnections.
      if (!this.callListenerAttached) {
        peer.on("call", this.onIncomingCall);
        this.callListenerAttached = true;
      }

      // PeerJS returns `undefined` from `peer.connect()` when the Peer's
      // broker WebSocket is in the `disconnected` state (transient
      // re-connect window). Without this guard, the next line's
      // `conn.on(...)` throws "Cannot read properties of undefined" and
      // poisons the retry until something else nudges a fresh attempt.
      // Treat it as a regular failure and let scheduleRetry try again
      // once the broker WS is back.
      const peerWithState = peer as Peer & { disconnected?: boolean };
      if (peerWithState.disconnected) {
        throw new Error(
          "Peer is in disconnected state — broker WS isn't ready for outgoing connect()",
        );
      }
      const conn = peer.connect(peerId, { reliable: true });
      if (!conn) {
        throw new Error(
          "peer.connect() returned undefined — Peer is mid-reconnect or destroyed",
        );
      }
      this.dataConnection = conn;

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(
            new Error(
              `data connection did not open within ${CONNECT_TIMEOUT_MS}ms`,
            ),
          );
        }, CONNECT_TIMEOUT_MS);
        conn.on("open", () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          cameraLog.debug("connect: data connection open", {
            elapsedMs: Date.now() - startedAt,
          });
          resolve();
        });
        conn.on("error", (err: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(err);
        });
      });
      if (isStale()) return;

      conn.on("data", (raw: unknown) => {
        this.handleMessage(raw as ProxyOut);
      });
      conn.on("close", () => {
        cameraLog.info("data connection closed");
        this.setStatus("disconnected");
        this.dataConnection = null;
      });

      this.setStatus("connected");
      this.send({ type: "listCameras" });
      // Successful connect: reset backoff and ditch any pending retry
      // (defensive — there shouldn't be one if status reached connected).
      this.retryAttempt = 0;
      this.cancelRetry();

      this.listPollTimer = setInterval(() => {
        if (this.status === "connected") this.send({ type: "listCameras" });
      }, this.opts.listPollMs ?? 2000);
    } catch (err) {
      if (isStale()) return;
      const elapsedMs = Date.now() - startedAt;
      const attempt = this.retryAttempt;
      const next = backoffMs(attempt);
      logger.error(
        `[ocisly] connect failed (attempt ${attempt}) — retrying in ${next}ms`,
        err instanceof Error ? err : new Error(String(err)),
        { elapsedMs, attempt },
      );
      this.setStatus("error");
      this.scheduleRetry(next);
    }
  }

  private scheduleRetry(delayMs: number): void {
    this.cancelRetry();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.retryAttempt += 1;
      cameraLog.info(`retry firing — attempt ${this.retryAttempt}`);
      void this.connect();
    }, delayMs);
  }

  private cancelRetry(): void {
    if (this.retryTimer === null) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  disconnect(): void {
    // Invalidate any in-flight connect() so its post-await work bails out.
    this.connectGeneration += 1;
    this.cancelRetry();
    this.peerChangeUnsub?.();
    this.peerChangeUnsub = null;
    if (this.listPollTimer) {
      clearInterval(this.listPollTimer);
      this.listPollTimer = null;
    }
    for (const sub of this.subscriptions.values()) {
      sub.call?.close();
      sub.stream?.getTracks().forEach((t) => {
        t.stop();
      });
    }
    this.subscriptions.clear();
    this.dataConnection?.close();
    this.dataConnection = null;
    if (this.peer && this.callListenerAttached) {
      this.peer.off("call", this.onIncomingCall);
      this.callListenerAttached = false;
    }
    this.peer = null;
    this.opts.onProxyPeerIdResolved?.(null);
    if (this.remoteVersion !== null) {
      this.remoteVersion = null;
      for (const cb of this.remoteVersionListeners) cb(null);
    }
    this.setStatus("disconnected");
  }

  listStreams(): StreamInfo[] {
    return this.streams;
  }

  async subscribe(streamId: string): Promise<MediaStream | null> {
    if (this.status !== "connected") return null;

    let sub = this.subscriptions.get(streamId);
    if (!sub) {
      sub = { refCount: 0, stream: null, call: null, pending: [] };
      this.subscriptions.set(streamId, sub);
    }

    sub.refCount += 1;

    if (sub.stream) return sub.stream;

    return new Promise<MediaStream | null>((resolve) => {
      sub.pending.push(resolve);
      if (sub.refCount === 1) {
        this.send({ type: "subscribe", cameraId: streamId });
      }
    });
  }

  unsubscribe(streamId: string): void {
    const sub = this.subscriptions.get(streamId);
    if (!sub) return;
    sub.refCount -= 1;
    if (sub.refCount > 0) return;
    this.send({ type: "unsubscribe", cameraId: streamId });
    sub.call?.close();
    sub.stream?.getTracks().forEach((t) => {
      t.stop();
    });
    for (const p of sub.pending) p(null);
    this.subscriptions.delete(streamId);
  }

  onStatusChange(cb: (s: DataSourceStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  onStreamsChange(cb: (s: StreamInfo[]) => void): () => void {
    this.streamsListeners.add(cb);
    return () => this.streamsListeners.delete(cb);
  }

  /** Latest proxy version captured from the peer-channel hello, or null. */
  getRemoteVersion(): { version: string; buildTime: string } | null {
    return this.remoteVersion;
  }

  onRemoteVersionChange(
    cb: (info: { version: string; buildTime: string } | null) => void,
  ): () => void {
    this.remoteVersionListeners.add(cb);
    return () => this.remoteVersionListeners.delete(cb);
  }

  // ---------------------------------------------------------------------------

  private handleMessage(msg: ProxyOut): void {
    if (msg.type === "hello") {
      this.remoteVersion = { version: msg.version, buildTime: msg.buildTime };
      cameraLog.info(`proxy hello — v${msg.version} (build ${msg.buildTime})`);
      for (const cb of this.remoteVersionListeners) cb(this.remoteVersion);
      return;
    }
    if (msg.type === "cameras") {
      const nextIds = new Set(msg.cameras);
      // Reuse existing StreamInfo objects when the id is still active so
      // metadata (name/speed/altitude) isn't wiped on every 2s poll.
      const byId = new Map(this.streams.map((s) => [s.id, s]));
      const next: StreamInfo[] = msg.cameras.map(
        (id) => byId.get(id) ?? { id, name: id },
      );
      this.streams = next;
      for (const cb of this.streamsListeners) cb(next);
      for (const [id, sub] of this.subscriptions) {
        if (!nextIds.has(id)) {
          sub.call?.close();
          sub.stream?.getTracks().forEach((t) => {
            t.stop();
          });
          for (const p of sub.pending) p(null);
          this.subscriptions.delete(id);
        }
      }
      return;
    }
    if (msg.type === "metadata") {
      const idx = this.streams.findIndex((s) => s.id === msg.metadata.cameraId);
      if (idx === -1) return;
      const next = [...this.streams];
      next[idx] = {
        ...next[idx],
        // Proxy tells us the real camera name from OCISLY; prefer it over the
        // bare id once known.
        name: msg.metadata.cameraName || next[idx].name,
        metadata: {
          cameraName: msg.metadata.cameraName,
          speed: msg.metadata.speed,
          altitude: msg.metadata.altitude,
        },
      };
      this.streams = next;
      for (const cb of this.streamsListeners) cb(next);
      return;
    }
    if (msg.type === "error") {
      logger.error(`[ocisly] proxy error: ${msg.message}`);
    }
  }

  private handleIncomingCall(call: MediaConnection): void {
    if (call.peer !== this.proxyPeerId) return;
    const metadata = call.metadata as { cameraId?: string } | undefined;
    const cameraId = metadata?.cameraId;
    if (!cameraId) {
      call.close();
      return;
    }
    const sub = this.subscriptions.get(cameraId);
    if (!sub) {
      call.close();
      return;
    }
    // If we already have a live call for this camera, reject the duplicate.
    // Without this, a second call (from a transient unsubscribe/resubscribe
    // race) overwrites sub.stream with a stream whose remote PC has already
    // been torn down, leaving the <video> attached to a dead MediaStream.
    if (sub.call && sub.stream) {
      call.close();
      return;
    }
    sub.call = call;
    call.answer();

    // Surface ICE / connection state changes on the underlying RTCPeerConnection.
    // "Stuck on orange" and "cutting out" live-test bugs both present as
    // invisible ICE state transitions (checking→failed, or disconnected
    // drifts), so log every transition at camera/peer:stream tags.
    const pc = (
      call as MediaConnection & { peerConnection?: RTCPeerConnection }
    ).peerConnection;
    if (pc) {
      const logState = (label: string, value: string) => {
        streamLog.debug(`${label}: ${value}`, { cameraId });
      };
      pc.addEventListener("iceconnectionstatechange", () => {
        logState("iceConnectionState", pc.iceConnectionState);
        if (pc.iceConnectionState === "failed") {
          cameraLog.warn(`ICE failed for ${cameraId}`);
        }
      });
      pc.addEventListener("connectionstatechange", () => {
        logState("connectionState", pc.connectionState);
      });
      pc.addEventListener("icegatheringstatechange", () => {
        logState("iceGatheringState", pc.iceGatheringState);
      });
      // Candidate-level logging mirrors peer:ice on the data conn —
      // when a camera "never opens" the candidate types tell us
      // immediately whether host pairs failed (different LAN), srflx
      // wasn't gathered (no STUN reachable), or relay was gathered but
      // pair-checking failed (TURN credentials wrong, port-forward
      // missing). Without this we can't distinguish those failure
      // shapes from each other.
      pc.addEventListener("icecandidate", (ev) => {
        const c = ev.candidate;
        if (!c) {
          streamLog.debug("icecandidate: end-of-candidates", { cameraId });
          return;
        }
        streamLog.debug("icecandidate", {
          cameraId,
          type: c.type,
          protocol: c.protocol,
          address: c.address,
          port: c.port,
          relatedAddress: c.relatedAddress,
        });
      });
      pc.addEventListener("icecandidateerror", (ev) => {
        const e = ev as RTCPeerConnectionIceErrorEvent;
        streamLog.warn("icecandidateerror", {
          cameraId,
          url: e.url,
          errorCode: e.errorCode,
          errorText: e.errorText,
        });
      });
    }

    call.on("stream", (stream: MediaStream) => {
      cameraLog.info(`stream received for ${cameraId}`);
      sub.stream = stream;
      for (const p of sub.pending) p(stream);
      sub.pending = [];
    });
    call.on("close", () => {
      cameraLog.info(`media call closed for ${cameraId}`);
      sub.stream = null;
      sub.call = null;
    });
    call.on("error", (err: unknown) => {
      logger.error(
        `[ocisly] media call error ${cameraId}`,
        err instanceof Error ? err : new Error(String(err)),
      );
    });
  }

  private send(msg: ProxyIn): void {
    if (this.dataConnection?.open) {
      this.dataConnection.send(msg);
    }
  }

  private setStatus(next: DataSourceStatus): void {
    if (this.status === next) return;
    this.status = next;
    for (const cb of this.statusListeners) cb(next);
  }
}

// ---------------------------------------------------------------------------
// Registration — host-side default (main screen). Station overrides by
// registering its own instance (with client-peer + broadcast-supplied
// proxy-id) when the StationScreen connects to its host.
// ---------------------------------------------------------------------------

const DEFAULT_PROXY_URL =
  (import.meta.env.VITE_OCISLY_PROXY_URL as string | undefined) ??
  "http://localhost:3002";

async function fetchProxyPeerId(baseUrl: string): Promise<string> {
  const resp = await fetch(`${baseUrl.replace(/\/$/, "")}/peer-id`);
  if (!resp.ok) throw new Error(`proxy /peer-id ${resp.status}`);
  const body = (await resp.json()) as { peerId: string };
  return body.peerId;
}

export const ocislyStreamSource = new OcislyStreamSource({
  peerProvider: () => peerHostService.waitForPeer(),
  proxyPeerIdProvider: () => fetchProxyPeerId(DEFAULT_PROXY_URL),
  onProxyPeerIdResolved: (peerId) => {
    peerHostService.setRelayPeerId(peerId);
  },
  // Re-attempt the relay handshake whenever the host's underlying Peer
  // is replaced — most notably after a `regeneratePeerId()` (manual or
  // auto-rotate) destroys the original peer reference. Without this the
  // OcislyStreamSource holds a dead Peer and silently never recovers,
  // even though the host is otherwise healthy. Stations don't take
  // this path because they don't rotate peer instances mid-session.
  onPeerChange: (cb) =>
    peerHostService.onPeerIdChange((id) => {
      if (id) cb();
    }),
});

registerStreamSource(ocislyStreamSource);
