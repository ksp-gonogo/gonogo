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
import { deriveHostPeerId } from "./hostPeerId";
import { fetchHostIceServers, relayBaseUrl } from "./iceServers";
import { KosSessionManager } from "./KosSessionManager";
import { MessageDispatcher } from "./MessageDispatcher";
import { peerBrokerOptions } from "./peerOptions";
import type { PeerMessage } from "./protocol";

// The host's sole persisted identity. The PeerJS peer id is now *derived*
// from this code (`gonogo-host-<CODE>`), not persisted — stations derive the
// same id from the operator-typed code and connect directly, no broker
// directory in between. See `hostPeerId.ts` for the derivation.
const SHARE_CODE_KEY = "gonogo-host-share-code";

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

/**
 * The host's stable share-code, minted once and persisted. The PeerJS peer
 * id is derived from it (`gonogo-host-<CODE>`); a host refresh re-claims the
 * *same* derived id, so the operator's code stays valid and stations
 * reconnect transparently. Only `regenerateShareCode()` changes it.
 */
function getOrCreateShareCode(): string {
  const saved = localStorage.getItem(SHARE_CODE_KEY);
  if (saved) return saved;
  const code = generateShortId();
  localStorage.setItem(SHARE_CODE_KEY, code);
  return code;
}

/** Heartbeat cadence for re-registering the share-code → peer-id mapping.
 *  Well within the relay's ~90s TTL so a single missed beat doesn't expire
 *  the entry. */
