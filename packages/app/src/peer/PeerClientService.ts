import { safeRandomUuid } from "@gonogo/core";
import type {
  FlightRecord,
  KosData,
  KosManagedScript,
  KosScriptArg,
} from "@gonogo/data";
import { KosScriptError, ListenerSet } from "@gonogo/data";
import { debugPeer, logger } from "@gonogo/logger";
import Peer, { type DataConnection } from "peerjs";
import { MessageDispatcher } from "./MessageDispatcher";
import { peerBrokerOptions } from "./peerOptions";
import type { FlightRpcOp, PeerMessage, PeerSchemaSource } from "./protocol";
import { RequestTracker } from "./RequestTracker";
import { RetryPolicy } from "./RetryPolicy";
import { getStationKey, getStationPeerId } from "./stationPeerId";

export type ConnStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

const DEFAULT_RETRY_INTERVAL_MS = 2_000;
const DEFAULT_RETRY_TIMEOUT_MS = 5 * 60 * 1000;

/** PeerJS error shape — `.type` is the discriminator. */
interface PeerJsError extends Error {
  type?: string;
}

function isPeerJsError(e: unknown): e is PeerJsError {
  return e instanceof Error && typeof (e as PeerJsError).type === "string";
}

/**
 * peer-unavailable carries the missing peer id in the message
 * (`Could not connect to peer XYZ` — see peerjs `bundler.mjs:1575`).
 * Match exactly so auxiliary connects (OCISLY proxy etc.) don't
 * masquerade as a host outage, and so a host id that's a substring of
 * some other peer id can't false-positive either.
 */
const PEER_UNAVAILABLE_PREFIX = "Could not connect to peer ";

function isMissingHost(err: PeerJsError, hostPeerId: string | null): boolean {
  if (!hostPeerId) return true;
  if (!err.message.startsWith(PEER_UNAVAILABLE_PREFIX)) return false;
  const target = err.message.slice(PEER_UNAVAILABLE_PREFIX.length);
  return target === hostPeerId;
}

const iceLog = logger.tag("peer:ice");

/**
 * Wire ICE diagnostics on a data connection. peerjs surfaces only opaque
 * `open` / `close` / `error` events; without these we can't tell if a
 * connection that "never opens" is failing at candidate gathering, ICE
 * checking, DTLS, or something later. Each transition is one log line so
 * the export is searchable per data conn.
 *
 * The underlying RTCPeerConnection is a non-public peerjs internal — we
 * cast through unknown to read it. Best-effort: if peerjs ever changes
 * shape we just lose the diagnostics rather than crashing.
 */
function attachIceDiagnostics(conn: DataConnection): void {
  const pc = (conn as DataConnection & { peerConnection?: RTCPeerConnection })
    .peerConnection;
  if (!pc) {
    iceLog.debug("no underlying peerConnection — skipping ICE diagnostics", {
      peerId: conn.peer,
    });
    return;
  }
  const ctx = { peerId: conn.peer };
  iceLog.debug("attached", {
    ...ctx,
    initial: {
      iceConnectionState: pc.iceConnectionState,
      iceGatheringState: pc.iceGatheringState,
      connectionState: pc.connectionState,
      signalingState: pc.signalingState,
    },
  });
  pc.addEventListener("iceconnectionstatechange", () => {
    iceLog.debug(`iceConnectionState=${pc.iceConnectionState}`, ctx);
  });
  pc.addEventListener("icegatheringstatechange", () => {
    iceLog.debug(`iceGatheringState=${pc.iceGatheringState}`, ctx);
  });
  pc.addEventListener("connectionstatechange", () => {
    iceLog.debug(`connectionState=${pc.connectionState}`, ctx);
  });
  pc.addEventListener("signalingstatechange", () => {
    iceLog.debug(`signalingState=${pc.signalingState}`, ctx);
  });
  pc.addEventListener("icecandidate", (ev) => {
    const c = ev.candidate;
    if (!c) {
      iceLog.debug("icecandidate: end-of-candidates", ctx);
      return;
    }
    // Strip the raw `candidate` SDP string to keep the entry compact —
    // type, protocol, and address class are the diagnostic-grade fields.
    iceLog.debug("icecandidate", {
      ...ctx,
      type: c.type,
      protocol: c.protocol,
      // address may be a .local mDNS hostname (Chrome / iOS Safari
      // privacy default) or a real IP. The shape tells us whether the
      // browser is publishing host candidates the other side can use.
      address: c.address,
      port: c.port,
      relatedAddress: c.relatedAddress,
    });
  });
  pc.addEventListener("icecandidateerror", (ev) => {
    const e = ev as RTCPeerConnectionIceErrorEvent;
    iceLog.warn("icecandidateerror", {
      ...ctx,
      url: e.url,
      errorCode: e.errorCode,
      errorText: e.errorText,
    });
  });
}

export interface PeerClientOptions {
  retryIntervalMs?: number;
  retryTimeoutMs?: number;
  /**
   * Explicit PeerJS id for this station. Defaults to the persistent
   * localStorage-backed id from `getStationPeerId()`. Override for tests.
   */
  peerId?: string;
  /**
   * Resolve the operator-typed **share-code** to the host's current PeerJS
   * peer id via the relay. When provided, `connect()` and every reconnect
   * re-resolve the code first so the station auto-follows the host's
   * peer-id rotation (the host re-registers a new id under the same code).
   *
   * Resolving to `null` (relay down / unknown code) falls back to the
   * last-known peer id if one exists, otherwise treats the typed value as
   * a direct peer id — preserving the no-relay back-compat path.
   *
   * Omitted (the default / test path) → no resolution; the typed value is
   * used verbatim as the peer id, exactly as before this feature.
   */
  resolveHost?: (shareCode: string) => Promise<string | null>;
}

