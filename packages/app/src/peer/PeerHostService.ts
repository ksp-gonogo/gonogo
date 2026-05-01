import { debugPeer, logger, PerfBudget } from "@gonogo/core";
import type { DataKeyMeta } from "@gonogo/data";
import { isScriptable } from "@gonogo/data";
import Peer, { type DataConnection } from "peerjs";
import { BUILD_TIME, VERSION } from "../version";
import { loadIceServers } from "./iceServers";
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

interface KosSession {
  ws: WebSocket;
  conn: DataConnection;
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
  private idListeners = new Set<(id: string | null) => void>();
  private kosSessions = new Map<string, KosSession>();
  private ocislyProxyPeerId: string | null = null;
  private stationInfoListeners = new Set<StationInfoListener>();
  private gonogoVoteListeners = new Set<GonogoVoteListener>();
  private gonogoAbortListeners = new Set<GonogoAbortListener>();
  private peerConnectListeners = new Set<PeerLifecycleListener>();
  private peerDisconnectListeners = new Set<PeerLifecycleListener>();
  private widgetPushListeners = new Set<WidgetPushListener>();
  private widgetRecallListeners = new Set<WidgetRecallListener>();
  private alarmAddListeners = new Set<AlarmAddListener>();
  private alarmUpdateListeners = new Set<AlarmUpdateListener>();
  private alarmDeleteListeners = new Set<AlarmDeleteListener>();
  private alarmAcknowledgeListeners = new Set<AlarmAcknowledgeListener>();
  private alarmAckListeners = new Set<AlarmAckListener>();
  private alarmWarpIntentListeners = new Set<AlarmWarpIntentListener>();
  private triggerArmListeners = new Set<TriggerArmListener>();
  private triggerCancelListeners = new Set<TriggerCancelListener>();

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

