import type { DataSourceStatus } from "@ksp-gonogo/core";
import type {
  DataKeyMeta,
  FlightChapterRecord,
  FlightRecord,
} from "@ksp-gonogo/data";
import type { AlarmSnapshot } from "../alarms/types";

/**
 * Flight-history RPC ops. The host owns the canonical FlightRecord store
 * (BufferedDataSource); stations call these via `flight-rpc-request` to
 * read or mutate flights remotely. Result shapes match the corresponding
 * BufferedDataSource methods so PeerClientDataSource can be a thin
 * forwarder.
 */
export type FlightRpcOp =
  | { op: "list" }
  | { op: "get"; id: string }
  | { op: "getCurrent" }
  | { op: "export"; id: string }
  | { op: "delete"; id: string }
  | { op: "clearAll" }
  | { op: "setStarred"; id: string; starred: boolean }
  | { op: "pruneKeepLatest"; keepCount: number }
  | {
      op: "addChapter";
      flightId: string;
      chapter: Omit<FlightChapterRecord, "id"> & { id?: string };
    }
  | {
      op: "updateChapter";
      flightId: string;
      chapterId: string;
      patch: Partial<Omit<FlightChapterRecord, "id">>;
    }
  | { op: "removeChapter"; flightId: string; chapterId: string };

export type { DataSourceStatus, FlightRecord };

export interface PeerSchemaSource {
  id: string;
  name: string;
  keys: DataKeyMeta[];
}