export class PeerClientService {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private hostPeerId: string | null = null;
  /** The operator-typed value — a relay **share-code** when a resolver is
   *  wired, or a raw peer id otherwise. Held as the reconnect target so
   *  every retry re-resolves it (the host may have rotated its peer id).
   *  Stays stable across the session even as `hostPeerId` changes. */
  private shareCode: string | null = null;
  /** Optional relay resolver (share-code → current peer id). Null in the
   *  default / test path, where the typed value is used verbatim. */
  private readonly resolveHost:
    | ((shareCode: string) => Promise<string | null>)
    | null;
  /** Fresh per `openPeer()` call. Reusing the same id across retries
   *  collides with the broker's id-hold (~30–60 s) when a previous
   *  connection didn't shut down gracefully — e.g. a mid-session WS
   *  drop. Regenerating dodges that entirely. */
  private stationPeerId: string;
  private readonly stationKey: string;
  /** Override id supplied via constructor opts, used by tests. When set,
   *  every `openPeer()` reuses it; when null we re-roll on each call. */
  private readonly fixedPeerIdOverride: string | null;
  private readonly retryPolicy: RetryPolicy;

  private dataListeners = new ListenerSet<
    [sourceId: string, key: string, value: unknown, t: number]
  >();
  private sourceStatusListeners = new ListenerSet<
    [sourceId: string, status: string]
  >();
  private connStatusListeners = new ListenerSet<[status: ConnStatus]>();
  private schemaListeners = new ListenerSet<[sources: PeerSchemaSource[]]>();
  private kosDataListeners = new ListenerSet<
    [sessionId: string, data: string]
  >();
  private kosOpenedListeners = new ListenerSet<[sessionId: string]>();
  private kosCloseListeners = new ListenerSet<[sessionId: string]>();
  private relayPeerIdListeners = new ListenerSet<[peerId: string | null]>();
  private relayPeerId: string | null = null;
  // Relay TURN creds from the latest `relay-peer-id` broadcast. Applied to the
  // station's own Peer (see applyRelayIceServers) AND exposed here so a brokered
  // kerbcam data source can feed them to its station↔sidecar PeerConnection —
  // a path separate from PeerJS. Empty until the first broadcast carrying creds.
  private relayIceServers: RTCIceServer[] = [];
  private relayIceServersListeners = new ListenerSet<
    [servers: RTCIceServer[]]
  >();
  private hostVersion: { version: string; buildTime: string } | null = null;
  private hostSessionToken: string | null = null;
  private hostHelloListeners = new ListenerSet<
    [info: { version: string; buildTime: string }]
  >();
  // Fires when the host's `sessionToken` changes between two hellos (i.e.
  // the host process has restarted). Stations use this to clear local
  // state that would otherwise re-broadcast on reconnect — see GoNoGo
  // station-side vote reset.
  private hostRestartListeners = new ListenerSet<[]>();
  private gonogoCountdownStartListeners = new ListenerSet<[t0Ms: number]>();
  private gonogoCountdownCancelListeners = new ListenerSet<
    [reason: string | undefined]
  >();
  private alarmSnapshotListeners = new ListenerSet<
    [snap: import("../alarms/types").AlarmSnapshot]
  >();
  private alarmFiredListeners = new ListenerSet<
    [fire: { id: string; name: string; ut: number }]
  >();
  private triggerSnapshotListeners = new ListenerSet<
    [snap: import("@gonogo/components").TriggerSnapshot]
  >();
  private notesSnapshotListeners = new ListenerSet<
    [snap: import("../notes/types").NotesSnapshot]
  >();
  private gonogoAbortNotifyListeners = new ListenerSet<
    [stationName: string, t: number]
  >();

  private pendingQueries = new RequestTracker<{
    t: number[];
    v: unknown[];
  }>();
  private pendingKosExecutes = new RequestTracker<KosData>();
  private pendingFlightRpc = new RequestTracker<unknown>();
  private pendingKerbcamNegotiate = new RequestTracker<{
    sdp: string;
    cameras: number[];
  }>();

  // Cached current flight pushed by the host. Updated on every `flight-change`
  // message, including the initial snapshot the host sends on connect open.
  // Stations read this synchronously through `getCurrentFlight()`; the modal
  // useFlight hook subscribes via `onFlightChange`.
  private currentFlight: FlightRecord | null = null;
  private flightChangeListeners = new ListenerSet<
    [flight: FlightRecord | null]
  >();
  private flightListChangeListeners = new ListenerSet<[]>();
  private hostUnavailableListeners = new ListenerSet<[hostPeerId: string]>();
  // Fired when the host announces a graceful rotation of its share code
  // over the existing data channel. The PeerClientService updates its
  // reconnect target internally; the listener gives the screen layer a
  // chance to persist the new id so a subsequent refresh picks it up
  // instead of retrying the dead old code.
  private hostPeerIdChangeListeners = new ListenerSet<[newPeerId: string]>();
  // One-shot fog-snapshot from the host, fired right after schema on each
  // connect. Subscribers (StationScreen → FogMaskStore) decide what to
  // do with the masks; the service itself doesn't keep them around.
  private fogSnapshotListeners = new ListenerSet<
    [msg: Extract<PeerMessage, { type: "fog-snapshot" }>]
  >();

