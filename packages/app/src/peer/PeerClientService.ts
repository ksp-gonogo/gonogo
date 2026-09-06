import { safeRandomUuid } from "@ksp-gonogo/core";
import type { FlightRecord } from "@ksp-gonogo/data";
import { debugPeer, logger } from "@ksp-gonogo/logger";
import Peer, { type DataConnection } from "peerjs";
import { radioFrameFromWire } from "../commcast/radio/wire";
import { deriveHostPeerId } from "./hostPeerId";
import { attachIceDiagnostics } from "./iceDiagnostics";
import { MessageDispatcher } from "./MessageDispatcher";
import { peerBrokerOptions } from "./peerOptions";
import type { FlightRpcOp, PeerMessage, PeerSchemaSource } from "./protocol";
import { RequestTracker } from "./RequestTracker";
import { RetryPolicy } from "./RetryPolicy";
import { getStationKey, getStationPeerId } from "./stationPeerId";
import { TypedListeners } from "./typedListeners";

export type ConnStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

const DEFAULT_RETRY_INTERVAL_MS = 2_000;
const DEFAULT_RETRY_TIMEOUT_MS = 5 * 60 * 1000;

/** PeerJS error shape: `.type` is the discriminator. */
interface PeerJsError extends Error {
  type?: string;
}

function isPeerJsError(e: unknown): e is PeerJsError {
  return e instanceof Error && typeof (e as PeerJsError).type === "string";
}

/**
 * peer-unavailable carries the missing peer id in the message
 * (`Could not connect to peer XYZ`; see peerjs `bundler.mjs:1575`).
 * Match exactly so auxiliary connects (OCISLY proxy etc.) don't
 * masquerade as a host outage, and so a host id that's a substring of
 * some other peer id can't false-positive either.
 */
const PEER_UNAVAILABLE_PREFIX = "Could not connect to peer ";

/**
 * PeerJS error types that mean "this browser never reached the broker",
 * as opposed to "the broker answered and the host isn't there".
 *
 * The distinction is the whole diagnosis on the connect screen. Both ends
 * meet by name on a PeerJS broker that lives on the internet, so a station
 * on an offline LAN, a guest network with no outbound, or a captive portal
 * fails here and NOT at the host, and the advice ("check the code, check
 * the main screen") for the other case is wrong for this one.
 */
const BROKER_ERROR_TYPES = new Set([
  "network",
  "server-error",
  "socket-error",
  "socket-closed",
  "ssl-unavailable",
]);

function isMissingHost(err: PeerJsError, hostPeerId: string | null): boolean {
  if (!hostPeerId) return true;
  if (!err.message.startsWith(PEER_UNAVAILABLE_PREFIX)) return false;
  const target = err.message.slice(PEER_UNAVAILABLE_PREFIX.length);
  return target === hostPeerId;
}

/** Re-exported at its historical home so existing importers keep working. */
export { attachIceDiagnostics };

export interface PeerClientOptions {
  retryIntervalMs?: number;
  retryTimeoutMs?: number;
  /**
   * Explicit PeerJS id for this station. Defaults to the persistent
   * localStorage-backed id from `getStationPeerId()`. Override for tests.
   */
  peerId?: string;
}

/**
 * Argument-tuple map for the station's `TypedListeners` registry, the
 * client-side analog of `HostEventMap`. Each key mirrors what the former
 * per-field `ListenerSet<[...]>` fired; the dispatcher handlers still derive
 * these args, so swapping `.fire`/`.add` for `emit`/`on` is behaviour-
 * preserving. Several keys (`connStatus`, `hostRestart`, `flightChange`,
 * `hostUnavailable`, `relayIceServers`, ...) aren't wire messages.
 */
