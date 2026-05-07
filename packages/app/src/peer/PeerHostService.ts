import { debugPeer, logger, PerfBudget } from "@gonogo/core";
import type {
  BufferedDataSource,
  DataKeyMeta,
  FlightRecord,
} from "@gonogo/data";
import { isScriptable, ListenerSet } from "@gonogo/data";
import Peer, { type DataConnection } from "peerjs";
import { BUILD_TIME, VERSION } from "../version";
import { fetchHostIceServers } from "./iceServers";
import { KosSessionManager } from "./KosSessionManager";
import { MessageDispatcher } from "./MessageDispatcher";
import type { PeerMessage } from "./protocol";

const PEER_ID_KEY = "gonogo-host-peer-id";

/**
 * Soft cap on the bandwidth a single host pours into the PeerJS data
 * channel each second (summed across all connected peers). At ~150
 * Telemachus keys × 4 Hz × 2 peers, the wire format averages ~50 bytes
 * per sample, which is roughly 60 KB/s. We set the budget at 200 KB/s
 * — well above steady state, low enough to catch a regression that
 * adds an unexpected broadcast loop.
 *
 * See `local_docs/performance_review.md` finding #1: the long-term fix
 * is selective subscription, but this budget gives us an early warning
 * if anything else (a new feature, a subscription leak) starts firing
 * extra messages.
 */
const PEER_BROADCAST_BYTES_BUDGET = new PerfBudget({
  name: "PeerHostService.broadcast bytes/sec",
  threshold: 200_000,
  windowMs: 1000,
  unit: "bytes",
});

/**
 * Cap on the *count* of broadcast messages per second. With ~150 keys
 * × 4 Hz × 1 peer, baseline is ~600/sec. Threshold at 1500 catches
 * doubled-up sends or an extra peer (currently expected use is 1–3
 * stations).
 */
const PEER_BROADCAST_COUNT_BUDGET = new PerfBudget({
  name: "PeerHostService.broadcast count/sec",
  threshold: 1500,
  windowMs: 1000,
  unit: "messages",
});

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I/L

function generateShortId(): string {
  return Array.from(
    { length: 4 },
    () => CHARS[Math.floor(Math.random() * CHARS.length)],
  ).join("");
}

function getOrCreatePeerId(): string {
  const saved = localStorage.getItem(PEER_ID_KEY);
  if (saved) return saved;
  const id = generateShortId();
  localStorage.setItem(PEER_ID_KEY, id);
  return id;
}

type StationInfoListener = (
  peerId: string,
  info: { name: string; version?: string; buildTime?: string },
) => void;
type GonogoVoteListener = (
  peerId: string,
  status: "go" | "no-go" | null,
) => void;
type GonogoAbortListener = (peerId: string) => void;
type PeerLifecycleListener = (peerId: string) => void;
type WidgetPushListener = (
  peerId: string,
  msg: Extract<PeerMessage, { type: "widget-push" }>,
) => void;
type WidgetRecallListener = (peerId: string, widgetInstanceId: string) => void;
type AlarmAddListener = (
  peerId: string,
  msg: Extract<PeerMessage, { type: "alarm-add" }>,
) => void;
type AlarmUpdateListener = (
  peerId: string,
  msg: Extract<PeerMessage, { type: "alarm-update" }>,
) => void;
type AlarmDeleteListener = (peerId: string, id: string) => void;
type AlarmAcknowledgeListener = (peerId: string, id: string) => void;
type AlarmAckListener = (peerId: string) => void;
type AlarmWarpIntentListener = (peerId: string, index: number) => void;
type TriggerArmListener = (
  peerId: string,
  msg: Extract<PeerMessage, { type: "trigger-arm" }>,
) => void;
type TriggerCancelListener = (peerId: string, id: string) => void;