export type PeerMessage =
  // Sent by the host as the first message on every new connection so the
  // station can compare versions and surface a banner on mismatch. Always
  // emitted before `schema`; absence on the wire means the host is on a
  // pre-versioned bundle and the station should treat the host version as
  // unknown. `sessionToken` is fresh per host page-load so stations can
  // distinguish "transient broker hiccup, same host process" from "host
  // restarted" — used to clear stale GO/NO-GO votes that would otherwise
  // re-broadcast from station memory on reconnect. Optional for
  // back-compat.
  | {
      type: "hello";
      version: string;
      buildTime: string;
      sessionToken?: string;
    }
  | {
      type: "schema";
      sources: PeerSchemaSource[];
    }
  | { type: "status"; sourceId: string; status: DataSourceStatus }
  // `t` is the host's sample timestamp, optional so partial deploys stay
  // wire-compatible — the client falls back to Date.now() when absent.
  | { type: "data"; sourceId: string; key: string; value: unknown; t?: number }
  // Station → host: fire-and-forget action dispatch. No `requestId`/reply —
  // `execute-result` used to exist as a reply variant but was never
  // constructed or handled anywhere (dead code, removed).
  | { type: "execute"; sourceId: string; action: string }
  | {
      type: "query-range-request";
      requestId: string;
      sourceId: string;
      key: string;
      tStart: number;
      tEnd: number;
      flightId?: string;
    }
  | {
      type: "query-range-response";
      requestId: string;
      t: number[];
      v: unknown[];
      error?: string;
    }
  // Broadcast from host → stations so stations know which peer to connect to
  // for camera streams. Sent on initial station connect (if known) and again
  // whenever the relay is re-resolved. null means the main screen no longer
  // has a live relay connection.
  //
  // `iceServers` carries the relay's TURN credentials (the same payload
  // the host fetched from /ice-config). Stations need this for their
  // station→relay peer connection — without it the station's Peer
  // gathers only host-LAN candidates and the relay's container-bridge
  // candidates are unreachable from the LAN, causing every
  // negotiation-failed event in the 2026-05-17 evening session. Older
  // station builds that don't read this field still work, just only
  // when the router supports NAT-hairpin to the relay container.
  | {
      type: "relay-peer-id";
      peerId: string | null;
      iceServers?: RTCIceServer[];
    }
  // Station → host: relay a single call through to a host-side handle
  // registered for `uplinkId` (see `@ksp-gonogo/core`'s
  // `registerUplinkHandle`/`getUplinkHandle`). Generic replacement for what
  // used to be one hardcoded request/response pair per Uplink (in-game
  // script dispatch, camera WebRTC offer/answer signaling) — a station
  // never talks to the underlying system directly (see the app's "main
  // screen is the sole KSP data consumer" constraint), so any Uplink action
  // a station triggers has to relay through the host and come back.
  // `method`/`args` are opaque to the peer layer; each Uplink's own client
  // code owns casting them to its real shape. requestId-correlated like
  // `query-range-*`.
  | {
      type: "uplink-relay-request";
      requestId: string;
      uplinkId: string;
      method: string;
      args: unknown;
    }
  | {
      type: "uplink-relay-response";
      requestId: string;
      result?: unknown;
      error?: string;
      // Free-form bag for Uplink-specific error classification that doesn't
      // fit a plain string (e.g. distinguishing a script-author fault from a
      // transport fault). The peer layer never reads this; it exists purely
      // so the calling Uplink's own client code can pull typed fields back
      // out. Absent when there's no error, or when the Uplink has nothing
      // extra to say.
      errorMeta?: Record<string, unknown>;
    }
  // Host → station: the operator's technical-analytics consent. Sent to
  // each station on connect (right after schema) and re-broadcast whenever
  // the host's consent changes. Stations apply it to their own browser
  // Axiom transport — they never read a local consent value, they follow
  // the host. Privacy-first: a station defaults to disabled until this
  // arrives.
  | { type: "analytics-consent"; enabled: boolean }
  // Host → station, fired once per connection right after schema. Carries
  // every fog mask the host has stored so a station's map starts populated
  // with whatever the operator has already explored. Stations keep their
  // own copy and continue computing fresh tiles from telemetry afterwards —
  // there's no delta sync, so a station refresh is the way to pick up later
  // host-side discoveries.
  | {
      type: "fog-snapshot";
      masks: Array<{
        bodyId: string;
        // Per-type scan-coverage bitfield (e.g. 1=AltLoRes, 2=AltHiRes,
        // 8=Biome, 128=ResLoRes, 256=ResHiRes — SCANsat's SCANtype enum).
        // Each mask routes to its own slot on the station so the display
        // can apply HiRes-over-LoRes precedence the same way the host
        // does. Pre-rework this field was absent and the station treated
        // every payload as the AltHiRes channel.
        scanType: number;
        width: number;
        height: number;
        // Raw alpha bytes (0 = fogged, 255 = imaged) — same shape as the
        // station's local FogMaskStore record. PeerJS BinaryPack passes
        // Uint8Array through without re-encoding.
        data: Uint8Array;
      }>;
    }
  // ──────────────────────────────────────────────────────────────────────
  // GO/NO-GO and launch coordination
  // ──────────────────────────────────────────────────────────────────────
  // Station → host on connect and whenever the user renames the station.
  // Host keys peer id → name for grid attribution and abort reporting.
  // `version` + `buildTime` are optional so a pre-versioned station still
  // wire-compatible — the host treats absence as "unknown".
  | {
      type: "station-info";
      name: string;
      version?: string;
      buildTime?: string;
      // Stable per-device identity. Survives refreshes; the per-session
      // peer id (which the broker sees) is fresh on every load. The host
      // uses this to evict the previous peerId for the same device when a
      // refreshed station rejoins, so the GO/NO-GO list doesn't show the
      // station twice while waiting for the broker to reap the old conn.
      // Optional for back-compat: pre-stationKey clients still work.
      stationKey?: string;
    }
  // Station → host whenever the local GO/NO-GO vote changes. `null` means
  // "no widget mounted" so the station-info is still registered but the
  // station doesn't contribute a vote.
  | { type: "gonogo-vote"; status: "go" | "no-go" | null }
  // Host → stations when all connected stations have voted GO. `t0Ms` is a
  // wall-clock (`Date.now()`) instant — pre-synchronise to the host so the
  // countdown display matches across devices within a small skew.
  | { type: "gonogo-countdown-start"; t0Ms: number }
  // Host → stations when a vote flips to NO-GO during an active countdown
  // or when a station disconnects mid-countdown.
  | { type: "gonogo-countdown-cancel"; reason?: string }
  // Station → host after launch, when the operator hits the big red ABORT
  // button. Host re-sends the action group execution for `f.abort`.
  | { type: "gonogo-abort" }
  // Host → stations: someone triggered the abort. Carries the name so all
  // screens can show who did it.
  | { type: "gonogo-abort-notify"; stationName: string; t: number }
  // ──────────────────────────────────────────────────────────────────────
  // Push-to-main: a station mirrors one of its widgets onto the main
  // screen's modal dashboard. Config is passed through to the main's
  // registered component; input mappings stay station-local. `width` and
  // `height` are the station's grid units on its `lg` layout — the main
  // modal uses them as the ideal size and scales uniformly if it can't
  // fit everything without scrolling.
  // ──────────────────────────────────────────────────────────────────────
  | {
      type: "widget-push";
      widgetInstanceId: string;
      componentId: string;
      config: Record<string, unknown>;
      width: number;
      height: number;
    }
  | { type: "widget-recall"; widgetInstanceId: string }
  // ──────────────────────────────────────────────────────────────────────
  // Internal mission alarms. The main screen owns the canonical list and
  // warp-step ladder; stations get a live snapshot and can add/update/
  // delete entries.
  // ──────────────────────────────────────────────────────────────────────
  // Host → stations: full snapshot on every change (alarms list, observed
  // warp state, unscheduled-warp flag). Not incremental — the list is
  // small and the round-trips are rare.
  | {
      type: "alarm-snapshot";
      snapshot: AlarmSnapshot;
    }
  // Host → stations: one-shot fire event at the alarm's UT. Lets clients
  // flash a visible cue without waiting for the next snapshot.
  | { type: "alarm-fired"; id: string; name: string; ut: number }
  // Station → host: create a new alarm. v2 carries a typed `trigger`
  // (time or threshold). Host returns a fresh id in the next snapshot.
  // `onFire` is optional; an empty array (or omission) means "no side
  // effect". On `alarm-update.patch`, an empty array is the clear sentinel
  // and `undefined` leaves the field unchanged.
  | {
      type: "alarm-add";
      name: string;
      notes?: string;
      trigger: import("../alarms/types").AlarmTrigger;
      onFire?: import("../alarms/types").AlarmFireAction[];
    }
  | {
      type: "alarm-update";
      id: string;
      patch: {
        name?: string;
        notes?: string;
        trigger?: import("../alarms/types").AlarmTrigger;
        onFire?: import("../alarms/types").AlarmFireAction[];
      };
    }
  | { type: "alarm-delete"; id: string }
  // Station → host: user dismissed a fired alarm. No-op on the host if the
  // alarm has already been ack'd (or doesn't exist), so two stations racing
  // to dismiss the same alarm collapse to a single removal.
  | { type: "alarm-acknowledge"; id: string }
  // Station → host: user dismissed the "unscheduled warp" warning.
  | { type: "alarm-ack-unscheduled-warp" }
  // Station → host: user pressed a warp control on the station dashboard.
  // The host records the requested index so the unscheduled-warp detector
  // doesn't false-positive on a legitimate station-initiated change.
  | { type: "alarm-warp-intent"; index: number }
  // ──────────────────────────────────────────────────────────────────────
  // Maneuver-planner conditional triggers. Host owns the canonical list,
  // observes the chosen telemetry key on each tick, and dispatches the
  // burn when the threshold first holds. Stations get the full snapshot
  // on every change; arming and cancelling is request-only.
  // ──────────────────────────────────────────────────────────────────────
  | {
      type: "trigger-snapshot";
      snapshot: import("@ksp-gonogo/components").TriggerSnapshot;
    }
  | {
      type: "trigger-arm";
      dataKey: string;
      op: import("@ksp-gonogo/components").ThresholdOp;
      value: number;
      inputs: import("@ksp-gonogo/components").FrozenPlanInputs;
    }
  | { type: "trigger-cancel"; id: string }
  // ──────────────────────────────────────────────────────────────────────
  // Selective subscription — see local_docs/performance_review.md #1.
  //
  // Default mode is "broadcast-all" so a station on an old bundle still
  // receives every key. A v2 station immediately sends `peer-data-mode`
  // with `mode: "selective"` after handshake, and follows up with
  // `peer-data-subscribe` for keys its widgets care about. The host
  // gates per-peer sends on the union of that peer's subscribed keys.
  // ──────────────────────────────────────────────────────────────────────
  | { type: "peer-data-mode"; mode: "selective" | "broadcast-all" }
  | {
      type: "peer-data-subscribe";
      sourceId: string;
      keys: string[];
    }
  | {
      type: "peer-data-unsubscribe";
      sourceId: string;
      keys: string[];
    }
  // ──────────────────────────────────────────────────────────────────────
  // Flight history RPC. Stations call into the host's BufferedDataSource
  // through `flight-rpc-request`; the host replies with `flight-rpc-response`
  // keyed by `requestId`. `flight-change` is a host → station push so
  // station-side `useFlight()` mirrors the main screen's current flight.
  // ──────────────────────────────────────────────────────────────────────
  | {
      type: "flight-rpc-request";
      requestId: string;
      op: FlightRpcOp;
    }
  | {
      type: "flight-rpc-response";
      requestId: string;
      result?: unknown;
      error?: string;
    }
  | { type: "flight-change"; flight: FlightRecord | null }
  // Host → stations whenever the persisted flight list could have changed
  // shape (mutation by either side). Empty payload — recipients reload via
  // their own `listFlights()`. Stations get this on their own mutations
  // too so the modal stays consistent without the station having to
  // optimistically reload after every RPC.
  | { type: "flight-list-changed" }
  // ──────────────────────────────────────────────────────────────────────
  // Mission notes — host owns the canonical list and broadcasts the full
  // snapshot on every change. Stations send mutations as `note-add`,
  // `note-update`, `note-delete`, `note-reorder`; the host applies them and
  // re-broadcasts. Templated `{{key.path}}` tags inside `body` are
  // resolved client-side at render time against the local data feed.
  // ──────────────────────────────────────────────────────────────────────
  | {
      type: "notes-snapshot";
      snapshot: import("../notes/types").NotesSnapshot;
    }
  | { type: "note-add"; body: string }
  | { type: "note-update"; id: string; body: string }
  | { type: "note-delete"; id: string }
  | { type: "note-reorder"; id: string; afterId: string | null }
  // ──────────────────────────────────────────────────────────────────────
  // Sitrep telemetry-stream forwarding. The host taps its own
  // TelemetryClient (SitrepPeerRelay, one live subscriber to the mod —
  // never a second connection) and relays every `stream-data`/`event`
  // frame it receives VERBATIM to connected stations, wrapped here. No
  // re-timestamping: `message.meta.validAt`/`deliveredAt` are the exact
  // values the mod computed for the HOST's own vantage, so a station's
  // TimelineStore/ViewClock fits the identical UT<->wall observations the
  // host's own clock did — see the delay-correctness note in
  // docs/superpowers/plans/2026-07-12-station-stream-forwarding-plan.md §5.
  // v1 is eager broadcast-all (mirrors this file's existing
  // `peer-data-mode` broadcast-all default) — every carried topic is sent
  // to every connected station unconditionally; there is no
  // sitrep-subscribe/unsubscribe pair yet (deferred, see the plan's §2 v2
  // note).
  // ──────────────────────────────────────────────────────────────────────
  | {
      type: "sitrep-frame";
      message: import("@ksp-gonogo/sitrep-sdk").ServerMessage;
    }
  // Station -> host: fire a mapped Sitrep command (`useCommand`'s carried
  // branch) through the host's own live TelemetryClient — the host is the
  // only thing that ever talks to the mod server, so this is a one-way
  // pass-through, not a second dispatch origin. Correlated by the
  // STATION's own `TelemetryClient`-minted `requestId` (the `cN` counter
  // already embedded in the `command-request` the station's `PeerTransport`
  // is asked to send) — reused as the PeerJS correlation key rather than
  // inventing a second id; safe because the host always replies
  // per-connection (`conn.send`), never `broadcast`, so two stations'
  // independently-counted `"c0"`s never cross paths.
  | {
      type: "sitrep-command-request";
      requestId: string;
      command: string;
      label: string;
      topic: string;
      args: unknown;
    }
  | {
      type: "sitrep-command-response";
      requestId: string;
      result: unknown;
      meta: import("@ksp-gonogo/sitrep-sdk").Meta;
    }
  | {
      type: "sitrep-command-error";
      requestId: string;
      code: string;
      message: string;
    };