type ClientEventMap = {
  data: [sourceId: string, key: string, value: unknown, t: number];
  sourceStatus: [sourceId: string, status: string];
  connStatus: [status: ConnStatus];
  schema: [sources: PeerSchemaSource[]];
  relayPeerId: [peerId: string | null];
  relayIceServers: [servers: RTCIceServer[]];
  hostHello: [info: { version: string; buildTime: string }];
  hostRestart: [];
  gonogoCountdownStart: [t0Ms: number];
  gonogoCountdownCancel: [reason: string | undefined];
  alarmSnapshot: [snap: import("../alarms/types").AlarmSnapshot];
  alarmFired: [fire: { id: string; name: string; ut: number }];
  triggerSnapshot: [snap: import("@ksp-gonogo/components").TriggerSnapshot];
  notesSnapshot: [snap: import("../notes/types").NotesSnapshot];
  commcastTransmit: [msg: import("../commcast/types").CommsMessage];
  commcastAck: [ack: import("../commcast/types").CommsAck];
  commcastRadio: [frame: import("../commcast/radio/wire").RadioFrame];
  gonogoAbortNotify: [stationName: string, t: number];
  analyticsConsent: [enabled: boolean];
  flightChange: [flight: FlightRecord | null];
  flightListChange: [];
  hostUnavailable: [hostPeerId: string];
  brokerReachable: [reachable: boolean];
  coverageSnapshot: [msg: Extract<PeerMessage, { type: "fog-snapshot" }>];
  // Sitrep telemetry-stream forwarding: see protocol.ts's `sitrep-frame`/
  // `sitrep-command-*` doc comment. `sitrepFrame` carries the host-relayed
  // `ServerMessage` verbatim (unwrapped from its `sitrep-frame` envelope);
  // the command-response/error pair is kept split (not pre-synthesized into
  // a `ServerMessage` here) because that synthesis is `PeerTransport`'s job,
  // this service only forwards the wire fields it received.
  sitrepFrame: [message: import("@ksp-gonogo/sitrep-sdk").ServerMessage];
  sitrepCommandResponse: [
    requestId: string,
    result: unknown,
    meta: import("@ksp-gonogo/sitrep-sdk").Meta,
  ];
  sitrepCommandError: [requestId: string, code: string, message: string];
};

export class PeerClientService {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  /** The host's broker peer id, derived from the operator-typed share-code
   *  (`gonogo-host-<CODE>`) in `connect()`. Stable across the session and
   *  read by `openPeer()` as the reconnect target, a host that refreshed
   *  and re-claimed the same derived id is reconnected to transparently. */
  private hostPeerId: string | null = null;
  /** Fresh per `openPeer()` call. Reusing the same id across retries
   *  collides with the broker's id-hold (~30–60 s) when a previous
   *  connection didn't shut down gracefully: e.g. a mid-session WS
   *  drop. Regenerating dodges that entirely. */
  private stationPeerId: string;
  private readonly stationKey: string;
  /** Override id supplied via constructor opts, used by tests. When set,
   *  every `openPeer()` reuses it; when null we re-roll on each call. */
  private readonly fixedPeerIdOverride: string | null;
  private readonly retryPolicy: RetryPolicy;

  /** Single typed event registry replacing the former ~24 hand-rolled
   *  `ListenerSet` fields. The `onX` methods wrap `events.on("x", cb)` and
   *  the dispatcher fires via `events.emit("x", ...)`, preserving the public
   *  API and listener-invocation order. */
  private readonly events = new TypedListeners<ClientEventMap>();

  // Current connection status, tracked alongside the `connStatus` event so
  // a caller that constructs a listener AFTER the last transition (e.g.
  // `PeerTransport`, built once the station is already `connected`) can
  // read a synchronous snapshot instead of waiting for the next event.
  private connStatus: ConnStatus = "idle";
  /** Last broker-reachability verdict; `null` until the first attempt resolves. */
  private brokerReachable: boolean | null = null;
  private relayPeerId: string | null = null;
  // Relay TURN creds from the latest `relay-peer-id` broadcast. Applied to the
  // station's own Peer (see applyRelayIceServers) AND exposed here so a brokered
  // camera data source can feed them to its station↔sidecar PeerConnection,
  // a path separate from PeerJS. Empty until the first broadcast carrying creds.
  private relayIceServers: RTCIceServer[] = [];
  private hostVersion: { version: string; buildTime: string } | null = null;
  private hostSessionToken: string | null = null;
  // Host's technical-analytics consent. Stations follow the host, they
  // never read a local value. Cached so a late subscriber gets the current
  // state on subscribe. Privacy-first default: disabled until the first
  // `analytics-consent` message lands.
  private analyticsConsent = false;

  private pendingQueries = new RequestTracker<{
    t: number[];
    v: unknown[];
  }>();
  private pendingFlightRpc = new RequestTracker<unknown>();
  private pendingUplinkRelay = new RequestTracker<unknown>();
  // D6: the Uplink bundle-byte conduit. Tracked separately (its own typed
  // map) because the resolved value shape (raw bytes) differs from every
  // other RequestTracker on this class: see sendBundleFetch.
  private pendingBundleFetch = new RequestTracker<Uint8Array>();

  // Cached current flight pushed by the host. Updated on every `flight-change`
  // message, including the initial snapshot the host sends on connect open.
  // Stations read this synchronously through `getCurrentFlight()`; the modal
  // useFlight hook subscribes via `onFlightChange`.
  private currentFlight: FlightRecord | null = null;

  // Sticky cache for the running countdown. `gonogo-countdown-start` is a
  // fire-and-forget broadcast: a GoNoGo widget that subscribes after the
  // message landed (page still mounting, layout switch, widget remount)
  // would otherwise miss the countdown entirely and show nothing until T-0
  // flipped the launch state via telemetry, which is what an operator seeing
  // only T-0 is reporting. Replayed to late subscribers while t0 is still in
  // the future; cleared on cancel.
  private lastCountdownT0Ms: number | null = null;