export class PeerHostService {
  private peer: Peer | null = null;
  private connections: Set<DataConnection> = new Set();
  private idListeners = new ListenerSet<[string | null]>();
  private kosSessions = new KosSessionManager({
    getKosConfig: async () => {
      const { getDataSource } = await import("@gonogo/core");
      return getDataSource("kos")?.getConfig() as
        | { host?: string; port?: number; kosHost?: string; kosPort?: number }
        | undefined;
    },
  });
  private ocislyProxyPeerId: string | null = null;
  // peerId → stationKey, populated from incoming station-info. Used to
  // evict the ghost connection when a refreshed station rejoins with a
  // fresh peerId — without this the GO/NO-GO list shows the same station
  // twice for ~60 s while the broker times out the old conn.
  private peerIdToStationKey = new Map<string, string>();
  private stationInfoListeners = new ListenerSet<
    Parameters<StationInfoListener>
  >();
  private gonogoVoteListeners = new ListenerSet<
    Parameters<GonogoVoteListener>
  >();
  private gonogoAbortListeners = new ListenerSet<
    Parameters<GonogoAbortListener>
  >();
  private peerConnectListeners = new ListenerSet<
    Parameters<PeerLifecycleListener>
  >();
  private peerDisconnectListeners = new ListenerSet<
    Parameters<PeerLifecycleListener>
  >();
  private widgetPushListeners = new ListenerSet<
    Parameters<WidgetPushListener>
  >();
  private widgetRecallListeners = new ListenerSet<
    Parameters<WidgetRecallListener>
  >();
  private alarmAddListeners = new ListenerSet<Parameters<AlarmAddListener>>();
  private alarmUpdateListeners = new ListenerSet<
    Parameters<AlarmUpdateListener>
  >();
  private alarmDeleteListeners = new ListenerSet<
    Parameters<AlarmDeleteListener>
  >();
  private alarmAcknowledgeListeners = new ListenerSet<
    Parameters<AlarmAcknowledgeListener>
  >();
  private alarmAckListeners = new ListenerSet<Parameters<AlarmAckListener>>();
  private alarmWarpIntentListeners = new ListenerSet<
    Parameters<AlarmWarpIntentListener>
  >();
  private triggerArmListeners = new ListenerSet<
    Parameters<TriggerArmListener>
  >();
  private triggerCancelListeners = new ListenerSet<
    Parameters<TriggerCancelListener>
  >();

  // Selective subscription state. Maps each connected DataConnection to:
  //   - mode: "broadcast-all" (default) or "selective"
  //   - subs:  Map<sourceId, Set<key>> for selective mode
  // A peer in broadcast-all mode receives every data message; a peer in
  // selective mode receives only messages whose (sourceId, key) is in
  // its subs. Cleared on disconnect so a reconnecting station gets a
  // fresh broadcast-all baseline.
  private peerMode = new WeakMap<
    DataConnection,
    "broadcast-all" | "selective"
  >();
  private peerSubs = new WeakMap<DataConnection, Map<string, Set<string>>>();

  peerId: string | null = null;
  /** ICE servers fetched from the relay on start(). Exposed so the
   *  TURN reachability probe can re-use exactly what the host's Peer
   *  was constructed with. Empty `[]` means the fetch failed or no
   *  relay is configured. */
  iceServers: RTCIceServer[] = [];

  private flightChangeUnsub: (() => void) | null = null;
  private flightListChangeUnsub: (() => void) | null = null;
  private currentFlightSnapshot: FlightRecord | null = null;