  start() {
    const peerId = getOrCreatePeerId();
    const iceServers = loadIceServers();
    this.peer = new Peer(
      peerId,
      iceServers.length > 0 ? { config: { iceServers } } : undefined,
    );

    this.peer.on("open", (id) => {
      localStorage.setItem(PEER_ID_KEY, id);
      this.peerId = id;
      logger.info(`[PeerHost] open — id=${id}`);
      this.idListeners.forEach((cb) => {
        cb(id);
      });
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
        for (const cb of this.peerConnectListeners) cb(conn.peer);
      });
      conn.on("data", (raw) => this.handleIncoming(raw as PeerMessage, conn));
      conn.on("close", () => {
        this.connections.delete(conn);
        this.closeKosSessionsForConn(conn);
        logger.info(
          `[PeerHost] connection closed — peer=${conn.peer}, total=${this.connections.size}`,
        );
        for (const cb of this.peerDisconnectListeners) cb(conn.peer);
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
  setOcislyProxyPeerId(peerId: string | null) {
    this.ocislyProxyPeerId = peerId;
    this.broadcast({ type: "ocisly-proxy-peer-id", peerId });
  }

  /**
   * Returns a Promise that resolves with the open Peer instance once the
   * broker handshake completes. Used by services that need to make outgoing
   * peer connections of their own (e.g. OcislyStreamSource calling the
   * ocisly-proxy). Resolves immediately if already open.
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
    debugPeer("host broadcast", {
      type: msg.type,
      sourceId: "sourceId" in msg ? msg.sourceId : undefined,
      key: "key" in msg ? msg.key : undefined,
      connections: this.connections.size,
    });

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
    this.idListeners.add(cb);
    return () => this.idListeners.delete(cb);
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

  private handleIncoming(msg: PeerMessage, conn: DataConnection) {
    debugPeer("host handleIncoming", {
      type: msg.type,
      peer: conn.peer,
      sessionId: "sessionId" in msg ? msg.sessionId : undefined,
    });
    if (msg.type === "execute") {
      logger.info(
        `[PeerHost] execute — source=${msg.sourceId} action=${msg.action}`,
      );
      import("@gonogo/core").then(({ getDataSource }) => {
        getDataSource(msg.sourceId)?.execute(msg.action);
      });
      return;
    }

    if (msg.type === "query-range-request") {
      void this.handleQueryRangeRequest(msg, conn);
      return;
    }

    if (msg.type === "kos-execute-request") {
      void this.handleKosExecuteRequest(msg, conn);
      return;
    }

    if (msg.type === "kos-open") {
      void this.handleKosOpen(msg, conn);
      return;
    }

    if (msg.type === "kos-data") {
      const session = this.kosSessions.get(msg.sessionId);
      if (session?.ws.readyState === WebSocket.OPEN) {
        session.ws.send(msg.data);
      }
      return;
    }

    if (msg.type === "kos-resize") {
      void this.handleKosResize(msg);
      return;
    }

    if (msg.type === "kos-close") {
      const session = this.kosSessions.get(msg.sessionId);
      if (session) {
        // Remove before closing so the WS close event doesn't echo kos-close back.
        this.kosSessions.delete(msg.sessionId);
        session.ws.close();
      }
      return;
    }

    if (msg.type === "station-info") {
      const info = {
        name: msg.name,
        version: msg.version,
        buildTime: msg.buildTime,
      };
      for (const cb of this.stationInfoListeners) cb(conn.peer, info);
      return;
    }

    if (msg.type === "gonogo-vote") {
      for (const cb of this.gonogoVoteListeners) cb(conn.peer, msg.status);
      return;
    }

    if (msg.type === "gonogo-abort") {
      for (const cb of this.gonogoAbortListeners) cb(conn.peer);
      return;
    }

    if (msg.type === "widget-push") {
      for (const cb of this.widgetPushListeners) cb(conn.peer, msg);
      return;
    }

    if (msg.type === "widget-recall") {
      for (const cb of this.widgetRecallListeners)
        cb(conn.peer, msg.widgetInstanceId);
      return;
    }

    if (msg.type === "alarm-add") {
      for (const cb of this.alarmAddListeners) cb(conn.peer, msg);
      return;
    }
    if (msg.type === "alarm-update") {
      for (const cb of this.alarmUpdateListeners) cb(conn.peer, msg);
      return;
    }
    if (msg.type === "alarm-delete") {
      for (const cb of this.alarmDeleteListeners) cb(conn.peer, msg.id);
      return;
    }
    if (msg.type === "alarm-acknowledge") {
      for (const cb of this.alarmAcknowledgeListeners) cb(conn.peer, msg.id);
      return;
    }
    if (msg.type === "alarm-ack-unscheduled-warp") {
      for (const cb of this.alarmAckListeners) cb(conn.peer);
      return;
    }
    if (msg.type === "alarm-warp-intent") {
      for (const cb of this.alarmWarpIntentListeners) cb(conn.peer, msg.index);
      return;
    }

    if (msg.type === "trigger-arm") {
      for (const cb of this.triggerArmListeners) cb(conn.peer, msg);
      return;
    }
    if (msg.type === "trigger-cancel") {
      for (const cb of this.triggerCancelListeners) cb(conn.peer, msg.id);
      return;
    }

    if (msg.type === "peer-data-mode") {
      this.peerMode.set(conn, msg.mode);
      // When switching to selective with no subs yet, the peer will get
      // nothing until it subscribes. That's intentional — the new mode
      // is opt-in for v2 stations and they always send subscriptions
      // immediately after the mode switch.
      if (msg.mode === "selective" && !this.peerSubs.has(conn)) {
        this.peerSubs.set(conn, new Map());
      }
      return;
    }
    if (msg.type === "peer-data-subscribe") {
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
      return;
    }
    if (msg.type === "peer-data-unsubscribe") {
      const subs = this.peerSubs.get(conn);
      const bucket = subs?.get(msg.sourceId);
      if (!bucket) return;
      for (const k of msg.keys) bucket.delete(k);
      return;
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // GO/NO-GO + peer lifecycle subscriptions. Kept as plain pub/sub so the
  // GoNoGoHostService can aggregate without this class knowing the semantics.
  // ───────────────────────────────────────────────────────────────────────

  onStationInfo(cb: StationInfoListener): () => void {
    this.stationInfoListeners.add(cb);
    return () => this.stationInfoListeners.delete(cb);
  }

  onGonogoVote(cb: GonogoVoteListener): () => void {
    this.gonogoVoteListeners.add(cb);
    return () => this.gonogoVoteListeners.delete(cb);
  }

  onGonogoAbort(cb: GonogoAbortListener): () => void {
    this.gonogoAbortListeners.add(cb);
    return () => this.gonogoAbortListeners.delete(cb);
  }

  onPeerConnect(cb: PeerLifecycleListener): () => void {
    this.peerConnectListeners.add(cb);
    return () => this.peerConnectListeners.delete(cb);
  }

  onPeerDisconnect(cb: PeerLifecycleListener): () => void {
    this.peerDisconnectListeners.add(cb);
    return () => this.peerDisconnectListeners.delete(cb);
  }

  onAlarmAdd(cb: AlarmAddListener): () => void {
    this.alarmAddListeners.add(cb);
    return () => this.alarmAddListeners.delete(cb);
  }

  onAlarmUpdate(cb: AlarmUpdateListener): () => void {
    this.alarmUpdateListeners.add(cb);
    return () => this.alarmUpdateListeners.delete(cb);
  }

  onAlarmDelete(cb: AlarmDeleteListener): () => void {
    this.alarmDeleteListeners.add(cb);
    return () => this.alarmDeleteListeners.delete(cb);
  }

  onAlarmAcknowledge(cb: AlarmAcknowledgeListener): () => void {
    this.alarmAcknowledgeListeners.add(cb);
    return () => this.alarmAcknowledgeListeners.delete(cb);
  }

  onAlarmAckUnscheduledWarp(cb: AlarmAckListener): () => void {
    this.alarmAckListeners.add(cb);
    return () => this.alarmAckListeners.delete(cb);
  }

  onAlarmWarpIntent(cb: AlarmWarpIntentListener): () => void {
    this.alarmWarpIntentListeners.add(cb);
    return () => this.alarmWarpIntentListeners.delete(cb);
  }

  onTriggerArm(cb: TriggerArmListener): () => void {
    this.triggerArmListeners.add(cb);
    return () => this.triggerArmListeners.delete(cb);
  }

  onTriggerCancel(cb: TriggerCancelListener): () => void {
    this.triggerCancelListeners.add(cb);
    return () => this.triggerCancelListeners.delete(cb);
  }

  onWidgetPush(cb: WidgetPushListener): () => void {
    this.widgetPushListeners.add(cb);
    return () => this.widgetPushListeners.delete(cb);
  }

  onWidgetRecall(cb: WidgetRecallListener): () => void {
    this.widgetRecallListeners.add(cb);
    return () => this.widgetRecallListeners.delete(cb);
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

  private async handleKosOpen(
    msg: Extract<PeerMessage, { type: "kos-open" }>,
    conn: DataConnection,
  ) {
    // Close any existing session with this ID (StrictMode fires effects twice).
    // Remove from map BEFORE closing so the close-event handler doesn't echo
    // kos-close back to the station.
    const existing = this.kosSessions.get(msg.sessionId);
    if (existing) {
      this.kosSessions.delete(msg.sessionId);
      existing.ws.close();
    }

    const { getDataSource } = await import("@gonogo/core");
    const kosConfig = getDataSource("kos")?.getConfig() as
      | { host?: string; port?: number; kosHost?: string; kosPort?: number }
      | undefined;
    const proxyHost = kosConfig?.host ?? "localhost";
    const proxyPort = kosConfig?.port ?? 3001;
    // Always use the host's kos config for the actual kOS address — stations
    // don't have a real kos data source and would send localhost as a fallback.
    const kosHost = kosConfig?.kosHost ?? msg.kosHost;
    const kosPort = kosConfig?.kosPort ?? msg.kosPort;

    const url =
      `ws://${proxyHost}:${proxyPort}/kos` +
      `?host=${encodeURIComponent(kosHost)}&port=${kosPort}` +
      `&id=${msg.sessionId}&cols=${msg.cols}&rows=${msg.rows}`;

    logger.info(`[PeerHost] kos-open — session=${msg.sessionId} url=${url}`);

    const ws = new WebSocket(url);
    this.kosSessions.set(msg.sessionId, { ws, conn });

    ws.addEventListener("open", () => {
      conn.send({
        type: "kos-opened",
        sessionId: msg.sessionId,
      } satisfies PeerMessage);
    });

    ws.addEventListener("message", (e) => {
      const data = typeof e.data === "string" ? e.data : String(e.data);
      conn.send({
        type: "kos-data",
        sessionId: msg.sessionId,
        data,
      } satisfies PeerMessage);
    });

    ws.addEventListener("close", () => {
      // If this ws has already been replaced (e.g. a duplicate kos-open arrived
      // and swapped in a newer session), ignore its late close — otherwise we'd
      // wipe the live replacement out of the map and fire a spurious kos-close.
      const current = this.kosSessions.get(msg.sessionId);
      if (current?.ws !== ws) return;
      this.kosSessions.delete(msg.sessionId);
      conn.send({
        type: "kos-close",
        sessionId: msg.sessionId,
      } satisfies PeerMessage);
    });

    ws.addEventListener("error", () => {
      // Ignore errors from a ws we've already replaced — its CONNECTING→CLOSED
      // transition (from the replacement close()) fires "error" as well as
      // "close", and logging it would just be noise.
      const current = this.kosSessions.get(msg.sessionId);
      if (current?.ws !== ws) return;
      logger.error(`[PeerHost] kos ws error — session=${msg.sessionId}`);
    });
  }

  private async handleKosResize(
    msg: Extract<PeerMessage, { type: "kos-resize" }>,
  ) {
    const { getDataSource } = await import("@gonogo/core");
    const kosConfig = getDataSource("kos")?.getConfig() as
      | { host?: string; port?: number }
      | undefined;
    const proxyHost = kosConfig?.host ?? "localhost";
    const proxyPort = kosConfig?.port ?? 3001;

    fetch(`http://${proxyHost}:${proxyPort}/kos/resize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: msg.sessionId,
        cols: msg.cols,
        rows: msg.rows,
      }),
    }).catch(() => {});
  }

  private closeKosSessionsForConn(conn: DataConnection) {
    for (const [sessionId, session] of this.kosSessions) {
      if (session.conn === conn) {
        // Remove before closing so the WS close event doesn't try to notify a disconnected peer.
        this.kosSessions.delete(sessionId);
        session.ws.close();
        logger.info(
          `[PeerHost] kos session closed on peer disconnect — session=${sessionId}`,
        );
      }
    }
  }

  stop() {
    for (const session of this.kosSessions.values()) {
      session.ws.close();
    }
    this.kosSessions.clear();
    this.peer?.destroy();
    this.peer = null;
    this.peerId = null;
    this.idListeners.forEach((cb) => {
      cb(null);
    });
    logger.info("[PeerHost] stopped");
  }
}

export const peerHostService = new PeerHostService();
