import { PerfBudget, safeRandomUuid } from "@gonogo/core";
import type {
  BufferedDataSource,
  DataKeyMeta,
  FlightRecord,
} from "@gonogo/data";
import { isScriptable, ListenerSet } from "@gonogo/data";
import { debugPeer, logger } from "@gonogo/logger";
import Peer, { type DataConnection } from "peerjs";
import { BUILD_TIME, VERSION } from "../version";
import { fetchHostIceServers } from "./iceServers";
import { KosSessionManager } from "./KosSessionManager";
import { MessageDispatcher } from "./MessageDispatcher";
import { peerBrokerOptions } from "./peerOptions";
import type { PeerMessage } from "./protocol";

const PEER_ID_KEY = "gonogo-host-peer-id";

/**
 * Cheap structural compare for two iceServers configs. Good enough
 * because the relay only ever emits one TURN entry with a known shape;
 * order changes between fetches are not expected. Used by the host's
 * periodic config refresh to skip the no-op case (relay still serving
 * the same creds) without touching the Peer.
 */
function areIceServersEqual(a: RTCIceServer[], b: RTCIceServer[]): boolean {
  if (a.length !== b.length) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

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
type NoteAddListener = (
  peerId: string,
  msg: Extract<PeerMessage, { type: "note-add" }>,
) => void;
type NoteUpdateListener = (
  peerId: string,
  msg: Extract<PeerMessage, { type: "note-update" }>,
) => void;
type NoteDeleteListener = (peerId: string, id: string) => void;
type NoteReorderListener = (
  peerId: string,
  msg: Extract<PeerMessage, { type: "note-reorder" }>,
) => void;

export class PeerHostService {
  private peer: Peer | null = null;
  private connections: Set<DataConnection> = new Set();
  private idListeners = new ListenerSet<[string | null]>();
  // Fresh per page-load. Stations compare against the last-seen value to
  // distinguish a transient broker reconnect (same token) from a genuine
  // host restart (new token), so widgets like GO/NO-GO can clear state
  // that would otherwise be re-broadcast from station memory and look
  // like persistence across a fresh launch.
  private readonly sessionToken = safeRandomUuid();
  // Direct map of host-owned data sources for backfillLatest. The global
  // registry isn't a safe lookup here — under tests the same JS process
  // hosts both host + station, and StationScreen overwrites the "data"
  // entry with a PCDS that has no cached values. PBDS registers itself
  // here on construction so the host always finds the wrapper that
  // forwards to the real source's cache.
  private readonly backfillSources = new Map<
    string,
    { getLatestValue?: (key: string) => unknown }
  >();
  private kosSessions = new KosSessionManager({
    getKosConfig: async () => {
      const { getDataSource } = await import("@gonogo/core");
      return getDataSource("kos")?.getConfig() as
        | { host?: string; port?: number; kosHost?: string; kosPort?: number }
        | undefined;
    },
  });
  private relayPeerId: string | null = null;
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
  private noteAddListeners = new ListenerSet<Parameters<NoteAddListener>>();
  private noteUpdateListeners = new ListenerSet<
    Parameters<NoteUpdateListener>
  >();
  private noteDeleteListeners = new ListenerSet<
    Parameters<NoteDeleteListener>
  >();
  private noteReorderListeners = new ListenerSet<
    Parameters<NoteReorderListener>
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
  // Latches true the first time the broker confirms the host's id with
  // an `open` event. Used by the auto-rotate guard in `peer.on("error")`
  // to avoid rotating mid-session when PeerJS internally reconnects to
  // the broker and trips an `unavailable-id` race. `regeneratePeerId()`
  // resets it via stop() so the fresh Peer earns its own first-open.
  private peerHasOpened = false;
  // Polls the relay's `/ice-config` so a relay restart (which mints a
  // fresh coturn shared secret on every boot) doesn't leave the host's
  // Peer pinned to stale TURN credentials. Without this, a `pnpm dev`
  // rebuild of the relay container silently breaks new TURN allocations
  // until the operator hard-refreshes the host page.
  private iceConfigRefreshTimer: ReturnType<typeof setInterval> | null = null;
  // Exponential-backoff state for the broker-reconnect path. PeerJS's
  // `disconnected` event fires synchronously from the WS's `onclose`
  // handler — if the broker is unreachable or rate-limiting us, the
  // earlier "always reconnect immediately" handler turned that into a
  // ~10 reconnect/sec loop that kept us blocked indefinitely. Backoff
  // breaks the tight loop and lets a transient broker hiccup or rate
  // limit recover without operator intervention. Resets on every
  // successful `open`; cleared on stop().
  private brokerReconnectAttempt = 0;
  private brokerReconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async start() {
    const peerId = getOrCreatePeerId();
    // Fetch the relay's TURN config before constructing Peer — ICE
    // gathers candidates the moment the Peer exists, so a late config
    // wouldn't make it into the offer. If the fetch fails we get an
    // empty array and run direct/STUN-only; the readiness UI tells the
    // operator about it.
    this.iceServers = await fetchHostIceServers();
    // `key: "gonogo"` isolates us from the default `peerjs` namespace on the
    // public 0.peerjs.com broker. Without it, our 4-char ids collide with
    // every other PeerJS app on the planet using the default key — the broker
    // namespace is shared by `key`, so picking our own gives us our own slice.
    // MUST match the `key` set in PeerClientService and packages/relay (any
    // mismatch and that peer is invisible on the broker to our other peers).
    this.peer = new Peer(peerId, {
      ...peerBrokerOptions(),
      ...(this.iceServers.length > 0
        ? { config: { iceServers: this.iceServers } }
        : {}),
    });

    this.peer.on("open", (id) => {
      localStorage.setItem(PEER_ID_KEY, id);
      this.peerId = id;
      // Latches once per session — see the auto-rotate guard in the
      // error handler below for why.
      this.peerHasOpened = true;
      // Reset the broker-reconnect backoff: a successful open means
      // whatever was wrong with the broker WS has cleared, and the next
      // disconnect should retry quickly. Without this reset, a long-
      // lived session that survives one bad-broker stretch would carry
      // a stale 30s backoff forever.
      this.brokerReconnectAttempt = 0;
      if (this.brokerReconnectTimer !== null) {
        clearTimeout(this.brokerReconnectTimer);
        this.brokerReconnectTimer = null;
      }
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
          sessionToken: this.sessionToken,
        } satisfies PeerMessage);
        this.sendSchema(conn);
        // Station needs this to reach the relay directly — resend whenever
        // a new station connects so latecomers aren't stuck in "disconnected".
        // Bundles iceServers so the station's Peer can configure TURN for
        // the station→relay camera channel (without TURN the relay's
        // container-bridge candidates are unreachable from the LAN).
        if (this.relayPeerId !== null) {
          conn.send({
            type: "relay-peer-id",
            peerId: this.relayPeerId,
            iceServers:
              this.iceServers.length > 0 ? this.iceServers : undefined,
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

    // PeerJS quirk: when the broker WebSocket drops, PeerJS sets
    // `peer.disconnected = true` and emits "disconnected", but it does
    // NOT reset that flag automatically when the WS comes back. As a
    // result `peer.connect()` keeps returning undefined forever even
    // though incoming connections still flow through (separate path).
    // The OcislyStreamSource was burning retries against this stuck
    // flag. Calling `peer.reconnect()` here resets the flag and
    // re-handshakes with the broker.
    //
    // Backoff: PeerJS fires `disconnected` synchronously from the WS's
    // own `onclose`, so an immediate `peer.reconnect()` reopens a WS
    // that may immediately fail again — closing the door on a ~10/sec
    // tight loop that hammers the broker and keeps us blocked when
    // peerjs.com is rate-limiting or temporarily unreachable.
    // Exponential 500ms → 30s with a single in-flight timer; resets on
    // the next successful `open`.
    this.peer.on("disconnected", () => {
      if (this.brokerReconnectTimer !== null) return; // already scheduled
      const attempt = ++this.brokerReconnectAttempt;
      const delayMs = Math.min(500 * 2 ** (attempt - 1), 30_000);
      logger.warn(
        `[PeerHost] broker disconnected — scheduling peer.reconnect() in ${delayMs}ms (attempt ${attempt})`,
      );
      this.brokerReconnectTimer = setTimeout(() => {
        this.brokerReconnectTimer = null;
        try {
          this.peer?.reconnect();
        } catch (err) {
          logger.error(
            "[PeerHost] peer.reconnect() threw",
            err instanceof Error ? err : undefined,
          );
        }
      }, delayMs);
    });

    this.peer.on("error", (err) => {
      logger.error("[PeerHost] peer error", err);
      const peerErr = err as { type?: string };
      if (peerErr.type !== "unavailable-id") return;
      // Two paths to recover from `unavailable-id`:
      //   1. Before this Peer has ever opened — no station knows about
      //      this code, rotate silently. This is the "broker still holds
      //      a ghost slot from a prior tab" case.
      //   2. After a successful open — typically post-laptop-sleep where
      //      the broker's session-cleanup timer hasn't yet released our
      //      slot but our `peer.reconnect()` hits it as taken. Stations
      //      may still have live data channels: notify them over the
      //      existing channel before we rotate so their built-in retry
      //      loop targets the new id instead of the dead old one.
      // Both paths end at `peer.destroy()` + `start()` with a fresh id;
      // the difference is whether we broadcast a heads-up first.
      if (this.peerHasOpened) {
        logger.warn(
          "[PeerHost] unavailable-id after a successful open — rotating with station notice",
        );
        void this.rotatePeerIdGracefully("unavailable-id-recovery");
        return;
      }
      void this.regeneratePeerId();
    });

    // Keep the Peer's iceServers in sync with the relay's coturn — every
    // relay restart rotates the shared secret, so creds baked into the
    // Peer's config at start() time would silently fail (401) on any
    // subsequent TURN allocation. Existing data channels survive (their
    // ICE pair is already chosen); only NEW peer connections from this
    // point onward pick up the refreshed creds via the Peer's
    // `_options.config` mutation.
    this.startIceConfigRefresh();

    // Tell the broker we're leaving on page unload. Without this, the WS
    // close races the page teardown and may not flush before the page is
    // gone — the broker then holds the slot for ~30–60s on its keepalive
    // timer, and a quick refresh hits `unavailable-id` and rotates to a
    // fresh share code (forcing every station to be re-shared the new
    // code). `peer.destroy()` sends an explicit leave message before
    // unload completes, so the slot is freed in time for the new page to
    // reclaim the same id; stations' existing retry loop reconnects
    // automatically. `pagehide` (not `beforeunload`) because it fires
    // reliably on mobile + bfcache transitions.
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", () => {
        this.peer?.destroy();
      });
    }
    // Pre-emptive cleanup on tab freeze (Chrome Page Lifecycle API; fires
    // before the OS suspends the page on laptop sleep). `peer.disconnect()`
    // is the surgical move here, not `destroy()`: it sends a clean leave to
    // the broker so the slot is released — avoiding the post-wake
    // "ID is taken" ghost — while keeping the underlying RTCPeerConnections
    // and their data channels open so connected stations don't get torn
    // down by the suspend cycle. On `resume`, peer.reconnect() re-registers
    // with the broker against the same id; nothing else changes. Without
    // this, laptop sleep silently strands the host's broker session and
    // every outgoing peer.connect() (OCISLY etc.) wedges until manual
    // regenerate. `freeze`/`resume` are document events, not window.
    if (typeof document !== "undefined") {
      const suspend = () => {
        if (!this.peer) return;
        const p = this.peer as Peer & { disconnected?: boolean };
        if (p.disconnected) return;
        logger.info(
          "[PeerHost] page freezing — disconnecting broker (keeping live channels)",
        );
        try {
          this.peer.disconnect();
        } catch (err) {
          logger.error(
            "[PeerHost] peer.disconnect() threw on freeze",
            err instanceof Error ? err : undefined,
          );
        }
      };
      const resume = () => {
        if (!this.peer) return;
        const p = this.peer as Peer & {
          disconnected?: boolean;
          reconnect?: () => void;
        };
        if (!p.disconnected) return;
        logger.info(
          "[PeerHost] page resuming — peer.reconnect() to re-register on broker",
        );
        try {
          p.reconnect?.();
        } catch (err) {
          logger.error(
            "[PeerHost] peer.reconnect() threw on resume",
            err instanceof Error ? err : undefined,
          );
        }
      };
      document.addEventListener("freeze", suspend);
      document.addEventListener("resume", resume);
      // `pageshow` covers the bfcache-restore path (back/forward nav) where
      // freeze/resume don't fire but the peer may still need re-registering.
      window.addEventListener("pageshow", resume);
    }
  }

  /**
   * Set (and broadcast) the current relay peer id. Called by the host-side
   * OcislyStreamSource once it resolves the id over HTTP. Passing null tears
   * it back down for all stations.
   */
  private findConnByPeerId(peerId: string): DataConnection | null {
    for (const c of this.connections) if (c.peer === peerId) return c;
    return null;
  }

  /**
   * Register a host-owned data source for back-fill on peer-data-subscribe.
   * Called by PeerBroadcastingDataSource on construction; the wrapper
   * forwards getLatestValue to the real source's cache. Using this map
   * instead of the global registry avoids a same-process race in tests
   * where StationScreen overwrites the "data" entry with a PCDS.
   */
  registerSourceForBackfill(
    sourceId: string,
    source: { getLatestValue?: (key: string) => unknown },
  ): void {
    this.backfillSources.set(sourceId, source);
  }

  /**
   * Push the latest cached value of each `keys` entry down a single conn.
   * Called from the `peer-data-subscribe` handler so a freshly-mounted
   * widget gets the current value immediately rather than waiting for
   * the next change. Without this back-fill, low-rate keys like
   * `v.situationString`, `v.body`, `sci.*`, `career.*` look broken on
   * any station that mounts a widget after the value last changed.
   *
   * Silent no-op if the source doesn't expose `getLatestValue` (e.g. a
   * stream source) or the value hasn't been cached yet (key has never
   * been emitted on the host side).
   */
  private backfillLatest(
    conn: DataConnection,
    sourceId: string,
    keys: readonly string[],
  ): void {
    if (keys.length === 0) return;
    const source = this.backfillSources.get(sourceId);
    const getLatest = source?.getLatestValue;
    if (typeof getLatest !== "function") return;
    for (const key of keys) {
      const value = getLatest.call(source, key);
      if (value === undefined) continue;
      conn.send({
        type: "data",
        sourceId,
        key,
        value,
        t: Date.now(),
      } satisfies PeerMessage);
    }
  }

  setRelayPeerId(peerId: string | null) {
    this.relayPeerId = peerId;
    this.broadcastRelayInfo();
  }

  /**
   * Broadcast the current relay peerId + iceServers to every connected
   * station. Called whenever EITHER changes — without iceServers, stations
   * can't traverse the relay's container bridge for camera streams and
   * every WebRTC negotiation dies with `negotiation-failed`.
   */
  private broadcastRelayInfo(): void {
    this.broadcast({
      type: "relay-peer-id",
      peerId: this.relayPeerId,
      iceServers: this.iceServers.length > 0 ? this.iceServers : undefined,
    });
  }

  /**
   * Send a message to a single connected peer. Used by services that
   * fire on `onPeerConnect` and need to target the new peer specifically
   * (e.g. fog snapshot, where broadcasting would re-deliver large mask
   * payloads to every existing station). Silently no-ops if the peer
   * isn't connected.
   */
  sendToPeer(peerId: string, msg: PeerMessage): void {
    const conn = this.findConnByPeerId(peerId);
    if (!conn) return;
    conn.send(msg);
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
    "note-add": (msg, conn) => {
      this.noteAddListeners.fire(conn.peer, msg);
    },
    "note-update": (msg, conn) => {
      this.noteUpdateListeners.fire(conn.peer, msg);
    },
    "note-delete": (msg, conn) => {
      this.noteDeleteListeners.fire(conn.peer, msg.id);
    },
    "note-reorder": (msg, conn) => {
      this.noteReorderListeners.fire(conn.peer, msg);
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
      // Track which keys are *new* in this subscribe so we only back-fill
      // for them — a station re-asserting an existing subscription
      // shouldn't trigger a flood of cached re-sends.
      const fresh: string[] = [];
      for (const k of msg.keys) {
        if (!bucket.has(k)) fresh.push(k);
        bucket.add(k);
      }
      // Back-fill the latest cached value for each fresh key. Without
      // this, a station that mounts a widget mid-flight gets nothing for
      // any key whose value last changed before it subscribed — fatal
      // for low-rate keys like v.situationString, v.body, sci.* / career.*
      // which may not change again for the rest of the mission. We push
      // directly to this conn instead of going through `broadcast` so
      // other peers don't receive a duplicate sample.
      this.backfillLatest(conn, msg.sourceId, fresh);
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

  onNoteAdd(cb: NoteAddListener): () => void {
    return this.noteAddListeners.add(cb);
  }
  onNoteUpdate(cb: NoteUpdateListener): () => void {
    return this.noteUpdateListeners.add(cb);
  }
  onNoteDelete(cb: NoteDeleteListener): () => void {
    return this.noteDeleteListeners.add(cb);
  }
  onNoteReorder(cb: NoteReorderListener): () => void {
    return this.noteReorderListeners.add(cb);
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

  /**
   * Close every live DataConnection while keeping the Peer (and its
   * broker registration) alive. Each station's PeerClientService sees
   * a close event and runs its retry policy — if this host is still
   * reachable under the same id, the reconnect succeeds and the
   * station's banner clears. Used by the host-disconnect Playwright
   * recovery test; harmless in production but not wired to any UI.
   */
  closeAllConnections(): void {
    for (const conn of this.connections) {
      conn.close();
    }
  }

  stop() {
    this.kosSessions.closeAll();
    this.flightChangeUnsub?.();
    this.flightChangeUnsub = null;
    this.flightListChangeUnsub?.();
    this.flightListChangeUnsub = null;
    this.currentFlightSnapshot = null;
    this.stopIceConfigRefresh();
    if (this.brokerReconnectTimer !== null) {
      clearTimeout(this.brokerReconnectTimer);
      this.brokerReconnectTimer = null;
    }
    this.brokerReconnectAttempt = 0;
    this.peer?.destroy();
    this.peer = null;
    this.peerId = null;
    this.peerHasOpened = false;
    this.connections.clear();
    this.idListeners.fire(null);
    logger.info("[PeerHost] stopped");
  }

  /**
   * Re-fetch `/ice-config` every 60s and reseed the Peer's config when
   * the credentials change. Runs only while a Peer is alive — `stop()`
   * clears the timer. Empty fetches (relay unreachable) are ignored so
   * a transient blip doesn't drop us back to STUN-only mid-session.
   */
  private startIceConfigRefresh(): void {
    if (this.iceConfigRefreshTimer) return;
    const REFRESH_MS = 60_000;
    this.iceConfigRefreshTimer = setInterval(() => {
      void this.refreshIceConfig();
    }, REFRESH_MS);
  }

  private stopIceConfigRefresh(): void {
    if (!this.iceConfigRefreshTimer) return;
    clearInterval(this.iceConfigRefreshTimer);
    this.iceConfigRefreshTimer = null;
  }

  private async refreshIceConfig(): Promise<void> {
    if (!this.peer) return;
    const next = await fetchHostIceServers();
    // Empty fetch = relay unreachable. Don't clobber working creds with
    // nothing — TURN-relayed paths in flight would lose their refresh.
    if (next.length === 0) return;
    if (areIceServersEqual(this.iceServers, next)) return;
    this.iceServers = next;
    // PeerJS's Peer doesn't expose a public setter for `iceServers`, so
    // reach into `_options.config`. New peer.connect() / peer.call()
    // calls grab `_options.config` when constructing the underlying
    // RTCPeerConnection, so the next ICE attempt picks up the fresh
    // creds. Existing connections aren't disturbed (their ICE pair is
    // already negotiated).
    const opts = (
      this.peer as unknown as {
        _options?: { config?: { iceServers: RTCIceServer[] } };
      }
    )._options;
    if (opts) {
      opts.config = { iceServers: next };
    }
    logger.info(
      "[PeerHost] ice-config refreshed — new TURN creds active for future connections",
    );
    // Push the refresh to every connected station so their station→relay
    // peer connections can pick up the new credentials too. Without this,
    // a coturn secret rotation (relay restart) would silently break
    // station camera streams until each station refreshes.
    this.broadcastRelayInfo();
  }

  /**
   * Drop the persisted host id and bring up a fresh Peer with a new
   * four-character share code. Used by the operator-facing regenerate
   * button in the Add Station modal — primarily as a recovery from the
   * "ID is taken" rejection (a previous tab/process left a ghost session
   * the broker is still holding) but also as a generic "rotate the
   * code" action. Tears down every active station data channel; the
   * operator is expected to re-share via QR or copied link.
   */
  async regeneratePeerId(): Promise<void> {
    logger.info("[PeerHost] regenerating peer id");
    this.stop();
    localStorage.removeItem(PEER_ID_KEY);
    await this.start();
  }

  /**
   * Rotate to a fresh share code without stranding currently-connected
   * stations. Sends `host-id-rotation` over each live data channel BEFORE
   * tearing the peer down, so the station's auto-reconnect targets the
   * new id rather than retrying the dead old one. The 500ms flush window
   * is empirical — typical LAN data-channel RTT is <50ms, and the
   * message is small (~80 bytes), so half a second comfortably covers a
   * one-way delivery even on a stressed link. Stations whose channels
   * have already died before this fires (long sleep, MTU change, etc.)
   * will need a manual reconnect — that's the residual edge case the
   * Add Station modal's Regenerate button still serves.
   *
   * Used by the unavailable-id recovery path; replaces the previous
   * "keep existing code, manual Regenerate available" behaviour, which
   * left the host wedged until the operator noticed.
   */
  async rotatePeerIdGracefully(reason: string): Promise<void> {
    const newPeerId = generateShortId();
    const liveConns = this.connections.size;
    logger.info(
      `[PeerHost] rotating peer id — reason=${reason}, newId=${newPeerId}, liveConns=${liveConns}`,
    );
    if (liveConns > 0) {
      this.broadcast({ type: "host-id-rotation", newPeerId, reason });
      // Empirical flush window — see method JSDoc.
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
    }
    this.stop();
    localStorage.setItem(PEER_ID_KEY, newPeerId);
    await this.start();
  }
}

export const peerHostService = new PeerHostService();

// Expose on window so the Playwright multi-screen integration test can
// read `peerHostService.peerId` without depending on dashboard chrome
// (the FAB cluster sits below the grid layout in z-order; pointer
// interception makes the share-code modal unreliable for tests). Also
// useful for browser-console debugging without the dev-tools React
// component hierarchy walk. Harmless in production — only adds a single
// reference to an already-singleton service.
if (typeof window !== "undefined") {
  (window as unknown as { peerHostService?: PeerHostService }).peerHostService =
    peerHostService;
}