  async start() {
    const peerId = getOrCreatePeerId();
    // Fetch the relay's TURN config before constructing Peer — ICE
    // gathers candidates the moment the Peer exists, so a late config
    // wouldn't make it into the offer. If the fetch fails we get an
    // empty array and run direct/STUN-only; the readiness UI tells the
    // operator about it.
    this.iceServers = await fetchHostIceServers();
    this.peer = new Peer(
      peerId,
      this.iceServers.length > 0
        ? { config: { iceServers: this.iceServers } }
        : undefined,
    );

    this.peer.on("open", (id) => {
      localStorage.setItem(PEER_ID_KEY, id);
      this.peerId = id;
      // Tag every subsequent log entry with this device's identity so we
      // can filter "all logs from host XK3F" in the remote sink. The host
      // peer id is both the stable device id and the broker id.
      logger.setIdentity({ role: "host", id, peerId: id });
      logger.info(`[PeerHost] open — id=${id}`);
      this.idListeners.fire(id);
    });

    this.peer.on("connection", (conn) => {
      logger.info(`[PeerHost] incoming connection from ${conn.peer}`);
      conn.on("open", () => {
        this.connections.add(conn);
        logger.info(
          `[PeerHost] connection open — peer=${conn.peer}, total=${this.connections.size}`,
        );
        // Hello first — stations parse it before anything else so a major
        // mismatch banner can appear without waiting for the schema round.
        conn.send({
          type: "hello",
          version: VERSION,
          buildTime: BUILD_TIME,
        } satisfies PeerMessage);
        this.sendSchema(conn);
        // Station needs this to reach the OCISLY proxy directly — resend
        // whenever a new station connects so latecomers aren't stuck in
        // "disconnected".
        if (this.ocislyProxyPeerId !== null) {
          conn.send({
            type: "ocisly-proxy-peer-id",
            peerId: this.ocislyProxyPeerId,
          } satisfies PeerMessage);
        }
        // Latecomer's initial flight snapshot. The host's flight-change
        // listener is set up lazily below; this send is independent so a
        // station that connects mid-flight gets the current value
        // immediately rather than waiting for the next transition.
        conn.send({
          type: "flight-change",
          flight: this.currentFlightSnapshot,
        } satisfies PeerMessage);
        // Nudge the station to reload its flight list. flight-change above
        // doesn't always trigger a re-render (when the cached snapshot ===
        // the incoming snapshot, e.g. both `null`), so an open
        // FlightsManager modal would otherwise stay on a "no flights" view
        // until the next list mutation.
        conn.send({ type: "flight-list-changed" } satisfies PeerMessage);
        // Lazy: wire the host's BufferedDataSource flight broadcaster on
        // the first peer connection. The buffered source isn't registered
        // synchronously — it imports kos + telemachus first — so doing
        // this in start() races. Per-connection is too eager (we'd subscribe
        // every time), so we gate on a single attach.
        void this.attachFlightChangeBroadcaster();
        this.peerConnectListeners.fire(conn.peer);
      });
      conn.on("data", (raw) => this.handleIncoming(raw as PeerMessage, conn));
      conn.on("close", () => {
        this.connections.delete(conn);
        this.peerIdToStationKey.delete(conn.peer);
        this.kosSessions.closeAllForConn(conn);
        logger.info(
          `[PeerHost] connection closed — peer=${conn.peer}, total=${this.connections.size}`,
        );
        this.peerDisconnectListeners.fire(conn.peer);
      });
      conn.on("error", (err) => {
        logger.error(`[PeerHost] connection error — peer=${conn.peer}`, err);
      });
    });

    this.peer.on("error", (err) => {
      logger.error("[PeerHost] peer error", err);
    });
  }

  /**
   * Set (and broadcast) the current OCISLY proxy peer id. Called by the
   * host-side OcislyStreamSource once it resolves the id over HTTP. Passing
   * null tears it back down for all stations.
   */
  private findConnByPeerId(peerId: string): DataConnection | null {
    for (const c of this.connections) if (c.peer === peerId) return c;
    return null;
  }

  setOcislyProxyPeerId(peerId: string | null) {
    this.ocislyProxyPeerId = peerId;
    this.broadcast({ type: "ocisly-proxy-peer-id", peerId });
  }

  /**
   * Returns a Promise that resolves with the open Peer instance once the
   * broker handshake completes. Used by services that need to make outgoing
   * peer connections of their own (e.g. OcislyStreamSource calling the
   * relay's OCISLY peer). Resolves immediately if already open.
   */
  waitForPeer(): Promise<Peer> {
    if (this.peer && this.peerId) return Promise.resolve(this.peer);
    return new Promise<Peer>((resolve) => {
      const remove = this.onPeerIdChange(() => {
        if (this.peer && this.peerId) {
          remove();
          resolve(this.peer);
        }
      });
    });
  }

