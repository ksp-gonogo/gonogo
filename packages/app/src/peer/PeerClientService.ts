import { debugPeer, logger } from "@gonogo/core";
import type {
  FlightRecord,
  KosData,
  KosManagedScript,
  KosScriptArg,
} from "@gonogo/data";
import { KosScriptError, ListenerSet } from "@gonogo/data";
import Peer, { type DataConnection } from "peerjs";
import { loadIceServers } from "./iceServers";
import { MessageDispatcher } from "./MessageDispatcher";
import type { FlightRpcOp, PeerMessage, PeerSchemaSource } from "./protocol";
import { RequestTracker } from "./RequestTracker";
import { RetryPolicy } from "./RetryPolicy";
import { getStationPeerId } from "./stationPeerId";

export type ConnStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

const DEFAULT_RETRY_INTERVAL_MS = 2_000;
const DEFAULT_RETRY_TIMEOUT_MS = 5 * 60 * 1000;

export interface PeerClientOptions {
  retryIntervalMs?: number;
  retryTimeoutMs?: number;
  /**
   * Explicit PeerJS id for this station. Defaults to the persistent
   * localStorage-backed id from `getStationPeerId()`. Override for tests.
   */
  peerId?: string;
}

export class PeerClientService {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private hostPeerId: string | null = null;
  private readonly stationPeerId: string;
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
  private ocislyProxyPeerIdListeners = new ListenerSet<
    [peerId: string | null]
  >();
  private ocislyProxyPeerId: string | null = null;
  private hostVersion: { version: string; buildTime: string } | null = null;
  private hostHelloListeners = new ListenerSet<
    [info: { version: string; buildTime: string }]
  >();
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
  private gonogoAbortNotifyListeners = new ListenerSet<
    [stationName: string, t: number]
  >();

  private pendingQueries = new RequestTracker<{
    t: number[];
    v: unknown[];
  }>();
  private pendingKosExecutes = new RequestTracker<KosData>();
  private pendingFlightRpc = new RequestTracker<unknown>();

  // Cached current flight pushed by the host. Updated on every `flight-change`
  // message, including the initial snapshot the host sends on connect open.
  // Stations read this synchronously through `getCurrentFlight()`; the modal
  // useFlight hook subscribes via `onFlightChange`.
  private currentFlight: FlightRecord | null = null;
  private flightChangeListeners = new ListenerSet<
    [flight: FlightRecord | null]
  >();
  private flightListChangeListeners = new ListenerSet<[]>();

  constructor({
    retryIntervalMs = DEFAULT_RETRY_INTERVAL_MS,
    retryTimeoutMs = DEFAULT_RETRY_TIMEOUT_MS,
    peerId,
  }: PeerClientOptions = {}) {
    this.stationPeerId = peerId ?? getStationPeerId();
    this.retryPolicy = new RetryPolicy({
      retryIntervalMs,
      retryTimeoutMs,
      stationPeerId: this.stationPeerId,
      hostPeerId: () => this.hostPeerId,
      tearDown: () => this.tearDownPeer(),
      rejectPending: (reason) => this.rejectPendingQueries(reason),
      emitStatus: (status) => this.emitConnStatus(status),
      reopen: () => this.openPeer(),
    });
  }

  connect(hostPeerId: string) {
    this.hostPeerId = hostPeerId;
    this.retryPolicy.beginConnect();
    this.openPeer();
  }

  private openPeer() {
    if (!this.hostPeerId) return;
    logger.info(`[PeerClient] connecting to host=${this.hostPeerId}`);
    this.emitConnStatus("connecting");
    const iceServers = loadIceServers();
    this.peer = new Peer(
      this.stationPeerId,
      iceServers.length > 0 ? { config: { iceServers } } : undefined,
    );
    this.peer.on("open", () => {
      if (!this.peer || !this.hostPeerId) return;
      this.conn = this.peer.connect(this.hostPeerId);
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
    this.peer.on("error", (err) => this.retryPolicy.handlePeerError(err));
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
  }) {
    this.conn?.send({ type: "alarm-add", ...input } satisfies PeerMessage);
  }

  sendAlarmUpdate(
    id: string,
    patch: {
      name?: string;
      notes?: string;
      trigger?: import("../alarms/types").AlarmTrigger;
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
    const requestId = crypto.randomUUID();
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

  private rejectPendingQueries(reason: string) {
    this.pendingQueries.rejectAll(reason);
    this.pendingKosExecutes.rejectAll(reason);
    this.pendingFlightRpc.rejectAll(reason);
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
    const requestId = crypto.randomUUID();
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
    const requestId = crypto.randomUUID();
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
    };
  }

  private readonly dispatcher = new MessageDispatcher<void>({
    hello: (msg) => {
      this.hostVersion = { version: msg.version, buildTime: msg.buildTime };
      logger.info(
        `[PeerClient] host hello — v${msg.version} (build ${msg.buildTime})`,
      );
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
    "ocisly-proxy-peer-id": (msg) => {
      this.ocislyProxyPeerId = msg.peerId;
      this.ocislyProxyPeerIdListeners.fire(msg.peerId);
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

  /** Latest OCISLY proxy peer id the host has announced, or null if none. */
  getOcislyProxyPeerId(): string | null {
    return this.ocislyProxyPeerId;
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
   * Notified every time the host announces a new OCISLY proxy peer id
   * (including null → proxy is down).
   */
  onOcislyProxyPeerIdChange(cb: (peerId: string | null) => void): () => void {
    return this.ocislyProxyPeerIdListeners.add(cb);
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