  constructor({
    retryIntervalMs = DEFAULT_RETRY_INTERVAL_MS,
    retryTimeoutMs = DEFAULT_RETRY_TIMEOUT_MS,
    peerId,
  }: PeerClientOptions = {}) {
    this.fixedPeerIdOverride = peerId ?? null;
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
      // Always read the *current* peer id, a closure capture of the
      // initial value would log a stale id after the first regeneration.
      stationPeerId: () => this.stationPeerId,
      hostPeerId: () => this.hostPeerId,
      tearDown: () => this.tearDownPeer(),
      rejectPending: (reason) => this.rejectPendingQueries(reason),
      emitStatus: (status) => this.emitConnStatus(status),
      // Re-open the Peer on each reconnect. The host's derived id is
      // re-derived from the (unchanged) share code inside the Peer's `open`
      // handler, so a host that refreshed and re-claimed the same id is
      // reconnected to transparently.
      reopen: () => this.openPeer(),
    });
  }

  connect(code: string) {
    // `code` is the operator-typed share code. Derive the host's broker peer
    // id (`gonogo-host-<CODE>`) once and hold it as the reconnect target.
    this.hostPeerId = deriveHostPeerId(code);
    logger.setIdentity({ hostPeerId: this.hostPeerId });
    this.retryPolicy.beginConnect();
    this.openPeer();
  }

  /**
   * Open this station's Peer, then connect straight to the host's derived
   * id once the broker handshake completes (inside `peer.on("open")`).
   * There's no resolve hop: the target is `gonogo-host-<shareCode>`, known
   * synchronously from the typed code.
   */
  private openPeer() {
    if (!this.hostPeerId) return;
    // Re-roll the per-session id so retries can't collide with a broker
    // hold from a previous attempt that dropped without sending a
    // graceful leave (mid-session WS drop, screen lock, tab background).
    if (!this.fixedPeerIdOverride) {
      this.stationPeerId = getStationPeerId();
    }
    logger.info(
      `[PeerClient] opening peer as ${this.stationPeerId}` +
        (this.hostPeerId
          ? ` (host=${this.hostPeerId})`
          : " (resolving host...)"),
    );
    this.emitConnStatus("connecting");
    // Stations construct their Peer with no ICE config. The host's
    // relay candidates flow in via the broker as part of the offer's
    // ICE-candidate exchange: that's enough for one-side TURN to
    // bridge difficult networks. Configuring local TURN here would
    // require the station to know the relay's URL, which it doesn't,
    // and previous defaults (`turn:localhost:3478`) actively broke
    // mobile clients.
    //
    // `key: "gonogo"` puts the station in our private namespace on the
    // public broker. MUST match PeerHostService, a station with a different
    // key is invisible to the host on the broker even if the ids match.
    this.peer = new Peer(this.stationPeerId, peerBrokerOptions());
    this.peer.on("open", () => {
      // Reaching `open` means the broker answered and holds our id, so any
      // earlier "can't reach the broker" verdict is stale.
      this.setBrokerReachable(true);
      this.connectToHost();
    });
    this.peer.on("error", (err) => {
      // Classify BEFORE the peer-unavailable branches below: a broker we
      // never reached is a different fault from a host that isn't there,
      // and only this branch can tell the operator which one they have.
      if (isPeerJsError(err) && BROKER_ERROR_TYPES.has(err.type ?? "")) {
        this.setBrokerReachable(false);
      }
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
      // while the host stays missing: listeners debounce as they like.
      if (
        isPeerJsError(err) &&
        err.type === "peer-unavailable" &&
        this.hostPeerId
      ) {
        this.events.emit("hostUnavailable", this.hostPeerId);
      }
      this.retryPolicy.handlePeerError(err);
    });
  }

  /** Open the data channel to the host's derived id. Requires the Peer to
   *  be open and `hostPeerId` set. */
  private connectToHost(): void {
    if (!this.peer || !this.hostPeerId) return;
    logger.info(`[PeerClient] connecting to host=${this.hostPeerId}`);
    this.conn = this.peer.connect(this.hostPeerId);
    attachIceDiagnostics(this.conn, () => {
      // The host's peer can die without peerjs ever firing `close` (abrupt
      // pagehide on host refresh). This is the line that ships to Axiom to
      // mark the ICE/PC-driven reconnect. handleUnexpectedClose() is
      // idempotent, so racing the `conn.on("close")` path is harmless.
      logger.warn(
        "[PeerClient] host connection lost (ICE/PC dead): reconnecting",
      );
      this.retryPolicy.handleUnexpectedClose();
    });
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
    this.connStatus = status;
    this.events.emit("connStatus", status);
  }

  sendExecute(sourceId: string, action: string) {
    logger.info(`[PeerClient] execute: source=${sourceId} action=${action}`);
    this.conn?.send({
      type: "execute",
      sourceId,
      action,
    } satisfies PeerMessage);
  }

  sendStationInfo(
    name: string,
    info?: {
      version?: string;
      buildTime?: string;
      seat?: import("@ksp-gonogo/sitrep-sdk/spine").Seat;
    },
  ) {
    this.conn?.send({
      type: "station-info",
      name,
      stationKey: this.stationKey,
      ...(info?.version ? { version: info.version } : {}),
      ...(info?.buildTime ? { buildTime: info.buildTime } : {}),
      /*
       * Omitted rather than sent as the default, matching this message's
       * existing back-compat posture: absence already means mission control,
       * so a client that predates the pilot seat needs no change.
       */
      ...(info?.seat && info.seat !== "mission-control"
        ? { seat: info.seat }
        : {}),
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

  /**
   * Speak into the shared thread. The author's own seat and stationKey go on
   * the wire beside the body: the seat is what the host and every recipient
   * compute the reveal from, and it is exactly what has not arrived yet when
   * a peer connects and talks in the same breath.
   *
   * `conn?` means a send while disconnected is DROPPED, not queued, the same
   * as every other client send in this file. The thread surfaces that rather
   * than pretending: see the widget's disconnected state.
   */
  sendCommcastMessage(msg: import("../commcast/types").CommsMessage) {
    this.conn?.send({ type: "commcast-transmit", msg } satisfies PeerMessage);
  }

  sendCommcastAck(ack: import("../commcast/types").CommsAck) {
    this.conn?.send({ type: "commcast-ack", ack } satisfies PeerMessage);
  }

  sendCommcastRadio(frame: import("../commcast/radio/wire").RadioFrame) {
    this.conn?.send({ type: "commcast-radio", frame } satisfies PeerMessage);
  }

  sendAlarmWarpIntent(index: number) {
    this.conn?.send({
      type: "alarm-warp-intent",
      index,
    } satisfies PeerMessage);
  }

  sendTriggerArm(input: {
    dataKey: string;
    op: import("@ksp-gonogo/components").ThresholdOp;
    value: number;
    inputs: import("@ksp-gonogo/components").FrozenPlanInputs;
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
   * Ask the host to relay a single call through to whatever handle an
   * Uplink registered for `uplinkId` (via `registerUplinkHandle` on the
   * host: see `@ksp-gonogo/core`). ONE generic send serves every Uplink
   * rather than a hardcoded method each; each Uplink's own client code owns
   * the shape of `method`/`args`/the resolved result.
   */
  sendUplinkRelay(
    uplinkId: string,
    method: string,
    args: unknown,
    timeoutMs = 15_000,
  ): Promise<unknown> {
    if (!this.conn) {
      return Promise.reject(new Error("not connected"));
    }
    const requestId = safeRandomUuid();
    const pending = this.pendingUplinkRelay.track(
      requestId,
      timeoutMs,
      `uplink relay timeout (${uplinkId}.${method})`,
    );
    this.conn.send({
      type: "uplink-relay-request",
      requestId,
      uplinkId,
      method,
      args,
    } satisfies PeerMessage);
    return pending;
  }

  /**
   * D6: ask the host to fetch+verify an Uplink bundle's bytes and relay
   * them back over the data channel: the station-side half of the
   * "main screen downloads once, stations pull from it" split (see
   * protocol.ts's `uplink-bundle-request`/`-response` doc comment). Never
   * fetches `bundleUrl` itself; a station has no route to an author host.
   *
   * Resolves with the verified `ArrayBuffer` (converted from the wire's
   * `Uint8Array`: see the dispatcher entry below) so this method is a
   * drop-in for the loader's `LoaderContext.fetchBytes` seam once wrapped
   * by `../uplinks/peerBundleFetch.ts`'s `createPeerBundleFetcher`.
   * Rejects on a hash mismatch, a host-side fetch failure, a timeout, or
   * the connection dropping mid-request: same shape as `sendUplinkRelay`.
   *
   * 30s default timeout: a bundle download can be materially larger than a
   * single RPC round-trip (the host fetches the WHOLE file before
   * replying), so this gets a longer budget than `sendUplinkRelay`'s 15s.
   */
  sendBundleFetch(
    bundleUrl: string,
    expectedHash: string,
    timeoutMs = 30_000,
  ): Promise<ArrayBuffer> {
    if (!this.conn) {
      return Promise.reject(new Error("not connected"));
    }
    const requestId = safeRandomUuid();
    const pending = this.pendingBundleFetch.track(
      requestId,
      timeoutMs,
      `bundle fetch timeout (${bundleUrl})`,
    );
    this.conn.send({
      type: "uplink-bundle-request",
      requestId,
      bundleUrl,
      expectedHash,
    } satisfies PeerMessage);
    return pending.then((bytes) => {
      // `.slice()` copies into a fresh, exactly-sized ArrayBuffer, the
      // wire's Uint8Array may be a view into a larger decode buffer
      // (PeerJS's BinaryPack), and the loader's sha256Hex re-verification
      // needs the EXACT bytes, nothing extra either side.
      const copy = bytes.slice();
      return copy.buffer as ArrayBuffer;
    });
  }

  // ── Sitrep telemetry-stream forwarding ───────────────────────────────────
  //
  // `PeerTransport` (packages/app/src/telemetry/PeerTransport.ts) is the sole
  // consumer of these three: it wraps them into the `Transport` interface
  // `@ksp-gonogo/sitrep-client` expects. No `RequestTracker` is needed for
  // the command round trip: `TelemetryClient.dispatch` already keeps its own
  // `requestId -> pending` map, so this service just needs to forward the
  // wire fields verbatim and let `PeerTransport` re-synthesize a bare
  // `ServerMessage` for `TelemetryClient.handleMessage` to correlate.

  /** Every `sitrep-frame` the host relays, unwrapped to the raw `ServerMessage` it carries. */
  onSitrepFrame(
    cb: (message: import("@ksp-gonogo/sitrep-sdk").ServerMessage) => void,
  ): () => void {
    return this.events.on("sitrepFrame", cb);
  }

  /** A `sitrep-command-response` for a command this station dispatched. */
  onSitrepCommandResponse(
    cb: (
      requestId: string,
      result: unknown,
      meta: import("@ksp-gonogo/sitrep-sdk").Meta,
    ) => void,
  ): () => void {
    return this.events.on("sitrepCommandResponse", cb);
  }

  /** A `sitrep-command-error` for a command this station dispatched. */
  onSitrepCommandError(
    cb: (requestId: string, code: string, message: string) => void,
  ): () => void {
    return this.events.on("sitrepCommandError", cb);
  }

  /**
   * Forward a `TelemetryClient.dispatch()` command-request to the host over
   * PeerJS. `requestId` is the STATION's own `TelemetryClient`-minted id
   * (the `cN` counter): reused as-is for the PeerJS correlation key rather
   * than minting a second one; see protocol.ts's `sitrep-command-request`
   * doc comment for why that's safe (the host always replies per-connection,
   * never broadcast). Fire-and-forget on the wire: `TelemetryClient` itself
   * owns the pending-promise bookkeeping and any loss-inference timeout, not
   * this service.
   */
  sendSitrepCommand(
    requestId: string,
    command: string,
    args: unknown,
    label: string,
    topic: string,
    vantage?: string,
  ): void {
    this.conn?.send({
      type: "sitrep-command-request",
      requestId,
      command,
      label,
      topic,
      vantage,
      args,
    } satisfies PeerMessage);
  }

  /**
   * Tell the host this station is reading `topic`, so it holds a matching
   * subscription on its own client. Silently does nothing with no live
   * connection: `PeerTransport` re-sends its whole live set on every fresh
   * connection, so an intent formed while the link was down is not lost.
   */
  sendSitrepSubscribe(topic: string): void {
    this.conn?.send({
      type: "sitrep-subscribe",
      topic,
    } satisfies PeerMessage);
  }

  /** The release half of {@link sendSitrepSubscribe}. */
  sendSitrepUnsubscribe(topic: string): void {
    this.conn?.send({
      type: "sitrep-unsubscribe",
      topic,
    } satisfies PeerMessage);
  }

  private rejectPendingQueries(reason: string) {
    this.pendingQueries.rejectAll(reason);
    this.pendingFlightRpc.rejectAll(reason);
    this.pendingUplinkRelay.rejectAll(reason);
    this.pendingBundleFetch.rejectAll(reason);
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
   * `timeoutMs`. Returns immediately if already connected. Internal, most
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
      remove = this.events.on("connStatus", (status) => {
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
    const remove = this.events.on("flightChange", cb);
    cb(this.currentFlight);
    return remove;
  }

  /**
   * Notified whenever the host's persisted flight list could have changed
   * shape. Empty payload: subscribers re-query `listFlights()`. Mirrors
   * the local `BufferedDataSource.onFlightListChange` so FlightsManager
   * can subscribe identically on both screens.
   */
  onFlightListChange(cb: () => void): () => void {
    return this.events.on("flightListChange", cb);
  }

  onData(
    cb: (sourceId: string, key: string, value: unknown, t: number) => void,
  ) {
    return this.events.on("data", cb);
  }

  onSourceStatus(cb: (sourceId: string, status: string) => void) {
    return this.events.on("sourceStatus", cb);
  }

  onConnectionStatus(cb: (status: ConnStatus) => void) {
    return this.events.on("connStatus", cb);
  }

  onSchema(cb: (sources: PeerSchemaSource[]) => void) {
    return this.events.on("schema", cb);
  }

  /**
   * Fires when the broker reports the configured host id as
   * `peer-unavailable` (i.e. nobody on the broker is registered with
   * that id right now). The connect screen uses this to swap the
   * generic "reconnecting..." copy for a specific "couldn't find that
   * code" message: the operator's most likely problem is a typo or a
   * stale main-screen tab.
   */
  onHostUnavailable(cb: (hostPeerId: string) => void) {
    return this.events.on("hostUnavailable", cb);
  }

  /**
   * Fires with `false` when this browser cannot reach the PeerJS broker at
   * all, and with `true` once it does. Distinct from `onHostUnavailable`:
   * that one means the broker answered and nobody holds the host's id.
   *
   * Replays the last verdict on subscribe, so a listener that mounts after
   * the first failed attempt still sees it.
   */
  onBrokerReachable(cb: (reachable: boolean) => void) {
    const unsub = this.events.on("brokerReachable", cb);
    if (this.brokerReachable !== null) cb(this.brokerReachable);
    return unsub;
  }

  /** Emit only on a change, so a retry loop doesn't re-notify every 2s. */
  private setBrokerReachable(reachable: boolean): void {
    if (this.brokerReachable === reachable) return;
    this.brokerReachable = reachable;
    if (!reachable) {
      logger.warn(
        "[PeerClient] cannot reach the PeerJS broker: this device needs internet access to join a session",
      );
    }
    this.events.emit("brokerReachable", reachable);
  }

  /**
   * Fires once per host-connect cycle when the host pushes its coverage snapshot.
   * The station applies the masks to its local CoverageMaskStore so the map
   * reflects the host's exploration state.
   */
  onCoverageSnapshot(
    cb: (msg: Extract<PeerMessage, { type: "fog-snapshot" }>) => void,
  ) {
    return this.events.on("coverageSnapshot", cb);
  }

  onGonogoCountdownStart(cb: (t0Ms: number) => void) {
    const unsub = this.events.on("gonogoCountdownStart", cb);
    // Replay a countdown that's already running to late subscribers, a
    // widget that mounts mid-countdown would otherwise show nothing until
    // T-0. Stale entries (t0 already passed) are not replayed; the launch
    // state takes over from telemetry at that point.
    const t0Ms = this.lastCountdownT0Ms;
    if (t0Ms !== null && t0Ms > Date.now()) {
      queueMicrotask(() => cb(t0Ms));
    }
    return unsub;
  }

  onGonogoCountdownCancel(cb: (reason: string | undefined) => void) {
    return this.events.on("gonogoCountdownCancel", cb);
  }

  onGonogoAbortNotify(cb: (stationName: string, t: number) => void) {
    return this.events.on("gonogoAbortNotify", cb);
  }

  onAlarmSnapshot(cb: (snap: import("../alarms/types").AlarmSnapshot) => void) {
    return this.events.on("alarmSnapshot", cb);
  }

  onNotesSnapshot(cb: (snap: import("../notes/types").NotesSnapshot) => void) {
    return this.events.on("notesSnapshot", cb);
  }

  onCommcastTransmit(
    cb: (msg: import("../commcast/types").CommsMessage) => void,
  ) {
    return this.events.on("commcastTransmit", cb);
  }

  onCommcastAck(cb: (ack: import("../commcast/types").CommsAck) => void) {
    return this.events.on("commcastAck", cb);
  }

  onCommcastRadio(
    cb: (frame: import("../commcast/radio/wire").RadioFrame) => void,
  ) {
    return this.events.on("commcastRadio", cb);
  }

  onAlarmFired(cb: (fire: { id: string; name: string; ut: number }) => void) {
    return this.events.on("alarmFired", cb);
  }

  onTriggerSnapshot(
    cb: (snap: import("@ksp-gonogo/components").TriggerSnapshot) => void,
  ) {
    return this.events.on("triggerSnapshot", cb);
  }

  /** For tests + DEBUG_PEER diagnostics: exposes listener Set sizes. */
  _listenerCounts() {
    return {
      data: this.events.size("data"),
      sourceStatus: this.events.size("sourceStatus"),
      connStatus: this.events.size("connStatus"),
      schema: this.events.size("schema"),
      coverageSnapshot: this.events.size("coverageSnapshot"),
    };
  }

  private readonly dispatcher = new MessageDispatcher<void>({
    hello: (msg) => {
      this.hostVersion = { version: msg.version, buildTime: msg.buildTime };
      const prevToken = this.hostSessionToken;
      this.hostSessionToken = msg.sessionToken ?? null;
      logger.info(
        `[PeerClient] host hello: v${msg.version} (build ${msg.buildTime})${msg.sessionToken ? ` session=${msg.sessionToken.slice(0, 8)}` : ""}`,
      );
      // Fire restart BEFORE hello so subscribers can clear state (and any
      // refs the hello handler reads) before the hello-driven resend
      // path runs. Tokenless hosts (pre-versioned bundle) skip the
      // restart event: legacy "always resend the current vote on hello"
      // stays the safe default for them.
      if (
        msg.sessionToken &&
        prevToken !== null &&
        prevToken !== msg.sessionToken
      ) {
        logger.info("[PeerClient] host session changed: restart detected");
        this.events.emit("hostRestart");
      }
      this.events.emit("hostHello", this.hostVersion);
    },
    data: (msg) => {
      debugPeer("client handleMessage data", {
        sourceId: msg.sourceId,
        key: msg.key,
        dataListenerCount: this.events.size("data"),
      });
      const t = msg.t ?? Date.now();
      this.events.emit("data", msg.sourceId, msg.key, msg.value, t);
    },
    "query-range-response": (msg) => {
      if (msg.error) {
        this.pendingQueries.reject(msg.requestId, new Error(msg.error));
      } else {
        this.pendingQueries.resolve(msg.requestId, { t: msg.t, v: msg.v });
      }
    },
    "uplink-relay-response": (msg) => {
      if (msg.error) {
        // Attach errorMeta (e.g. a script-author-fault flag) as a plain
        // `.meta` property so the calling Uplink's own client code can read
        // it back without the peer layer having to know its shape.
        this.pendingUplinkRelay.reject(
          msg.requestId,
          Object.assign(new Error(msg.error), { meta: msg.errorMeta }),
        );
      } else {
        this.pendingUplinkRelay.resolve(msg.requestId, msg.result);
      }
    },
    "uplink-bundle-response": (msg) => {
      if (msg.error) {
        this.pendingBundleFetch.reject(msg.requestId, new Error(msg.error));
      } else if (msg.bytes) {
        this.pendingBundleFetch.resolve(msg.requestId, msg.bytes);
      } else {
        // Neither `bytes` nor `error`: a malformed response the host
        // should never actually send (handleUplinkBundleRequest always
        // sets one or the other), but rejecting with a clear reason beats
        // leaving the request pending until it times out.
        this.pendingBundleFetch.reject(
          msg.requestId,
          new Error("uplink-bundle-response carried neither bytes nor error"),
        );
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
      this.events.emit("flightChange", msg.flight);
    },
    "flight-list-changed": () => {
      this.events.emit("flightListChange");
    },
    status: (msg) => {
      this.events.emit("sourceStatus", msg.sourceId, msg.status);
    },
    schema: (msg) => {
      logger.info(
        `[PeerClient] schema received: ${msg.sources.length} sources`,
      );
      this.events.emit("schema", msg.sources);
    },
    "relay-peer-id": (msg) => {
      this.relayPeerId = msg.peerId;
      this.events.emit("relayPeerId", msg.peerId);
      // Carry the host's TURN credentials into the station's own Peer.
      // The station→relay camera channel is a separate peer.connect()
      // call from the station's Peer instance; without TURN the relay's
      // container-bridge candidates can't be reached from the LAN. See
      // the 2026-05-17 evening session: every camera attempt fired
      // `negotiation-failed` for this exact reason.
      if (msg.iceServers && msg.iceServers.length > 0) {
        this.applyRelayIceServers(msg.iceServers);
      }
    },
    "fog-snapshot": (msg) => {
      this.events.emit("coverageSnapshot", msg);
    },
    "gonogo-countdown-start": (msg) => {
      this.lastCountdownT0Ms = msg.t0Ms;
      this.events.emit("gonogoCountdownStart", msg.t0Ms);
    },
    "gonogo-countdown-cancel": (msg) => {
      this.lastCountdownT0Ms = null;
      this.events.emit("gonogoCountdownCancel", msg.reason);
    },
    "gonogo-abort-notify": (msg) => {
      this.events.emit("gonogoAbortNotify", msg.stationName, msg.t);
    },
    "alarm-snapshot": (msg) => {
      this.events.emit("alarmSnapshot", msg.snapshot);
    },
    "notes-snapshot": (msg) => {
      this.events.emit("notesSnapshot", msg.snapshot);
    },
    "commcast-transmit": (msg) => {
      this.events.emit("commcastTransmit", msg.msg);
    },
    "commcast-ack": (msg) => {
      this.events.emit("commcastAck", msg.ack);
    },
    "commcast-radio": (msg) => {
      // `radioFrameFromWire`, because BinaryPack delivers the chunk's audio as
      // an `ArrayBuffer` where a `Uint8Array` went in. Undone at the boundary
      // it changed at, so nothing downstream has to know it ever did.
      this.events.emit("commcastRadio", radioFrameFromWire(msg.frame));
    },
    "alarm-fired": (msg) => {
      this.events.emit("alarmFired", {
        id: msg.id,
        name: msg.name,
        ut: msg.ut,
      });
    },
    "trigger-snapshot": (msg) => {
      this.events.emit("triggerSnapshot", msg.snapshot);
    },
    "analytics-consent": (msg) => {
      this.analyticsConsent = msg.enabled;
      logger.info(
        `[PeerClient] host analytics consent: ${msg.enabled ? "enabled" : "disabled"}`,
      );
      this.events.emit("analyticsConsent", msg.enabled);
    },
    "sitrep-frame": (msg) => {
      this.events.emit("sitrepFrame", msg.message);
    },
    "sitrep-command-response": (msg) => {
      this.events.emit(
        "sitrepCommandResponse",
        msg.requestId,
        msg.result,
        msg.meta,
      );
    },
    "sitrep-command-error": (msg) => {
      this.events.emit(
        "sitrepCommandError",
        msg.requestId,
        msg.code,
        msg.message,
      );
    },
  });

  private handleMessage(msg: PeerMessage) {
    this.dispatcher.dispatch(msg, undefined);
  }

  /**
   * Inject the host's relay iceServers into this station's Peer config.
   * Mirrors `PeerHostService.refreshIceConfig`: PeerJS doesn't expose a
   * public setter for `iceServers`, but `_options.config` is read every
   * time the Peer constructs an underlying RTCPeerConnection, so a fresh
   * `peer.connect()` for the camera channel picks up the new value.
   * Existing connections (the station→host data channel) keep their
   * already-negotiated ICE pair and aren't disturbed.
   */
  private applyRelayIceServers(iceServers: RTCIceServer[]): void {
    // Expose for the brokered camera data source regardless of whether the
    // Peer is up yet, the camera client reads these for its own connection.
    this.relayIceServers = iceServers;
    this.events.emit("relayIceServers", iceServers);
    if (!this.peer) return;
    const opts = (
      this.peer as unknown as {
        _options?: { config?: { iceServers: RTCIceServer[] } };
      }
    )._options;
    if (opts) {
      opts.config = { iceServers };
      logger.info(
        `[PeerClient] applied ${iceServers.length} iceServer(s) from relay-peer-id broadcast, station→relay camera channel can now use TURN`,
      );
    }
  }

  /** Latest relay TURN creds the host has broadcast (empty until one arrives). */
  getRelayIceServers(): RTCIceServer[] {
    return this.relayIceServers;
  }

  /** Notified whenever the host broadcasts a fresh set of relay TURN creds. */
  onRelayIceServersChange(cb: (servers: RTCIceServer[]) => void): () => void {
    return this.events.on("relayIceServers", cb);
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

  /**
   * Synchronous snapshot of the current connection status, for a caller
   * constructed AFTER the last `connStatus` transition (e.g. `PeerTransport`,
   * built once `StationScreen` has already reached its `connected` branch)
   * and that therefore can't rely on `onConnectionStatus` alone to learn the
   * current state.
   */
  getConnStatus(): ConnStatus {
    return this.connStatus;
  }

  /** Notified whenever a fresh `hello` arrives from the host. */
  onHostHello(
    cb: (info: { version: string; buildTime: string }) => void,
  ): () => void {
    return this.events.on("hostHello", cb);
  }

  /**
   * Notified when the host's session token changes, i.e. the host process
   * restarted between two connections. Used to clear station-local state
   * that would otherwise re-broadcast stale values on reconnect (e.g. a
   * GO vote that the operator left set before refreshing the main screen).
   * Does not fire on the first hello of a session, only when the token
   * actually changes.
   */
  onHostRestart(cb: () => void): () => void {
    return this.events.on("hostRestart", cb);
  }

  /**
   * Notified every time the host announces a new relay peer id (including
   * null → relay is down).
   */
  onRelayPeerIdChange(cb: (peerId: string | null) => void): () => void {
    return this.events.on("relayPeerId", cb);
  }

  /** Latest analytics consent the host has broadcast (false until one
   *  arrives). Stations gate their Axiom transport on this. */
  getAnalyticsConsent(): boolean {
    return this.analyticsConsent;
  }

  /**
   * Notified whenever the host broadcasts its analytics consent (on connect
   * and on every change). Fires immediately with the cached value so a late
   * subscriber gates correctly without waiting for the next change.
   */
  onAnalyticsConsent(cb: (enabled: boolean) => void): () => void {
    const remove = this.events.on("analyticsConsent", cb);
    cb(this.analyticsConsent);
    return remove;
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
    logger.info("[PeerClient] disconnected");
  }
}