  broadcast(msg: PeerMessage) {
    // Skip the trace when no station is listening — at telemetry rates
    // (~700 broadcasts/sec) this fills the persistent log buffer in
    // seconds, drowning out any signal from an actual incident.
    if (this.connections.size > 0) {
      debugPeer("host broadcast", {
        type: msg.type,
        sourceId: "sourceId" in msg ? msg.sourceId : undefined,
        key: "key" in msg ? msg.key : undefined,
        connections: this.connections.size,
      });
    }

    // Data messages run through `broadcastData` so they can be filtered
    // per peer. Everything else (status, alarm, gonogo, etc.) goes to
    // every connection unconditionally — the volume is low and stations
    // need full visibility into operational events.
    if (msg.type === "data") {
      this.broadcastData(msg);
      return;
    }

    if (this.connections.size > 0) {
      let bytes = 0;
      try {
        bytes = JSON.stringify(msg).length;
      } catch {
        // Pathological non-serialisable payload — skip the budget hit.
      }
      PEER_BROADCAST_COUNT_BUDGET.record(this.connections.size);
      PEER_BROADCAST_BYTES_BUDGET.record(bytes * this.connections.size);
    }
    for (const conn of this.connections) {
      conn.send(msg);
    }
  }

  /**
   * Per-peer-filtered data broadcast. Internal helper; called by the
   * generic `broadcast()` whenever the message type is "data". Splits
   * the budget recording per peer so the count + bytes reflect actual
   * wire traffic, not the broadcast-all upper bound.
   */
  private broadcastData(msg: Extract<PeerMessage, { type: "data" }>): void {
    if (this.connections.size === 0) return;
    let bytes = 0;
    try {
      bytes = JSON.stringify(msg).length;
    } catch {
      // skip budget record on non-serialisable payload
    }
    let recipients = 0;
    for (const conn of this.connections) {
      const mode = this.peerMode.get(conn) ?? "broadcast-all";
      if (mode === "selective") {
        const subs = this.peerSubs.get(conn);
        const keysForSource = subs?.get(msg.sourceId);
        if (!keysForSource?.has(msg.key)) continue;
      }
      conn.send(msg);
      recipients++;
    }
    if (recipients > 0) {
      PEER_BROADCAST_COUNT_BUDGET.record(recipients);
      PEER_BROADCAST_BYTES_BUDGET.record(bytes * recipients);
    }
  }

  onPeerIdChange(cb: (id: string | null) => void) {
    const unsub = this.idListeners.add(cb);
    // Replay the current id so a late subscriber doesn't miss an
    // already-fired "open" event. Necessary now that start() is async:
    // the Peer's open microtask can fire before the caller's await
    // continuation registers its listener, leaving it stuck waiting on
    // an event that already happened. Defer to a microtask so the
    // caller's `unsub = onPeerIdChange(...)` assignment lands before
    // the cb runs (callers typically `unsub()` from inside the cb).
    if (this.peerId !== null) {
      const id = this.peerId;
      queueMicrotask(() => cb(id));
    }
    return unsub;
  }

  // Schema is sent once per station connect. Stations cache what arrives here
  // and don't poll. If a data source registers keys dynamically after the
  // initial handshake (e.g. a future kOS datastream), this will need to
  // broadcast a new schema message to already-connected stations.
  private sendSchema(conn: DataConnection) {
    import("@gonogo/core").then(({ getDataSources }) => {
      const sources = getDataSources().map((s) => ({
        id: s.id,
        name: s.name,
        // The DataSource interface declares `schema(): DataKey[]` but the
        // BufferedDataSource wrappers that front every live source return
        // `DataKeyMeta[]`. Cast locally so station-side pickers get label /
        // unit / group without a wider type change across core.
        keys: s.schema() as unknown as DataKeyMeta[],
      }));
      const msg: PeerMessage = { type: "schema", sources };
      conn.send(msg);
      logger.info(
        `[PeerHost] schema sent to ${conn.peer} — ${sources.length} sources`,
      );
    });
  }