  constructor({
    retryIntervalMs = DEFAULT_RETRY_INTERVAL_MS,
    retryTimeoutMs = DEFAULT_RETRY_TIMEOUT_MS,
    peerId,
    resolveHost,
  }: PeerClientOptions = {}) {
    this.fixedPeerIdOverride = peerId ?? null;
    this.resolveHost = resolveHost ?? null;
    this.stationPeerId = peerId ?? getStationPeerId();
    this.stationKey = getStationKey();
    // Tag every log entry on this station with the persistent stationKey
    // and the per-session broker id so a remote query can filter all
    // logs from a single device or a single tab session.
    logger.setIdentity({
      role: "station",
      id: this.stationKey,
      peerId: this.stationPeerId,
    });
    this.retryPolicy = new RetryPolicy({
      retryIntervalMs,
      retryTimeoutMs,
      // Always read the *current* peer id — a closure capture of the
      // initial value would log a stale id after the first regeneration.
      stationPeerId: () => this.stationPeerId,
      hostPeerId: () => this.hostPeerId,
      tearDown: () => this.tearDownPeer(),
      rejectPending: (reason) => this.rejectPendingQueries(reason),
      emitStatus: (status) => this.emitConnStatus(status),
      // Re-resolve the share-code before each reconnect so the station
      // auto-follows the host's peer-id rotation. With no resolver this is
      // a synchronous pass-through to openPeer(), keeping the existing
      // reconnect-loop tests fully synchronous.
      reopen: () => this.resolveAndOpen(),
    });
  }

  connect(code: string) {
    // `code` is the operator-typed value: a relay share-code when a
    // resolver is wired, otherwise a raw peer id. Held as the reconnect
    // target so each retry re-resolves it.
    this.shareCode = code;
    // Without a resolver the typed value IS the peer id (back-compat /
    // test path). With one, hostPeerId stays null until the first resolve
    // lands inside resolveAndOpen().
    if (!this.resolveHost) {
      this.hostPeerId = code;
      logger.setIdentity({ hostPeerId: code });
    }
    this.retryPolicy.beginConnect();
    this.resolveAndOpen();
  }

  /**
   * Resolve the share-code to the host's current peer id (when a resolver
   * is wired), then open the Peer. Synchronous fast-path when there's no
   * resolver — `openPeer()` runs in the same tick, so reconnect-loop tests
   * that assert Peer-instance counts immediately after a timer fires stay
   * valid.
   *
   * Resolution precedence on failure (relay down / 404):
   *   1. the last-known `hostPeerId` (e.g. set by a live `host-id-rotation`
   *      broadcast) — keeps the fast-path rotation recovery working when
   *      the relay is unavailable;
   *   2. otherwise the raw typed value as a direct peer id (no-relay
   *      back-compat).
   */
  private resolveAndOpen(): void {
    if (!this.resolveHost || !this.shareCode) {
      this.openPeer();
      return;
    }
    const code = this.shareCode;
    void this.resolveHost(code)
      .then((resolved) => {
        // A teardown/disconnect may have landed while the resolve was in
        // flight; bail if the retry loop no longer wants us.
        if (this.shareCode !== code) return;
        const next = resolved ?? this.hostPeerId ?? code;
        this.hostPeerId = next;
        logger.setIdentity({ hostPeerId: next });
        this.openPeer();
      })
      .catch(() => {
        // resolveHost is contracted to never reject (it fail-softs to
        // null), but guard anyway so a thrown resolver can't wedge the
        // reconnect loop — fall back and still attempt a connect.
        if (this.shareCode !== code) return;
        this.hostPeerId = this.hostPeerId ?? code;
        this.openPeer();
      });
  }

