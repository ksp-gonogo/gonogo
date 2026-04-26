import { debugPeer, logger } from "@gonogo/core";
import Peer, { type DataConnection } from "peerjs";
import { loadIceServers } from "./iceServers";
import type { PeerMessage, PeerSchemaSource } from "./protocol";
import { getStationPeerId } from "./stationPeerId";

export type ConnStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

const DEFAULT_RETRY_INTERVAL_MS = 2_000;
const DEFAULT_RETRY_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Longer retry gap when the broker reports our station peer id is still
 * held. The broker's id TTL is on the order of 30–60 s, so a short
 * 2 s loop just generates noise. 8 s keeps the log usable without
 * missing the window when the broker finally releases the id.
 */
const UNAVAILABLE_ID_RETRY_MS = 8_000;

/** PeerJS error shape — `.type` is the one load-bearing field we read. */
interface PeerJsError extends Error {
  type?: string;
}

function isPeerJsError(e: unknown): e is PeerJsError {
  return e instanceof Error && typeof (e as PeerJsError).type === "string";
}

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
  private intentionalDisconnect = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryStart: number | null = null;
  private readonly retryIntervalMs: number;
  private readonly retryTimeoutMs: number;
  private readonly stationPeerId: string;
  /** Last observed PeerJS error-type string — suppresses duplicate noisy
   *  logs when the same condition (e.g. `unavailable-id`) persists across
   *  retries. */
  private lastErrorType: string | null = null;
  /** ms override applied to the next retry. Set by error-type-specific
   *  handling; cleared back to `retryIntervalMs` after one use. */
  private nextRetryOverrideMs: number | null = null;

  private dataListeners = new Set<
    (sourceId: string, key: string, value: unknown, t: number) => void
  >();
  private sourceStatusListeners = new Set<
    (sourceId: string, status: string) => void
  >();
  private connStatusListeners = new Set<(status: ConnStatus) => void>();
  private schemaListeners = new Set<(sources: PeerSchemaSource[]) => void>();
  private kosDataListeners = new Set<
    (sessionId: string, data: string) => void
  >();
  private kosOpenedListeners = new Set<(sessionId: string) => void>();
  private kosCloseListeners = new Set<(sessionId: string) => void>();
  private ocislyProxyPeerIdListeners = new Set<
    (peerId: string | null) => void
  >();
  private ocislyProxyPeerId: string | null = null;
  private gonogoCountdownStartListeners = new Set<(t0Ms: number) => void>();
  private gonogoCountdownCancelListeners = new Set<
    (reason: string | undefined) => void
  >();
  private alarmSnapshotListeners = new Set<
    (snap: import("../alarms/types").AlarmSnapshot) => void
  >();
  private alarmFiredListeners = new Set<
    (fire: { id: string; name: string; ut: number }) => void
  >();
  private gonogoAbortNotifyListeners = new Set<
    (stationName: string, t: number) => void
  >();

  private pendingQueries = new Map<
    string,
    {
      resolve: (range: { t: number[]; v: unknown[] }) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  private pendingKosExecutes = new Map<
    string,
    {
      resolve: (data: Record<string, unknown>) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor({
    retryIntervalMs = DEFAULT_RETRY_INTERVAL_MS,
    retryTimeoutMs = DEFAULT_RETRY_TIMEOUT_MS,
    peerId,
  }: PeerClientOptions = {}) {
    this.retryIntervalMs = retryIntervalMs;
    this.retryTimeoutMs = retryTimeoutMs;
    this.stationPeerId = peerId ?? getStationPeerId();
  }

  connect(hostPeerId: string) {
    this.hostPeerId = hostPeerId;
    this.intentionalDisconnect = false;
    this.retryStart = null;
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
      // Fresh peer opened cleanly — clear the "still stuck on this error"
      // memo so future transitions log once again.
      this.lastErrorType = null;
      this.conn = this.peer.connect(this.hostPeerId);
      this.conn.on("open", () => {
        logger.info(`[PeerClient] connected to host=${this.hostPeerId}`);
        this.retryStart = null;
        this.emitConnStatus("connected");
      });
      this.conn.on("data", (raw) => this.handleMessage(raw as PeerMessage));
      this.conn.on("close", () => {
        logger.info(`[PeerClient] connection closed`);
        this.handleUnexpectedClose();
      });
      this.conn.on("error", (err) => {
        logger.error("[PeerClient] connection error", err);
      });
    });
    this.peer.on("error", (err) => this.handlePeerError(err));
  }

  /**
   * Classify the PeerJS error, log meaningfully (deduplicated per
   * error-type so sustained conditions like "unavailable-id" emit one
   * line rather than flooding the console on every retry), and let
   * `handleUnexpectedClose` schedule the next attempt.
   */
  private handlePeerError(err: unknown): void {
    const type = isPeerJsError(err) ? (err.type ?? null) : null;
    const repeat = type !== null && type === this.lastErrorType;

    if (!repeat) {
      if (type === "unavailable-id") {
        // Broker still holds this station's id because our previous Peer
        // hasn't been garbage-collected yet. Retry more slowly — the id
        // will free itself within ~a minute.
        logger.warn(
          `[PeerClient] station peer id is still held by the broker — retrying slowly until it releases`,
          { stationPeerId: this.stationPeerId },
        );
      } else if (type === "peer-unavailable") {
        // Host isn't online (refreshing, shutdown). Normal retry cadence.
        logger.info(
          `[PeerClient] host ${this.hostPeerId} unavailable — will retry`,
        );
      } else {
        logger.error(
          "[PeerClient] peer error",
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    } else {
      // Same error as last time; keep it out of the visible log but still
      // record at debug level for traceability.
      debugPeer("PeerClient repeat error", {
        type,
        message: err instanceof Error ? err.message : String(err),
      });
    }

    if (type === "unavailable-id") {
      this.nextRetryOverrideMs = UNAVAILABLE_ID_RETRY_MS;
    }
    this.lastErrorType = type;
    this.handleUnexpectedClose();
  }

  private handleUnexpectedClose() {
    if (this.intentionalDisconnect) return;
    if (this.retryTimer !== null) return; // already scheduled

    this.tearDownPeer();
    this.rejectPendingQueries("peer connection closed");

    if (this.retryStart === null) this.retryStart = Date.now();
    if (Date.now() - this.retryStart >= this.retryTimeoutMs) {
      logger.warn("[PeerClient] giving up on reconnect");
      this.retryStart = null;
      this.lastErrorType = null;
      this.nextRetryOverrideMs = null;
      this.emitConnStatus("disconnected");
      return;
    }

    this.emitConnStatus("reconnecting");
    const delay = this.nextRetryOverrideMs ?? this.retryIntervalMs;
    this.nextRetryOverrideMs = null;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.openPeer();
    }, delay);
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
  }

  private emitConnStatus(status: ConnStatus) {
    this.connStatusListeners.forEach((cb) => {
      cb(status);
    });
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

  sendStationInfo(name: string) {
    this.conn?.send({ type: "station-info", name } satisfies PeerMessage);
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
    ut: number;
    name: string;
    notes?: string;
    leadSeconds?: number;
  }) {
    this.conn?.send({ type: "alarm-add", ...input } satisfies PeerMessage);
  }

  sendAlarmUpdate(
    id: string,
    patch: { ut?: number; name?: string; notes?: string; leadSeconds?: number },
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
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingQueries.delete(requestId)) {
          reject(new Error("queryRange timeout"));
        }
      }, timeoutMs);
      this.pendingQueries.set(requestId, { resolve, reject, timer });
      this.conn?.send({
        type: "query-range-request",
        requestId,
        sourceId,
        key,
        tStart,
        tEnd,
        flightId,
      } satisfies PeerMessage);
    });
  }

  private rejectPendingQueries(reason: string) {
    for (const [id, pending] of this.pendingQueries) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.pendingQueries.delete(id);
    }
    for (const [id, pending] of this.pendingKosExecutes) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.pendingKosExecutes.delete(id);
    }
  }

  /**
   * Tunnel a kOS compute script execution through to the host. The host
   * invokes its local KosDataSource.executeScript and replies with
   * the parsed [KOSDATA] object (or an error). Timeout defaults to 15s —
   * a shade longer than the host's own per-call timeout so the station
   * surfaces the real error rather than a timeout racing it.
   */
  sendKosExecute(
    cpu: string,
    script: string,
    args: Array<number | string | boolean>,
    timeoutMs = 15_000,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!this.conn || this.conn.open === false) {
        reject(new Error("not connected to host"));
        return;
      }
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => {
        if (this.pendingKosExecutes.delete(requestId)) {
          reject(new Error("kos execute timeout"));
        }
      }, timeoutMs);
      this.pendingKosExecutes.set(requestId, { resolve, reject, timer });
      this.conn.send({
        type: "kos-execute-request",
        requestId,
        cpu,
        script,
        args,
      } satisfies PeerMessage);
    });
  }

  onData(
    cb: (sourceId: string, key: string, value: unknown, t: number) => void,
  ) {
    this.dataListeners.add(cb);
    return () => this.dataListeners.delete(cb);
  }

  onSourceStatus(cb: (sourceId: string, status: string) => void) {
    this.sourceStatusListeners.add(cb);
    return () => this.sourceStatusListeners.delete(cb);
  }

  onConnectionStatus(cb: (status: ConnStatus) => void) {
    this.connStatusListeners.add(cb);
    return () => this.connStatusListeners.delete(cb);
  }

  onSchema(cb: (sources: PeerSchemaSource[]) => void) {
    this.schemaListeners.add(cb);
    return () => this.schemaListeners.delete(cb);
  }

  onKosOpened(cb: (sessionId: string) => void) {
    this.kosOpenedListeners.add(cb);
    return () => this.kosOpenedListeners.delete(cb);
  }

  onKosData(cb: (sessionId: string, data: string) => void) {
    this.kosDataListeners.add(cb);
    return () => this.kosDataListeners.delete(cb);
  }

  onKosClose(cb: (sessionId: string) => void) {
    this.kosCloseListeners.add(cb);
    return () => this.kosCloseListeners.delete(cb);
  }

  onGonogoCountdownStart(cb: (t0Ms: number) => void) {
    this.gonogoCountdownStartListeners.add(cb);
    return () => this.gonogoCountdownStartListeners.delete(cb);
  }

  onGonogoCountdownCancel(cb: (reason: string | undefined) => void) {
    this.gonogoCountdownCancelListeners.add(cb);
    return () => this.gonogoCountdownCancelListeners.delete(cb);
  }

  onGonogoAbortNotify(cb: (stationName: string, t: number) => void) {
    this.gonogoAbortNotifyListeners.add(cb);
    return () => this.gonogoAbortNotifyListeners.delete(cb);
  }

  onAlarmSnapshot(cb: (snap: import("../alarms/types").AlarmSnapshot) => void) {
    this.alarmSnapshotListeners.add(cb);
    return () => this.alarmSnapshotListeners.delete(cb);
  }

  onAlarmFired(cb: (fire: { id: string; name: string; ut: number }) => void) {
    this.alarmFiredListeners.add(cb);
    return () => this.alarmFiredListeners.delete(cb);
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

  private handleMessage(msg: PeerMessage) {
    if (msg.type === "data") {
      debugPeer("client handleMessage data", {
        sourceId: msg.sourceId,
        key: msg.key,
        dataListenerCount: this.dataListeners.size,
      });
      const t = msg.t ?? Date.now();
      this.dataListeners.forEach((cb) => {
        cb(msg.sourceId, msg.key, msg.value, t);
      });
    } else if (msg.type === "query-range-response") {
      const pending = this.pendingQueries.get(msg.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pendingQueries.delete(msg.requestId);
      if (msg.error) {
        pending.reject(new Error(msg.error));
      } else {
        pending.resolve({ t: msg.t, v: msg.v });
      }
    } else if (msg.type === "kos-execute-response") {
      const pending = this.pendingKosExecutes.get(msg.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pendingKosExecutes.delete(msg.requestId);
      if (msg.error || !msg.data) {
        pending.reject(new Error(msg.error ?? "kos execute: empty response"));
      } else {
        pending.resolve(msg.data);
      }
    } else if (msg.type === "status") {
      this.sourceStatusListeners.forEach((cb) => {
        cb(msg.sourceId, msg.status);
      });
    } else if (msg.type === "schema") {
      logger.info(
        `[PeerClient] schema received — ${msg.sources.length} sources`,
      );
      this.schemaListeners.forEach((cb) => {
        cb(msg.sources);
      });
    } else if (msg.type === "kos-opened") {
      this.kosOpenedListeners.forEach((cb) => {
        cb(msg.sessionId);
      });
    } else if (msg.type === "kos-data") {
      this.kosDataListeners.forEach((cb) => {
        cb(msg.sessionId, msg.data);
      });
    } else if (msg.type === "kos-close") {
      this.kosCloseListeners.forEach((cb) => {
        cb(msg.sessionId);
      });
    } else if (msg.type === "ocisly-proxy-peer-id") {
      this.ocislyProxyPeerId = msg.peerId;
      this.ocislyProxyPeerIdListeners.forEach((cb) => {
        cb(msg.peerId);
      });
    } else if (msg.type === "gonogo-countdown-start") {
      for (const cb of this.gonogoCountdownStartListeners) cb(msg.t0Ms);
    } else if (msg.type === "gonogo-countdown-cancel") {
      for (const cb of this.gonogoCountdownCancelListeners) cb(msg.reason);
    } else if (msg.type === "gonogo-abort-notify") {
      for (const cb of this.gonogoAbortNotifyListeners)
        cb(msg.stationName, msg.t);
    } else if (msg.type === "alarm-snapshot") {
      for (const cb of this.alarmSnapshotListeners) cb(msg.snapshot);
    } else if (msg.type === "alarm-fired") {
      for (const cb of this.alarmFiredListeners)
        cb({ id: msg.id, name: msg.name, ut: msg.ut });
    }
  }

  /** Latest OCISLY proxy peer id the host has announced, or null if none. */
  getOcislyProxyPeerId(): string | null {
    return this.ocislyProxyPeerId;
  }

  /**
   * Notified every time the host announces a new OCISLY proxy peer id
   * (including null → proxy is down).
   */
  onOcislyProxyPeerIdChange(cb: (peerId: string | null) => void): () => void {
    this.ocislyProxyPeerIdListeners.add(cb);
    return () => {
      this.ocislyProxyPeerIdListeners.delete(cb);
    };
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
    this.intentionalDisconnect = true;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.tearDownPeer();
    this.rejectPendingQueries("peer client disconnected");
    this.hostPeerId = null;
    logger.info("[PeerClient] disconnected");
  }
}