  private readonly dispatcher = new MessageDispatcher<DataConnection>({
    execute: (msg) => {
      logger.info(
        `[PeerHost] execute — source=${msg.sourceId} action=${msg.action}`,
      );
      import("@gonogo/core").then(({ getDataSource }) => {
        getDataSource(msg.sourceId)?.execute(msg.action);
      });
    },
    "query-range-request": (msg, conn) => {
      void this.handleQueryRangeRequest(msg, conn);
    },
    "flight-rpc-request": (msg, conn) => {
      void this.handleFlightRpcRequest(msg, conn);
    },
    "kos-execute-request": (msg, conn) => {
      void this.handleKosExecuteRequest(msg, conn);
    },
    "kos-open": (msg, conn) => {
      void this.kosSessions.handleOpen(msg, conn);
    },
    "kos-data": (msg) => {
      this.kosSessions.handleData(msg);
    },
    "kos-resize": (msg) => {
      void this.kosSessions.handleResize(msg);
    },
    "kos-close": (msg) => {
      this.kosSessions.handleClose(msg);
    },
    "station-info": (msg, conn) => {
      if (msg.stationKey) {
        // If another live connection claims the same stationKey, it's a
        // ghost from a previous session for the same device — close it
        // so the GO/NO-GO list collapses back to one entry. Skip the
        // current conn so we don't kill the legitimate one when the
        // station re-sends station-info on a rename.
        for (const [peerId, key] of this.peerIdToStationKey) {
          if (key === msg.stationKey && peerId !== conn.peer) {
            const ghost = this.findConnByPeerId(peerId);
            ghost?.close();
            this.peerIdToStationKey.delete(peerId);
          }
        }
        this.peerIdToStationKey.set(conn.peer, msg.stationKey);
      }
      this.stationInfoListeners.fire(conn.peer, {
        name: msg.name,
        version: msg.version,
        buildTime: msg.buildTime,
      });
    },
    "gonogo-vote": (msg, conn) => {
      this.gonogoVoteListeners.fire(conn.peer, msg.status);
    },
    "gonogo-abort": (_msg, conn) => {
      this.gonogoAbortListeners.fire(conn.peer);
    },
    "widget-push": (msg, conn) => {
      this.widgetPushListeners.fire(conn.peer, msg);
    },
    "widget-recall": (msg, conn) => {
      this.widgetRecallListeners.fire(conn.peer, msg.widgetInstanceId);
    },
    "alarm-add": (msg, conn) => {
      this.alarmAddListeners.fire(conn.peer, msg);
    },
    "alarm-update": (msg, conn) => {
      this.alarmUpdateListeners.fire(conn.peer, msg);
    },
    "alarm-delete": (msg, conn) => {
      this.alarmDeleteListeners.fire(conn.peer, msg.id);
    },
    "alarm-acknowledge": (msg, conn) => {
      this.alarmAcknowledgeListeners.fire(conn.peer, msg.id);
    },
    "alarm-ack-unscheduled-warp": (_msg, conn) => {
      this.alarmAckListeners.fire(conn.peer);
    },
    "alarm-warp-intent": (msg, conn) => {
      this.alarmWarpIntentListeners.fire(conn.peer, msg.index);
    },
    "trigger-arm": (msg, conn) => {
      this.triggerArmListeners.fire(conn.peer, msg);
    },
    "trigger-cancel": (msg, conn) => {
      this.triggerCancelListeners.fire(conn.peer, msg.id);
    },
    "peer-data-mode": (msg, conn) => {
      this.peerMode.set(conn, msg.mode);
      // When switching to selective with no subs yet, the peer will get
      // nothing until it subscribes. That's intentional — the new mode
      // is opt-in for v2 stations and they always send subscriptions
      // immediately after the mode switch.
      if (msg.mode === "selective" && !this.peerSubs.has(conn)) {
        this.peerSubs.set(conn, new Map());
      }
    },
    "peer-data-subscribe": (msg, conn) => {
      let subs = this.peerSubs.get(conn);
      if (!subs) {
        subs = new Map();
        this.peerSubs.set(conn, subs);
      }
      let bucket = subs.get(msg.sourceId);
      if (!bucket) {
        bucket = new Set();
        subs.set(msg.sourceId, bucket);
      }
      for (const k of msg.keys) bucket.add(k);
    },
    "peer-data-unsubscribe": (msg, conn) => {
      const subs = this.peerSubs.get(conn);
      const bucket = subs?.get(msg.sourceId);
      if (!bucket) return;
      for (const k of msg.keys) bucket.delete(k);
    },
  });

  private handleIncoming(msg: PeerMessage, conn: DataConnection) {
    debugPeer("host handleIncoming", {
      type: msg.type,
      peer: conn.peer,
      sessionId: "sessionId" in msg ? msg.sessionId : undefined,
    });
    this.dispatcher.dispatch(msg, conn);
  }