  private openPeer() {
    if (!this.hostPeerId) return;
    // Re-roll the per-session id so retries can't collide with a broker
    // hold from a previous attempt that dropped without sending a
    // graceful leave (mid-session WS drop, screen lock, tab background).
    if (!this.fixedPeerIdOverride) {
      this.stationPeerId = getStationPeerId();
    }
    logger.info(
      `[PeerClient] connecting to host=${this.hostPeerId} as ${this.stationPeerId}`,
    );
    this.emitConnStatus("connecting");
    // Stations construct their Peer with no ICE config. The host's
    // relay candidates flow in via the broker as part of the offer's
    // ICE-candidate exchange — that's enough for one-side TURN to
    // bridge difficult networks. Configuring local TURN here would
    // require the station to know the relay's URL, which it doesn't —
    // and previous defaults (`turn:localhost:3478`) actively broke
    // mobile clients.
    //
    // `key: "gonogo"` puts the station in our private namespace on the
    // public broker. MUST match PeerHostService + the relay's PeerHost —
    // a station with a different key is invisible to the host on the
    // broker even if both ids would otherwise match.
    this.peer = new Peer(this.stationPeerId, peerBrokerOptions());
    this.peer.on("open", () => {
      if (!this.peer || !this.hostPeerId) return;
      this.conn = this.peer.connect(this.hostPeerId);
      attachIceDiagnostics(this.conn);
      this.conn.on("open", () => {
        logger.info(`[PeerClient] connected to host=${this.hostPeerId}`);
        this.retryPolicy.onConnected();
        // Opt into selective broadcast immediately. The host's default
        // is broadcast-all so v1 stations still work; v2 stations switch
        // here. Following peer-data-subscribe messages from
        // PeerClientDataSource are then respected per peer.
        this.sendDataMode("selective");
        this.emitConnStatus("connected");
      });
      this.conn.on("data", (raw) => this.handleMessage(raw as PeerMessage));
      this.conn.on("close", () => {
        logger.info(`[PeerClient] connection closed`);
        this.retryPolicy.handleUnexpectedClose();
      });
      this.conn.on("error", (err) => {
        logger.error("[PeerClient] connection error", err);
      });
    });
    this.peer.on("error", (err) => {
      // PeerJS emits `peer-unavailable` on the *Peer* (not the conn) when
      // any outgoing peer.connect() targets a missing id. The station's
      // OCISLY stream source shares this Peer, so its failed connect to a
      // missing proxy would otherwise tear down our live host conn here.
      // Only treat it as a host failure when the host is the missing peer.
      if (
        isPeerJsError(err) &&
        err.type === "peer-unavailable" &&
        !isMissingHost(err, this.hostPeerId)
      ) {
        debugPeer("ignoring auxiliary peer-unavailable", {
          message: err.message,
        });
        return;
      }
      // Surface the "host not on broker" case explicitly so the connect
      // screen can show a specific "couldn't find that code" message
      // instead of the generic reconnecting spinner. Fires every retry
      // while the host stays missing — listeners debounce as they like.
      if (
        isPeerJsError(err) &&
        err.type === "peer-unavailable" &&
        this.hostPeerId
      ) {
        this.hostUnavailableListeners.fire(this.hostPeerId);
      }
      this.retryPolicy.handlePeerError(err);
    });
  }

  private tearDownPeer() {
    try {
      this.conn?.close();
    } catch {
      /* already closed */
    }
    try {
      this.peer?.destroy();
    } catch {
      /* already destroyed */
    }
    this.peer = null;
    this.conn = null;
    // Drop the cached hello so a reconnect to a freshly-deployed host on a
    // different version doesn't briefly report the old version.
    this.hostVersion = null;
    this.hostSessionToken = null;
  }

  private emitConnStatus(status: ConnStatus) {
    this.connStatusListeners.fire(status);
  }

  sendExecute(sourceId: string, action: string) {
    logger.info(`[PeerClient] execute — source=${sourceId} action=${action}`);
    this.conn?.send({
      type: "execute",
      sourceId,
      action,
    } satisfies PeerMessage);
  }

  sendKosOpen(
    sessionId: string,
    params: { kosHost: string; kosPort: number; cols: number; rows: number },
  ) {
    this.conn?.send({
      type: "kos-open",
      sessionId,
      ...params,
    } satisfies PeerMessage);
  }

  sendKosData(sessionId: string, data: string) {
    this.conn?.send({
      type: "kos-data",
      sessionId,
      data,
    } satisfies PeerMessage);
  }

  sendKosResize(sessionId: string, cols: number, rows: number) {
    this.conn?.send({
      type: "kos-resize",
      sessionId,
      cols,
      rows,
    } satisfies PeerMessage);
  }

  sendKosClose(sessionId: string) {
    this.conn?.send({ type: "kos-close", sessionId } satisfies PeerMessage);
  }

  sendStationInfo(
    name: string,
    info?: { version?: string; buildTime?: string },
  ) {
    this.conn?.send({
      type: "station-info",
      name,
      stationKey: this.stationKey,
      ...(info?.version ? { version: info.version } : {}),
      ...(info?.buildTime ? { buildTime: info.buildTime } : {}),
    } satisfies PeerMessage);
  }

  /**
   * Switch the host's data-broadcast mode for this peer. v2 stations
   * call this immediately after connect to opt into selective
   * subscription; without it the host stays on broadcast-all (default).
   */
  sendDataMode(mode: "selective" | "broadcast-all") {
    this.conn?.send({
      type: "peer-data-mode",
      mode,
    } satisfies PeerMessage);
  }

  sendDataSubscribe(sourceId: string, keys: readonly string[]) {
    if (keys.length === 0) return;
    this.conn?.send({
      type: "peer-data-subscribe",
      sourceId,
      keys: [...keys],
    } satisfies PeerMessage);
  }

  sendDataUnsubscribe(sourceId: string, keys: readonly string[]) {
    if (keys.length === 0) return;
    this.conn?.send({
      type: "peer-data-unsubscribe",
      sourceId,
      keys: [...keys],
    } satisfies PeerMessage);
  }

  sendGonogoVote(status: "go" | "no-go" | null) {
    this.conn?.send({ type: "gonogo-vote", status } satisfies PeerMessage);
  }

  sendGonogoAbort() {
    this.conn?.send({ type: "gonogo-abort" } satisfies PeerMessage);
  }

  sendWidgetPush(msg: {
    widgetInstanceId: string;
    componentId: string;
    config: Record<string, unknown>;
    width: number;
    height: number;
  }) {
    this.conn?.send({ type: "widget-push", ...msg } satisfies PeerMessage);
  }

  sendWidgetRecall(widgetInstanceId: string) {
    this.conn?.send({
      type: "widget-recall",
      widgetInstanceId,
    } satisfies PeerMessage);
  }

  sendAlarmAdd(input: {
    name: string;
    notes?: string;
    trigger: import("../alarms/types").AlarmTrigger;
    onFire?: import("../alarms/types").AlarmFireAction[];
  }) {
    this.conn?.send({ type: "alarm-add", ...input } satisfies PeerMessage);
  }