const HOST_HEARTBEAT_MS = 30_000;
const RELAY_POST_TIMEOUT_MS = 4_000;

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
    {
      getLatestValue?: (key: string) => unknown;
      schema?: () => Array<{ key: string }>;
      subscribe?: (key: string, cb: (value: unknown) => void) => () => void;
    }
  >();
  // Refcounted upstream subscribes for demand-only keys (`v.topology`,
  // `v.topologySeq`, `v.partState[…]`, `b.name[…]`, etc.) — keys that
  // aren't in a source's static schema, so PeerBroadcastingDataSource
  // never subscribes to them at construction. Without this, a station's
  // `peer-data-subscribe` would only ever get a single back-fill of the
  // last cached value (which is whatever a host-side widget happened to
  // pull most recently), then go silent on subsequent updates. That's
  // the 2026-05-17 ShipMap-sluggish-on-stations bug: stations froze on
  // the topology snapshot from the moment of subscribe and only
  // refreshed after a full reload re-armed the subscribe.
  //
  // Map<sourceId, Map<key, { refCount, unsub }>> — refCount is the
  // number of peer connections that have asked for this (sourceId, key)
  // pair. When it hits zero we tear the upstream sub down.
  private readonly peerDrivenSubs = new Map<
    string,
    Map<string, { refCount: number; unsub: () => void }>
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
  // Operator's technical-analytics consent. Retained (not just broadcast
  // transiently) so it can be sent to each station on connect and
  // re-asserted to the relay on every heartbeat. Privacy-first default:
  // disabled until the host's consent service drives it via
  // setAnalyticsConsent.
  private analyticsConsent = false;
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

  /** The host's broker peer id — the *derived* `gonogo-host-<shareCode>`
   *  form (NOT the operator-facing 4-char code). Null until the broker
   *  confirms it with an `open`. Stations connect to this directly; the
   *  operator never sees it (they see `shareCode`). */
  peerId: string | null = null;
  /** Stable, operator-facing share-code. Persisted and stable across host
   *  refreshes — the "Add station" UI shows this, stations type/scan it,
   *  and both ends derive the broker peer id from it. The operator can mint
   *  a fresh one on demand via `regenerateShareCode()` (the Add Station
   *  modal's reset control); that's the only thing that changes it. */
  shareCode: string = getOrCreateShareCode();
  private shareCodeListeners = new ListenerSet<[string]>();
  /** ICE servers fetched from the relay on start(). Exposed so the
   *  TURN reachability probe can re-use exactly what the host's Peer
   *  was constructed with. Empty `[]` means the fetch failed or no
   *  relay is configured. */
  iceServers: RTCIceServer[] = [];
  /** True once the relay has accepted a `shareCode → peerId` registration
   *  (`POST /host` returned 2xx). This — not `iceServers` (which is `[]`
   *  whenever coturn is down but the relay process is up) — is the signal
   *  the "Add station" UI gates on to decide whether to surface the
   *  share-code (resolvable) or fall back to the raw peer id. */
  relayRegistered = false;

  private flightChangeUnsub: (() => void) | null = null;
  private flightListChangeUnsub: (() => void) | null = null;
  private currentFlightSnapshot: FlightRecord | null = null;
  /** True while we're retry-reclaiming the derived peer id after an
   *  `unavailable-id` (broker still holds a stale slot from an unclean
   *  prior tab). Drives the main-screen "Reclaiming your share code…"
   *  status. Cleared on the next successful `open`. */
  private reclaiming = false;
  private reclaimingListeners = new ListenerSet<[boolean]>();
  /** Exponential-backoff state for the reclaim loop. Separate from the
   *  broker-reconnect backoff (which keeps the *same* id over a transient
   *  WS blip) — reclaim destroys the dead Peer and re-claims the same
   *  derived id until the broker frees the stale one (~30–60s). */
  private reclaimAttempt = 0;
  private reclaimTimer: ReturnType<typeof setTimeout> | null = null;
  // Polls the relay's `/ice-config` so a relay restart (which mints a
  // fresh coturn shared secret on every boot) doesn't leave the host's
  // Peer pinned to stale TURN credentials. Without this, a `pnpm dev`
  // rebuild of the relay container silently breaks new TURN allocations
  // until the operator hard-refreshes the host page.
  private iceConfigRefreshTimer: ReturnType<typeof setInterval> | null = null;
  // Periodically re-POSTs the share-code → peer-id mapping to the relay so
  // its entry doesn't expire (TTL ~90s). Started on the first PeerJS open,
  // stopped in stop(). Best-effort throughout — relay down just means
  // stations fall back to treating the typed code as a direct peer id.
  private relayHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
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
  // Page-lifecycle listeners registered once in `start()` and removed in
  // `stop()`. Held as bound refs so they're removable (the old code added
  // anonymous closures that leaked across StrictMode start→stop→start, and
  // double-registered the pagehide/freeze/resume handlers each remount).
  private lifecycleListenersAttached = false;
  private readonly onPageHide = () => this.destroyPeer();
  private readonly onBeforeUnload = () => this.destroyPeer();
  private readonly onFreeze = () => this.suspendBroker();
  private readonly onResume = () => this.resumeBroker();

  async start() {
    // Fetch the relay's TURN config before constructing Peer — ICE
    // gathers candidates the moment the Peer exists, so a late config
    // wouldn't make it into the offer. If the fetch fails we get an
    // empty array and run direct/STUN-only; the readiness UI tells the
    // operator about it.
    this.iceServers = await fetchHostIceServers();
    // Page-lifecycle listeners are registered ONCE per service lifetime
    // (idempotent guard) so a StrictMode start→stop→start cycle — or a
    // reclaim that re-opens the Peer — doesn't stack duplicate handlers.
    this.attachLifecycleListeners();
    // Keep the Peer's iceServers in sync with the relay's coturn — every
    // relay restart rotates the shared secret, so creds baked into the
    // Peer's config at start() time would silently fail (401) on any
    // subsequent TURN allocation.
    this.startIceConfigRefresh();
    this.openPeer();
  }

  /**
   * Construct the PeerJS Peer claiming the *derived* `gonogo-host-<code>`
   * id and wire all of its events. Separate from `start()` so the reclaim
   * loop can re-open a fresh Peer (after the broker frees a stale slot)
   * WITHOUT re-fetching ice config or re-registering page-lifecycle
   * listeners. The derived id is deterministic, so every open — first
   * launch, refresh, reclaim — targets the same broker slot.
   */
  private openPeer(): void {
    // A Peer is already live. This guards the StrictMode double-start race:
    // PeerHostProvider's effect fires start() without awaiting, so a
    // mount→unmount→mount runs start→stop→start, and because start() suspends
    // at `await fetchHostIceServers()` BEFORE creating the Peer, two start()s
    // can both reach openPeer(). Without this guard the second would leak the
    // first Peer (same derived id) and trip a permanent unavailable-id reclaim
    // loop. The reclaim + regenerate paths both null `this.peer` before
    // calling openPeer(), so they're unaffected.
    if (this.peer) return;
    const peerId = deriveHostPeerId(this.shareCode);
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
      this.peerId = id;
      // A successful open means the broker accepted our (derived) id —
      // clear any in-flight reclaim and reset its backoff.
      if (this.reclaiming || this.reclaimTimer !== null) {
        if (this.reclaimTimer !== null) {
          clearTimeout(this.reclaimTimer);
          this.reclaimTimer = null;
        }
        this.reclaimAttempt = 0;
        this.setReclaiming(false);
      }
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
      // Tag every subsequent log entry with this device's identity. The
      // human-facing device id is the 4-char SHARE CODE (what the operator
      // shares); the broker peer id is the derived `gonogo-host-<code>`.
      logger.setIdentity({ role: "host", id: this.shareCode, peerId: id });
      logger.info(`[PeerHost] open — id=${id} (shareCode=${this.shareCode})`);
      this.idListeners.fire(id);
      // Best-effort relay registration for diagnostics only — discovery no
      // longer depends on it (stations derive the id from the code). The
      // heartbeat keeps the entry alive for the session.
      void this.registerWithRelay();
      this.startRelayHeartbeat();
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
        //
        // Send when there's a relay peer id (OCISLY) OR just TURN creds: a
        // brokered kerbcam station has no relay *peer* (it streams direct from
        // the sidecar) but still needs the relay's TURN creds for the non-LAN
        // hop, and a station can't fetch /ice-config itself (localhost).
        if (this.relayPeerId !== null || this.iceServers.length > 0) {
          conn.send({
            type: "relay-peer-id",
            peerId: this.relayPeerId,
            iceServers:
              this.iceServers.length > 0 ? this.iceServers : undefined,
          } satisfies PeerMessage);
        }
        // Tell the joining station the host's current analytics consent so
        // it gates its own Axiom transport from the moment it connects.
        conn.send({
          type: "analytics-consent",
          enabled: this.analyticsConsent,
        } satisfies PeerMessage);
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
        // Release any demand-only upstream subscribes held on behalf
        // of this peer. WeakMap-keyed by `conn`, so we must read it
        // before the conn drops out of scope. Without this, leaving
        // stations leak the per-key refCount and the upstream
        // subscribe stays pinned forever.
        const subs = this.peerSubs.get(conn);
        if (subs) {
          for (const [sourceId, keys] of subs) {
            for (const key of keys) {
              this.releasePeerDrivenSub(sourceId, key);
            }
          }
        }
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
      // The broker still holds a stale slot for our derived id — almost
      // always a prior tab/process that didn't send a clean leave (the
      // broker frees it on its ~30–60s keepalive timer). We do NOT rotate
      // to a different id (that would invalidate the operator's share code
      // and every station's reconnect target). Instead we retry-RECLAIM the
      // SAME derived id with backoff until the broker releases it; stations
      // reconnect automatically the moment it comes back.
      this.scheduleReclaim();
    });
  }

  /**
   * Retry-reclaim the derived peer id after an `unavailable-id`. Destroys
   * the dead Peer, surfaces the "reclaiming" status, and schedules a
   * backed-off `openPeer()` against the SAME id. Each subsequent
   * `unavailable-id` (the broker hasn't freed the slot yet) lengthens the
   * backoff up to a 30s cap — the broker's stale-slot timer fires within
   * ~30–60s, so we keep trying until `openPeer()`'s `open` clears it.
   */
  private scheduleReclaim(): void {
    this.setReclaiming(true);
    // Tear the dead Peer down so the next openPeer() starts clean. destroyPeer
    // is idempotent, so a concurrent pagehide is harmless.
    this.destroyPeer();
    if (this.reclaimTimer !== null) return; // already scheduled
    const attempt = ++this.reclaimAttempt;
    const delayMs = Math.min(1_000 * 2 ** (attempt - 1), 30_000);
    logger.warn(
      `[PeerHost] unavailable-id — reclaiming derived id in ${delayMs}ms (attempt ${attempt})`,
    );
    this.reclaimTimer = setTimeout(() => {
      this.reclaimTimer = null;
      this.openPeer();
    }, delayMs);
  }

  private setReclaiming(next: boolean): void {
    if (this.reclaiming === next) return;
    this.reclaiming = next;
    this.reclaimingListeners.fire(next);
  }

  /**
   * Subscribe to reclaim status. Fires the current value immediately (so a
   * late subscriber — e.g. the Add Station modal opening mid-reclaim — sees
   * the right state) and on every change. The main screen surfaces a
   * "Reclaiming your share code…" status while true.
   */
  onReclaimingChange(cb: (reclaiming: boolean) => void): () => void {
    const unsub = this.reclaimingListeners.add(cb);
    const value = this.reclaiming;
    queueMicrotask(() => cb(value));
    return unsub;
  }

  /** Whether the host is currently retry-reclaiming its derived id. */
  isReclaiming(): boolean {
    return this.reclaiming;
  }

  /**
   * Destroy the current Peer and null it out. Idempotent — safe to call
   * from a `pagehide`+`beforeunload` double-fire or after `stop()` has
   * already torn it down. Frees the broker slot immediately so a normal
   * refresh reclaims the derived id instantly.
   */
  private destroyPeer(): void {
    const peer = this.peer;
    if (!peer) return;
    this.peer = null;
    try {
      peer.destroy();
    } catch (err) {
      logger.error(
        "[PeerHost] peer.destroy() threw",
        err instanceof Error ? err : undefined,
      );
    }
  }

  /**
   * Register the page-lifecycle listeners exactly once. `pagehide` +
   * `beforeunload` both `destroyPeer()` so the broker frees the derived id
   * the instant the page goes away — letting a quick refresh re-claim it
   * without hitting `unavailable-id`. `freeze`/`resume` keep live data
   * channels up across laptop sleep. All handlers are bound refs so
   * `stop()` can remove them cleanly (StrictMode start→stop→start would
   * otherwise leak a fresh set each remount).
   */
  private attachLifecycleListeners(): void {
    if (this.lifecycleListenersAttached) return;
    this.lifecycleListenersAttached = true;
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", this.onPageHide);
      window.addEventListener("beforeunload", this.onBeforeUnload);
      window.addEventListener("pageshow", this.onResume);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("freeze", this.onFreeze);
      document.addEventListener("resume", this.onResume);
    }
  }

  private detachLifecycleListeners(): void {
    if (!this.lifecycleListenersAttached) return;
    this.lifecycleListenersAttached = false;
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.onPageHide);
      window.removeEventListener("beforeunload", this.onBeforeUnload);
      window.removeEventListener("pageshow", this.onResume);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("freeze", this.onFreeze);
      document.removeEventListener("resume", this.onResume);
    }
  }

  /**
   * Pre-emptive cleanup on tab freeze (Chrome Page Lifecycle API; fires
   * before the OS suspends the page on laptop sleep). `peer.disconnect()`
   * is the surgical move — not `destroy()`: it sends a clean leave to the
   * broker so the slot is released (avoiding the post-wake "ID is taken"
   * ghost) while keeping the underlying RTCPeerConnections + data channels
   * open so connected stations aren't torn down by the suspend cycle.
   */
  private suspendBroker(): void {
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
  }

  /**
   * On `resume`/`pageshow`, re-register with the broker against the same
   * (derived) id. Covers laptop wake and the bfcache-restore path.
   */
  private resumeBroker(): void {
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
    source: {
      getLatestValue?: (key: string) => unknown;
      schema?: () => Array<{ key: string }>;
      subscribe?: (key: string, cb: (value: unknown) => void) => () => void;
    },
  ): void {
    this.backfillSources.set(sourceId, source);
  }

  /**
   * Ensure an upstream subscribe is active for a demand-only key on
   * behalf of one or more peer connections. Schema keys are skipped —
   * `PeerBroadcastingDataSource` already broadcasts them from its
   * constructor-time subscribe loop, and adding a second subscriber
   * would double every broadcast (one PBDS-driven, one peer-driven).
   *
   * Refcount tracks how many peer connections have asked. The actual
   * upstream subscribe lives on the wrapped source; the broadcast
   * callback fires `this.broadcast` so the per-peer `peerSubs` filter
   * inside `broadcastData` delivers the sample only to peers that
   * subscribed.
   */
  private retainPeerDrivenSub(sourceId: string, key: string): void {
    const source = this.backfillSources.get(sourceId);
    if (!source?.subscribe) return;
    const schemaKeys = source.schema?.() ?? [];
    if (schemaKeys.some((k) => k.key === key)) return;
    let perSource = this.peerDrivenSubs.get(sourceId);
    if (!perSource) {
      perSource = new Map();
      this.peerDrivenSubs.set(sourceId, perSource);
    }
    const existing = perSource.get(key);
    if (existing) {
      existing.refCount += 1;
      return;
    }
    const unsub = source.subscribe(key, (value) => {
      this.broadcast({
        type: "data",
        sourceId,
        key,
        value,
        t: Date.now(),
      });
    });
    perSource.set(key, { refCount: 1, unsub });
  }

  private releasePeerDrivenSub(sourceId: string, key: string): void {
    const perSource = this.peerDrivenSubs.get(sourceId);
    const entry = perSource?.get(key);
    if (!entry || !perSource) return;
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      entry.unsub();
      perSource.delete(key);
      if (perSource.size === 0) this.peerDrivenSubs.delete(sourceId);
    }
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
   * Set the operator's technical-analytics consent. Retains the value,
   * broadcasts it to every connected station, and POSTs it to the relay
   * config broker so the services (relay + telnet-proxy) learn the new
   * state. Idempotent on no-change — but always re-POSTs so a relay that
   * restarted re-learns the current value even if it didn't flip here.
   * Called by the main screen's AnalyticsConsentHost on mount + change.
   */
  setAnalyticsConsent(enabled: boolean): void {
    const changed = this.analyticsConsent !== enabled;
    this.analyticsConsent = enabled;
    if (changed) {
      this.broadcast({ type: "analytics-consent", enabled });
    }
    void this.postAnalyticsConfig();
  }

  /** Current retained consent — exposed for the heartbeat re-assert and
   *  for tests. */
  getAnalyticsConsent(): boolean {
    return this.analyticsConsent;
  }

  /**
   * POST the current consent to the relay's `/analytics-config` broker.
   * Best-effort: relay down / non-2xx is logged at debug and swallowed,
   * exactly like the host-registry POST. The heartbeat re-asserts this so
   * a relay restart re-learns the real value (the relay defaults to
   * disabled until first POST).
   */
  private async postAnalyticsConfig(): Promise<void> {
    const url = `${relayBaseUrl()}/analytics-config`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RELAY_POST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: this.analyticsConsent }),
        signal: controller.signal,
      });
      if (!res.ok) {
        debugPeer("host analytics-config POST non-ok", { status: res.status });
      }
    } catch (err) {
      debugPeer("host analytics-config POST failed", {
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      clearTimeout(timer);
    }
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
    "kerbcam-negotiate-request": (msg, conn) => {
      void this.handleKerbcamNegotiate(msg, conn);
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
      // For demand-only keys (not in the source's static schema, so
      // PBDS hasn't subscribed to them), bring up a peer-driven upstream
      // subscribe so subsequent samples actually flow. Schema keys are
      // already handled by PBDS; retainPeerDrivenSub is a no-op for them.
      for (const k of fresh) {
        this.retainPeerDrivenSub(msg.sourceId, k);
      }
    },
    "peer-data-unsubscribe": (msg, conn) => {
      const subs = this.peerSubs.get(conn);
      const bucket = subs?.get(msg.sourceId);
      if (!bucket) return;
      for (const k of msg.keys) {
        if (bucket.delete(k)) {
          this.releasePeerDrivenSub(msg.sourceId, k);
        }
      }
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

  // Station broker: relay a station's kerbcam offer to the local sidecar (only
  // the main screen can reach its address) and return the answer. Signaling
  // only — media flows station↔sidecar directly off the answer's ICE candidates.
  private async handleKerbcamNegotiate(
    msg: Extract<PeerMessage, { type: "kerbcam-negotiate-request" }>,
    conn: DataConnection,
  ) {
    const { getDataSource } = await import("@gonogo/core");
    const source = getDataSource("kerbcam") as
      | (ReturnType<typeof getDataSource> & {
          relayOffer?: (offer: {
            sdp: string;
            cameras: number[];
            slots?: number;
          }) => Promise<{ sdp: string; cameras: number[] }>;
        })
      | undefined;
    const respond = (
      answer?: { sdp: string; cameras: number[] },
      error?: string,
    ) => {
      conn.send({
        type: "kerbcam-negotiate-response",
        requestId: msg.requestId,
        answer,
        error,
      } satisfies PeerMessage);
    };
    if (!source || typeof source.relayOffer !== "function") {
      respond(undefined, "kerbcam source unavailable on host");
      return;
    }
    try {
      const answer = await source.relayOffer(msg.offer);
      respond(answer);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error("[PeerHost] kerbcam negotiate failed", error);
      respond(undefined, error.message);
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
    this.stopRelayHeartbeat();
    this.setRelayRegistered(false);
    this.detachLifecycleListeners();
    if (this.brokerReconnectTimer !== null) {
      clearTimeout(this.brokerReconnectTimer);
      this.brokerReconnectTimer = null;
    }
    this.brokerReconnectAttempt = 0;
    if (this.reclaimTimer !== null) {
      clearTimeout(this.reclaimTimer);
      this.reclaimTimer = null;
    }
    this.reclaimAttempt = 0;
    this.setReclaiming(false);
    this.destroyPeer();
    this.peerId = null;
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

  /**
   * POST the current `{ shareCode, peerId }` to the relay's host registry.
   * DIAGNOSTICS ONLY under the stable-host-id model — discovery no longer
   * depends on this (stations derive the broker id from the share code).
   * Best-effort: any failure (relay down, timeout, non-2xx) is logged at
   * debug and swallowed. No-op until the Peer has an id.
   */
  private async registerWithRelay(): Promise<void> {
    const peerId = this.peerId;
    if (!peerId) return;
    const url = `${relayBaseUrl()}/host`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RELAY_POST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shareCode: this.shareCode, peerId }),
        signal: controller.signal,
      });
      if (!res.ok) {
        debugPeer("host relay register non-ok", {
          status: res.status,
          shareCode: this.shareCode,
        });
        this.setRelayRegistered(false);
        return;
      }
      debugPeer("host registered with relay", {
        shareCode: this.shareCode,
        peerId,
      });
      this.setRelayRegistered(true);
    } catch (err) {
      // Relay unreachable is the common, expected case (no relay deployed,
      // local-only dev). Keep it at debug so it doesn't spam the ring buffer.
      debugPeer("host relay register failed", {
        message: err instanceof Error ? err.message : String(err),
      });
      this.setRelayRegistered(false);
    } finally {
      clearTimeout(timer);
    }
  }

  private setRelayRegistered(next: boolean): void {
    if (this.relayRegistered === next) return;
    this.relayRegistered = next;
  }

  /**
   * Subscribe to share-code changes. Fires with the current value
   * immediately (so a late subscriber sees the right code without waiting
   * for a regenerate) and on every subsequent change. The share-code only
   * changes when the operator clicks the Add Station modal's reset control
   * (`regenerateShareCode()`); a plain peer-id rotation leaves it alone.
   * The modal subscribes to this so a regenerate visibly updates the
   * displayed code even though the peer id (and `relayRegistered`) are
   * unchanged.
   */
  onShareCodeChange(cb: (shareCode: string) => void): () => void {
    const unsub = this.shareCodeListeners.add(cb);
    const code = this.shareCode;
    queueMicrotask(() => cb(code));
    return unsub;
  }

  /**
   * Begin the periodic relay heartbeat so the share-code → peer-id mapping
   * doesn't expire (relay TTL ~90s). Idempotent — a second call while the
   * timer is live is a no-op. Cleared in stop().
   */
  private startRelayHeartbeat(): void {
    if (this.relayHeartbeatTimer) return;
    this.relayHeartbeatTimer = setInterval(() => {
      void this.registerWithRelay();
      // Re-assert analytics consent on the same cadence so a relay restart
      // (which resets its in-memory config to disabled) re-learns the real
      // value within one heartbeat.
      void this.postAnalyticsConfig();
    }, HOST_HEARTBEAT_MS);
  }

  private stopRelayHeartbeat(): void {
    if (!this.relayHeartbeatTimer) return;
    clearInterval(this.relayHeartbeatTimer);
    this.relayHeartbeatTimer = null;
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
   * Mint a fresh operator-facing share-code and re-claim the new derived
   * `gonogo-host-<newCode>` peer id. Used by the Add Station modal's reset
   * control — a clean teardown of the old Peer (freeing the old derived
   * id's broker slot) followed by a fresh `openPeer()` against the new
   * derived id. Every live station data channel drops; stations that held
   * the old code must be re-shared the new one (the old code stops working
   * because nothing on the broker answers to its derived id any more).
   *
   * Also doubles as the "host stuck" recovery: a fresh code sidesteps a
   * broker slot the old code can't reclaim.
   */
  async regenerateShareCode(): Promise<void> {
    const next = generateShortId();
    logger.info(`[PeerHost] regenerating share code — newCode=${next}`);
    // Tear the current Peer + timers down cleanly, then mint the new code
    // and bring a fresh Peer up against its derived id. stop() also detaches
    // lifecycle listeners, so re-attach them via start().
    this.stop();
    localStorage.setItem(SHARE_CODE_KEY, next);
    this.shareCode = next;
    this.shareCodeListeners.fire(next);
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