  // ───────────────────────────────────────────────────────────────────────
  // GO/NO-GO + peer lifecycle subscriptions. Kept as plain pub/sub so the
  // GoNoGoHostService can aggregate without this class knowing the semantics.
  // ───────────────────────────────────────────────────────────────────────

  onStationInfo(cb: StationInfoListener): () => void {
    return this.stationInfoListeners.add(cb);
  }

  onGonogoVote(cb: GonogoVoteListener): () => void {
    return this.gonogoVoteListeners.add(cb);
  }

  onGonogoAbort(cb: GonogoAbortListener): () => void {
    return this.gonogoAbortListeners.add(cb);
  }

  onPeerConnect(cb: PeerLifecycleListener): () => void {
    return this.peerConnectListeners.add(cb);
  }

  onPeerDisconnect(cb: PeerLifecycleListener): () => void {
    return this.peerDisconnectListeners.add(cb);
  }

  onAlarmAdd(cb: AlarmAddListener): () => void {
    return this.alarmAddListeners.add(cb);
  }

  onAlarmUpdate(cb: AlarmUpdateListener): () => void {
    return this.alarmUpdateListeners.add(cb);
  }

  onAlarmDelete(cb: AlarmDeleteListener): () => void {
    return this.alarmDeleteListeners.add(cb);
  }

  onAlarmAcknowledge(cb: AlarmAcknowledgeListener): () => void {
    return this.alarmAcknowledgeListeners.add(cb);
  }

  onAlarmAckUnscheduledWarp(cb: AlarmAckListener): () => void {
    return this.alarmAckListeners.add(cb);
  }

  onAlarmWarpIntent(cb: AlarmWarpIntentListener): () => void {
    return this.alarmWarpIntentListeners.add(cb);
  }

  onTriggerArm(cb: TriggerArmListener): () => void {
    return this.triggerArmListeners.add(cb);
  }

  onTriggerCancel(cb: TriggerCancelListener): () => void {
    return this.triggerCancelListeners.add(cb);
  }

  onWidgetPush(cb: WidgetPushListener): () => void {
    return this.widgetPushListeners.add(cb);
  }

  onWidgetRecall(cb: WidgetRecallListener): () => void {
    return this.widgetRecallListeners.add(cb);
  }

  getConnectedPeerIds(): string[] {
    return Array.from(this.connections, (c) => c.peer);
  }

  private async handleQueryRangeRequest(
    msg: Extract<PeerMessage, { type: "query-range-request" }>,
    conn: DataConnection,
  ) {
    const { getDataSource } = await import("@gonogo/core");
    const source = getDataSource(msg.sourceId) as
      | (ReturnType<typeof getDataSource> & {
          queryRange?: (
            key: string,
            tStart: number,
            tEnd: number,
            flightId?: string,
          ) => Promise<{ t: number[]; v: unknown[] }>;
        })
      | undefined;
    const respond = (t: number[], v: unknown[], error?: string) => {
      conn.send({
        type: "query-range-response",
        requestId: msg.requestId,
        t,
        v,
        error,
      } satisfies PeerMessage);
    };
    if (!source || typeof source.queryRange !== "function") {
      respond([], [], `source ${msg.sourceId} has no queryRange`);
      return;
    }
    try {
      const range = await source.queryRange(
        msg.key,
        msg.tStart,
        msg.tEnd,
        msg.flightId,
      );
      respond(range.t, range.v);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error("[PeerHost] queryRange failed", error);
      respond([], [], error.message);
    }
  }

  private async handleKosExecuteRequest(
    msg: Extract<PeerMessage, { type: "kos-execute-request" }>,
    conn: DataConnection,
  ) {
    const { getDataSource } = await import("@gonogo/core");
    const source = getDataSource("kos");
    const respond = (
      data?: import("@gonogo/data").KosData,
      error?: string,
      isScriptError?: boolean,
    ): void => {
      conn.send({
        type: "kos-execute-response",
        requestId: msg.requestId,
        data,
        error,
        isScriptError,
      } satisfies PeerMessage);
    };
    if (!isScriptable(source)) {
      respond(undefined, "kos data source not registered on main screen");
      return;
    }
    try {
      const data = await source.executeScript(
        msg.cpu,
        msg.script,
        msg.args,
        msg.managed,
      );
      respond(data);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      // Duck-type: avoid importing the concrete class so this file stays
      // free of @gonogo/app circular references.
      const isScriptError =
        (error as { isScriptError?: unknown }).isScriptError === true;
      logger.warn(`[PeerHost] kos execute failed — ${error.message}`);
      respond(undefined, error.message, isScriptError);
    }
  }