  sendAlarmUpdate(
    id: string,
    patch: {
      name?: string;
      notes?: string;
      trigger?: import("../alarms/types").AlarmTrigger;
      onFire?: import("../alarms/types").AlarmFireAction[];
    },
  ) {
    this.conn?.send({
      type: "alarm-update",
      id,
      patch,
    } satisfies PeerMessage);
  }

  sendAlarmDelete(id: string) {
    this.conn?.send({ type: "alarm-delete", id } satisfies PeerMessage);
  }

  sendAlarmAcknowledge(id: string) {
    this.conn?.send({ type: "alarm-acknowledge", id } satisfies PeerMessage);
  }

  sendAlarmAckUnscheduledWarp() {
    this.conn?.send({
      type: "alarm-ack-unscheduled-warp",
    } satisfies PeerMessage);
  }

  sendNoteAdd(body: string) {
    this.conn?.send({ type: "note-add", body } satisfies PeerMessage);
  }
  sendNoteUpdate(id: string, body: string) {
    this.conn?.send({ type: "note-update", id, body } satisfies PeerMessage);
  }
  sendNoteDelete(id: string) {
    this.conn?.send({ type: "note-delete", id } satisfies PeerMessage);
  }
  sendNoteReorder(id: string, afterId: string | null) {
    this.conn?.send({
      type: "note-reorder",
      id,
      afterId,
    } satisfies PeerMessage);
  }

  sendAlarmWarpIntent(index: number) {
    this.conn?.send({
      type: "alarm-warp-intent",
      index,
    } satisfies PeerMessage);
  }

  sendTriggerArm(input: {
    dataKey: string;
    op: import("@gonogo/components").ThresholdOp;
    value: number;
    inputs: import("@gonogo/components").FrozenPlanInputs;
  }) {
    this.conn?.send({ type: "trigger-arm", ...input } satisfies PeerMessage);
  }

  sendTriggerCancel(id: string) {
    this.conn?.send({ type: "trigger-cancel", id } satisfies PeerMessage);
  }

  /**
   * Query a range of historical samples from the host's buffered store.
   * Resolves with columnar `{ t, v }` arrays; rejects with a short error
   * string if the host reports one or the connection drops first.
   */
  sendQueryRange(
    sourceId: string,
    key: string,
    tStart: number,
    tEnd: number,
    flightId?: string,
    timeoutMs = 10_000,
  ): Promise<{ t: number[]; v: unknown[] }> {
    if (!this.conn) {
      return Promise.reject(new Error("not connected"));
    }
    const requestId = safeRandomUuid();
    const pending = this.pendingQueries.track(
      requestId,
      timeoutMs,
      "queryRange timeout",
    );
    this.conn.send({
      type: "query-range-request",
      requestId,
      sourceId,
      key,
      tStart,
      tEnd,
      flightId,
    } satisfies PeerMessage);
    return pending;
  }

  /**
   * Station broker: ask the host to relay a kerbcam WebRTC offer to the sidecar
   * and return the answer. Pass as the `negotiate` seam to a station-side
   * KerbcamClient so it never needs the sidecar's address — media still flows
   * station↔sidecar directly off the answer's ICE candidates.
   */
  sendKerbcamNegotiate(
    offer: { sdp: string; cameras: number[]; slots?: number },
    timeoutMs = 15_000,
  ): Promise<{ sdp: string; cameras: number[] }> {
    if (!this.conn) {
      return Promise.reject(new Error("not connected"));
    }
    const requestId = safeRandomUuid();
    const pending = this.pendingKerbcamNegotiate.track(
      requestId,
      timeoutMs,
      "kerbcam negotiate timeout",
    );
    this.conn.send({
      type: "kerbcam-negotiate-request",
      requestId,
      offer,
    } satisfies PeerMessage);
    return pending;
  }

  private rejectPendingQueries(reason: string) {
    this.pendingQueries.rejectAll(reason);
    this.pendingKosExecutes.rejectAll(reason);
    this.pendingFlightRpc.rejectAll(reason);
    this.pendingKerbcamNegotiate.rejectAll(reason);
  }

  /**
   * Send a flight-history RPC to the host. Resolves with the typed result
   * the corresponding BufferedDataSource method returns; rejects with the
   * host's error string on failure or `flight-rpc timeout` after 15s.
   *
   * The 15s budget is generous because `op: "export"` packs every sample
   * for a flight into the response and a 30-minute Mun mission can be
   * several MB on the wire.
   *
   * Unlike `sendQueryRange`, waits up to 5s for the broker handshake to
   * complete before failing. FlightsManager often mounts a tick before
   * the PeerJS connection opens; without the wait, the very first
   * `listFlights()` after a station boot races the handshake and surfaces
   * an uncaught "not connected" rejection in the console.
   */
  async sendFlightRpc<T = unknown>(
    op: FlightRpcOp,
    timeoutMs = 15_000,
  ): Promise<T> {
    if (!this.conn) {
      try {
        await this.whenConnected(5_000);
      } catch {
        throw new Error("not connected");
      }
    }
    if (!this.conn) {
      throw new Error("not connected");
    }
    const requestId = safeRandomUuid();
    const pending = this.pendingFlightRpc.track(
      requestId,
      timeoutMs,
      "flight-rpc timeout",
    );
    this.conn.send({
      type: "flight-rpc-request",
      requestId,
      op,
    } satisfies PeerMessage);
    return pending as Promise<T>;
  }