  /**
   * Subscribe once to the buffered source's `onFlightChange` and broadcast
   * each transition to every connected station. Idempotent — repeated
   * calls after the first attach are no-ops.
   */
  private async attachFlightChangeBroadcaster(): Promise<void> {
    if (this.flightChangeUnsub) return;
    const source = await this.getBufferedDataSource();
    if (!source) return;
    this.currentFlightSnapshot = source.getCurrentFlight();
    this.flightChangeUnsub = source.onFlightChange((flight) => {
      this.currentFlightSnapshot = flight;
      this.broadcast({ type: "flight-change", flight } satisfies PeerMessage);
    });
    if (typeof source.onFlightListChange === "function") {
      this.flightListChangeUnsub = source.onFlightListChange(() => {
        this.broadcast({
          type: "flight-list-changed",
        } satisfies PeerMessage);
      });
    }
  }

  private async getBufferedDataSource(): Promise<BufferedDataSource | null> {
    const { getDataSource } = await import("@gonogo/core");
    // Duck-type: BufferedDataSource isn't exported as a runtime symbol from
    // PeerHostService's POV, and the registered "data" entry is wrapped in
    // PeerBroadcastingDataSource on the main screen. The wrapper forwards
    // every flight method we touch here, so the duck check covers both.
    const candidate = getDataSource("data") as
      | (BufferedDataSource & {
          onFlightChange?: BufferedDataSource["onFlightChange"];
        })
      | undefined;
    if (!candidate || typeof candidate.onFlightChange !== "function") {
      return null;
    }
    return candidate;
  }

  private async handleFlightRpcRequest(
    msg: Extract<PeerMessage, { type: "flight-rpc-request" }>,
    conn: DataConnection,
  ) {
    const respond = (result?: unknown, error?: string) => {
      conn.send({
        type: "flight-rpc-response",
        requestId: msg.requestId,
        result,
        error,
      } satisfies PeerMessage);
    };
    const source = await this.getBufferedDataSource();
    if (!source) {
      respond(undefined, "buffered data source not registered");
      return;
    }
    try {
      const result = await this.dispatchFlightRpc(source, msg.op);
      respond(result);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.warn(`[PeerHost] flight RPC failed (${msg.op.op}) — ${error}`);
      respond(undefined, error);
    }
  }

  private async dispatchFlightRpc(
    source: BufferedDataSource,
    op: Extract<PeerMessage, { type: "flight-rpc-request" }>["op"],
  ): Promise<unknown> {
    switch (op.op) {
      case "list":
        return source.listFlights();
      case "get":
        return source.getFlight(op.id);
      case "getCurrent":
        return source.getCurrentFlight();
      case "export":
        return source.exportFlight(op.id);
      case "delete":
        await source.deleteFlight(op.id);
        return null;
      case "clearAll":
        await source.clearAllFlights();
        return null;
      case "setStarred":
        await source.setFlightStarred(op.id, op.starred);
        return null;
      case "pruneKeepLatest":
        return source.pruneFlightsKeepLatest({ keepCount: op.keepCount });
      case "addChapter":
        return source.addChapter(op.flightId, op.chapter);
      case "updateChapter":
        return source.updateChapter(op.flightId, op.chapterId, op.patch);
      case "removeChapter":
        return source.removeChapter(op.flightId, op.chapterId);
    }
  }

  stop() {
    this.kosSessions.closeAll();
    this.flightChangeUnsub?.();
    this.flightChangeUnsub = null;
    this.flightListChangeUnsub?.();
    this.flightListChangeUnsub = null;
    this.currentFlightSnapshot = null;
    this.peer?.destroy();
    this.peer = null;
    this.peerId = null;
    this.idListeners.fire(null);
    logger.info("[PeerHost] stopped");
  }
}

export const peerHostService = new PeerHostService();