  /**
   * Resolve when the next `connected` status fires, or reject after
   * `timeoutMs`. Returns immediately if already connected. Internal — most
   * callers should fail loudly rather than wait.
   */
  private whenConnected(timeoutMs: number): Promise<void> {
    if (this.conn) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let remove: (() => unknown) | null = null;
      const timer = setTimeout(() => {
        remove?.();
        reject(new Error("connection timeout"));
      }, timeoutMs);
      remove = this.connStatusListeners.add((status) => {
        if (status === "connected") {
          clearTimeout(timer);
          remove?.();
          resolve();
        }
      });
    });
  }

  /** Latest flight snapshot pushed by the host. Synchronous. */
  getCurrentFlight(): FlightRecord | null {
    return this.currentFlight;
  }

  /**
   * Notified on every host-side `flight-change` push. Fires immediately
   * after subscribe with the cached snapshot so subscribers don't have to
   * wait for the next transition.
   */
  onFlightChange(cb: (flight: FlightRecord | null) => void): () => void {
    const remove = this.flightChangeListeners.add(cb);
    cb(this.currentFlight);
    return remove;
  }

  /**
   * Notified whenever the host's persisted flight list could have changed
   * shape. Empty payload — subscribers re-query `listFlights()`. Mirrors
   * the local `BufferedDataSource.onFlightListChange` so FlightsManager
   * can subscribe identically on both screens.
   */
  onFlightListChange(cb: () => void): () => void {
    return this.flightListChangeListeners.add(cb);
  }

  /**
   * Tunnel a kOS compute script execution through to the host. The host
   * invokes its local KosDataSource.executeScript and replies with
   * the parsed [KOSDATA] object (or an error). Timeout defaults to 35s —
   * a shade longer than the host's own per-call timeout (which itself
   * needs slack for first-write managed dispatches) so the station
   * surfaces the real error rather than a timeout racing it.
   */
  sendKosExecute(
    cpu: string,
    script: string,
    args: KosScriptArg[],
    managed?: KosManagedScript,
    timeoutMs = 35_000,
  ): Promise<KosData> {
    if (!this.conn || this.conn.open === false) {
      return Promise.reject(new Error("not connected to host"));
    }
    const requestId = safeRandomUuid();
    const pending = this.pendingKosExecutes.track(
      requestId,
      timeoutMs,
      "kos execute timeout",
    );
    this.conn.send({
      type: "kos-execute-request",
      requestId,
      cpu,
      script,
      args,
      managed,
    } satisfies PeerMessage);
    return pending;
  }

  onData(
    cb: (sourceId: string, key: string, value: unknown, t: number) => void,
  ) {
    return this.dataListeners.add(cb);
  }

  onSourceStatus(cb: (sourceId: string, status: string) => void) {
    return this.sourceStatusListeners.add(cb);
  }

  onConnectionStatus(cb: (status: ConnStatus) => void) {
    return this.connStatusListeners.add(cb);
  }

  onSchema(cb: (sources: PeerSchemaSource[]) => void) {
    return this.schemaListeners.add(cb);
  }

  /**
   * Fires when the broker reports the configured host id as
   * `peer-unavailable` (i.e. nobody on the broker is registered with
   * that id right now). The connect screen uses this to swap the
   * generic "reconnecting…" copy for a specific "couldn't find that
   * code" message — the operator's most likely problem is a typo or a
   * stale main-screen tab.
   */
  onHostUnavailable(cb: (hostPeerId: string) => void) {
    return this.hostUnavailableListeners.add(cb);
  }

  /**
   * Fires when the host has broadcast a graceful share-code rotation
   * over the existing data channel. The service has already updated its
   * own reconnect target; subscribers (StationScreen) should persist the
   * new id to localStorage so a refresh after the rotation lands on the
   * new code rather than retrying the dead old one.
   */
  onHostPeerIdChange(cb: (newPeerId: string) => void) {
    return this.hostPeerIdChangeListeners.add(cb);
  }

  /**
   * Fires once per host-connect cycle when the host pushes its fog snapshot.
   * The station applies the masks to its local FogMaskStore so the map
   * reflects the host's exploration state.
   */
  onFogSnapshot(
    cb: (msg: Extract<PeerMessage, { type: "fog-snapshot" }>) => void,
  ) {
    return this.fogSnapshotListeners.add(cb);
  }

  onKosOpened(cb: (sessionId: string) => void) {
    return this.kosOpenedListeners.add(cb);
  }

  onKosData(cb: (sessionId: string, data: string) => void) {
    return this.kosDataListeners.add(cb);
  }

  onKosClose(cb: (sessionId: string) => void) {
    return this.kosCloseListeners.add(cb);
  }

  onGonogoCountdownStart(cb: (t0Ms: number) => void) {
    return this.gonogoCountdownStartListeners.add(cb);
  }

  onGonogoCountdownCancel(cb: (reason: string | undefined) => void) {
    return this.gonogoCountdownCancelListeners.add(cb);
  }

  onGonogoAbortNotify(cb: (stationName: string, t: number) => void) {
    return this.gonogoAbortNotifyListeners.add(cb);
  }

  onAlarmSnapshot(cb: (snap: import("../alarms/types").AlarmSnapshot) => void) {
    return this.alarmSnapshotListeners.add(cb);
  }

  onNotesSnapshot(cb: (snap: import("../notes/types").NotesSnapshot) => void) {
    return this.notesSnapshotListeners.add(cb);
  }

  onAlarmFired(cb: (fire: { id: string; name: string; ut: number }) => void) {
    return this.alarmFiredListeners.add(cb);
  }

  onTriggerSnapshot(
    cb: (snap: import("@gonogo/components").TriggerSnapshot) => void,
  ) {
    return this.triggerSnapshotListeners.add(cb);
  }

  /** For tests + DEBUG_PEER diagnostics — exposes listener Set sizes. */
  _listenerCounts() {
    return {
      data: this.dataListeners.size,
      sourceStatus: this.sourceStatusListeners.size,
      connStatus: this.connStatusListeners.size,
      schema: this.schemaListeners.size,
      kosOpened: this.kosOpenedListeners.size,
      kosData: this.kosDataListeners.size,
      kosClose: this.kosCloseListeners.size,
      fogSnapshot: this.fogSnapshotListeners.size,
    };
  }

  private readonly dispatcher = new MessageDispatcher<void>({
    hello: (msg) => {
      this.hostVersion = { version: msg.version, buildTime: msg.buildTime };
      const prevToken = this.hostSessionToken;
      this.hostSessionToken = msg.sessionToken ?? null;
      logger.info(
        `[PeerClient] host hello — v${msg.version} (build ${msg.buildTime})${msg.sessionToken ? ` session=${msg.sessionToken.slice(0, 8)}` : ""}`,
      );
      // Fire restart BEFORE hello so subscribers can clear state (and any
      // refs the hello handler reads) before the hello-driven resend
      // path runs. Tokenless hosts (pre-versioned bundle) skip the
      // restart event — legacy "always resend the current vote on hello"
      // stays the safe default for them.
      if (
        msg.sessionToken &&
        prevToken !== null &&
        prevToken !== msg.sessionToken
      ) {
        logger.info("[PeerClient] host session changed — restart detected");
        this.hostRestartListeners.fire();
      }
      this.hostHelloListeners.fire(this.hostVersion);
    },
    data: (msg) => {
      debugPeer("client handleMessage data", {
        sourceId: msg.sourceId,
        key: msg.key,
        dataListenerCount: this.dataListeners.size,
      });
      const t = msg.t ?? Date.now();
      this.dataListeners.fire(msg.sourceId, msg.key, msg.value, t);
    },
    "query-range-response": (msg) => {
      if (msg.error) {
        this.pendingQueries.reject(msg.requestId, new Error(msg.error));
      } else {
        this.pendingQueries.resolve(msg.requestId, { t: msg.t, v: msg.v });
      }
    },
    "kerbcam-negotiate-response": (msg) => {
      if (msg.error || !msg.answer) {
        this.pendingKerbcamNegotiate.reject(
          msg.requestId,
          new Error(msg.error ?? "no answer in kerbcam negotiate response"),
        );
      } else {
        this.pendingKerbcamNegotiate.resolve(msg.requestId, msg.answer);
      }
    },
    "flight-rpc-response": (msg) => {
      if (msg.error) {
        this.pendingFlightRpc.reject(msg.requestId, new Error(msg.error));
      } else {
        this.pendingFlightRpc.resolve(msg.requestId, msg.result);
      }
    },
    "flight-change": (msg) => {
      this.currentFlight = msg.flight;
      this.flightChangeListeners.fire(msg.flight);
    },
    "flight-list-changed": () => {
      this.flightListChangeListeners.fire();
    },
    "kos-execute-response": (msg) => {
      if (msg.error || !msg.data) {
        const message = msg.error ?? "kos execute: empty response";
        // Preserve the script-vs-infra discriminator across the peer
        // boundary — the breaker on the station side only counts
        // KosScriptError, same as on main.
        const err = msg.isScriptError
          ? new KosScriptError(message)
          : new Error(message);
        this.pendingKosExecutes.reject(msg.requestId, err);
      } else {
        this.pendingKosExecutes.resolve(msg.requestId, msg.data);
      }
    },
    status: (msg) => {
      this.sourceStatusListeners.fire(msg.sourceId, msg.status);
    },
    schema: (msg) => {
      logger.info(
        `[PeerClient] schema received — ${msg.sources.length} sources`,
      );
      this.schemaListeners.fire(msg.sources);
    },
    "kos-opened": (msg) => {
      this.kosOpenedListeners.fire(msg.sessionId);
    },
    "kos-data": (msg) => {
      this.kosDataListeners.fire(msg.sessionId, msg.data);
    },
    "kos-close": (msg) => {
      this.kosCloseListeners.fire(msg.sessionId);
    },
    "relay-peer-id": (msg) => {
      this.relayPeerId = msg.peerId;
      this.relayPeerIdListeners.fire(msg.peerId);
      // Carry the host's TURN credentials into the station's own Peer.
      // The station→relay camera channel is a separate peer.connect()
      // call from the station's Peer instance; without TURN the relay's
      // container-bridge candidates can't be reached from the LAN. See
      // the 2026-05-17 evening session — every camera attempt fired
      // `negotiation-failed` for this exact reason.
      if (msg.iceServers && msg.iceServers.length > 0) {
        this.applyRelayIceServers(msg.iceServers);
      }
    },
    "host-id-rotation": (msg) => {
      logger.info(
        `[PeerClient] host rotating id — new=${msg.newPeerId} reason=${msg.reason}`,
      );
      // Repoint reconnects at the new id *before* the host destroys the
      // channel a beat later. The conn's `close` event will fire shortly
      // afterwards and the retry loop calls openPeer(), which reads
      // `this.hostPeerId` afresh — no extra wiring needed there.
      this.hostPeerId = msg.newPeerId;
      logger.setIdentity({ hostPeerId: msg.newPeerId });
      this.hostPeerIdChangeListeners.fire(msg.newPeerId);
    },
    "fog-snapshot": (msg) => {
      this.fogSnapshotListeners.fire(msg);
    },
    "gonogo-countdown-start": (msg) => {
      this.gonogoCountdownStartListeners.fire(msg.t0Ms);
    },
    "gonogo-countdown-cancel": (msg) => {
      this.gonogoCountdownCancelListeners.fire(msg.reason);
    },
    "gonogo-abort-notify": (msg) => {
      this.gonogoAbortNotifyListeners.fire(msg.stationName, msg.t);
    },
    "alarm-snapshot": (msg) => {
      this.alarmSnapshotListeners.fire(msg.snapshot);
    },
    "notes-snapshot": (msg) => {
      this.notesSnapshotListeners.fire(msg.snapshot);
    },
    "alarm-fired": (msg) => {
      this.alarmFiredListeners.fire({
        id: msg.id,
        name: msg.name,
        ut: msg.ut,
      });
    },
    "trigger-snapshot": (msg) => {
      this.triggerSnapshotListeners.fire(msg.snapshot);
    },
  });

  private handleMessage(msg: PeerMessage) {
    this.dispatcher.dispatch(msg, undefined);
  }

  /**
   * Inject the host's relay iceServers into this station's Peer config.
   * Mirrors `PeerHostService.refreshIceConfig` — PeerJS doesn't expose a
   * public setter for `iceServers`, but `_options.config` is read every
   * time the Peer constructs an underlying RTCPeerConnection, so a fresh
   * `peer.connect()` for the camera channel picks up the new value.
   * Existing connections (the station→host data channel) keep their
   * already-negotiated ICE pair and aren't disturbed.
   */
  private applyRelayIceServers(iceServers: RTCIceServer[]): void {
    // Expose for the brokered kerbcam data source regardless of whether the
    // Peer is up yet — the kerbcam client reads these for its own connection.
    this.relayIceServers = iceServers;
    this.relayIceServersListeners.fire(iceServers);
    if (!this.peer) return;
    const opts = (
      this.peer as unknown as {
        _options?: { config?: { iceServers: RTCIceServer[] } };
      }
    )._options;
    if (opts) {
      opts.config = { iceServers };
      logger.info(
        `[PeerClient] applied ${iceServers.length} iceServer(s) from relay-peer-id broadcast — station→relay camera channel can now use TURN`,
      );
    }
  }

  /** Latest relay TURN creds the host has broadcast (empty until one arrives). */
  getRelayIceServers(): RTCIceServer[] {
    return this.relayIceServers;
  }

  /** Notified whenever the host broadcasts a fresh set of relay TURN creds. */
  onRelayIceServersChange(cb: (servers: RTCIceServer[]) => void): () => void {
    return this.relayIceServersListeners.add(cb);
  }

  /** Latest relay peer id the host has announced, or null if none. */
  getRelayPeerId(): string | null {
    return this.relayPeerId;
  }

  /**
   * Latest host version snapshot from the `hello` handshake. Null until the
   * first hello arrives (or if the host is on a pre-versioned bundle).
   */
  getHostVersion(): { version: string; buildTime: string } | null {
    return this.hostVersion;
  }

  /** Notified whenever a fresh `hello` arrives from the host. */
  onHostHello(
    cb: (info: { version: string; buildTime: string }) => void,
  ): () => void {
    return this.hostHelloListeners.add(cb);
  }

  /**
   * Notified when the host's session token changes — i.e. the host process
   * restarted between two connections. Used to clear station-local state
   * that would otherwise re-broadcast stale values on reconnect (e.g. a
   * GO vote that the operator left set before refreshing the main screen).
   * Does not fire on the first hello of a session, only when the token
   * actually changes.
   */
  onHostRestart(cb: () => void): () => void {
    return this.hostRestartListeners.add(cb);
  }

  /**
   * Notified every time the host announces a new relay peer id (including
   * null → relay is down).
   */
  onRelayPeerIdChange(cb: (peerId: string | null) => void): () => void {
    return this.relayPeerIdListeners.add(cb);
  }

  /**
   * Resolves with the station's own Peer instance once the broker handshake
   * completes. Used by OcislyStreamSource on stations so it can open an
   * outgoing data channel + accept media calls directly from the proxy.
   */
  waitForPeer(): Promise<Peer> {
    if (this.peer?.open) return Promise.resolve(this.peer);
    return new Promise<Peer>((resolve) => {
      const tick = () => {
        if (this.peer?.open) {
          resolve(this.peer);
        } else {
          setTimeout(tick, 50);
        }
      };
      tick();
    });
  }

  disconnect() {
    this.retryPolicy.cancel();
    this.tearDownPeer();
    this.rejectPendingQueries("peer client disconnected");
    this.hostPeerId = null;
    // Clear the reconnect target so any in-flight share-code resolve bails
    // when it lands (it checks `this.shareCode` hasn't changed).
    this.shareCode = null;
    logger.info("[PeerClient] disconnected");
  }
}
