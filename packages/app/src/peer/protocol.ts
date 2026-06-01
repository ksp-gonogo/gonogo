import type { DataSourceStatus } from "@gonogo/core";
import type {
  DataKeyMeta,
  FlightChapterRecord,
  FlightRecord,
  KosData,
  KosScriptArg,
} from "@gonogo/data";
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
  | { type: "execute"; sourceId: string; action: string }
  | { type: "execute-result"; sourceId: string; action: string; error?: string }
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
  | {
      type: "kos-open";
      sessionId: string;
      kosHost: string;
      kosPort: number;
      cols: number;
      rows: number;
    }
  | { type: "kos-opened"; sessionId: string }
  | { type: "kos-data"; sessionId: string; data: string }
  | { type: "kos-resize"; sessionId: string; cols: number; rows: number }
  | { type: "kos-close"; sessionId: string }
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
  // Station → host: relay ONE kerbcam WebRTC offer through the main screen so a
  // station never needs the sidecar's address. The host forwards the offer to
  // the sidecar's HTTP `/offer` (only the main screen can reach it) and returns
  // the answer. Signaling ONLY — the PeerConnection this sets up carries media
  // station↔sidecar *directly*: the answer SDP's ICE candidates locate the
  // sidecar, and TURN creds from the `relay-peer-id` broadcast cover the non-LAN
  // hop. Nothing about the video frames crosses PeerJS. requestId-correlated
  // like `query-range-*`.
  | {
      type: "kerbcam-negotiate-request";
      requestId: string;
      offer: { sdp: string; cameras: number[]; slots?: number };
    }
  | {
      type: "kerbcam-negotiate-response";
      requestId: string;
      answer?: { sdp: string; cameras: number[] };
      error?: string;
    }
  // Host → station, sent over the existing data channel a beat before the
  // host rotates its share code. Stations update their reconnect target
  // *before* the host's `peer.destroy()` closes the channel, so their
  // built-in retry loop reconnects to the new id rather than retrying the
  // dead old one forever. `reason` is operator-facing diagnostic only
  // (e.g. "unavailable-id-recovery"). Lifecycle: host broadcasts → ~500ms
  // flush window → host destroys + restarts on new id → station's conn
  // closes → station's retry kicks in against the freshly-cached id.
  | { type: "host-id-rotation"; newPeerId: string; reason: string }
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
  // kOS compute script execution tunnel. Stations can't talk to the
  // telnet proxy directly (only the main screen can), so station-side
  // useKosWidget dispatches turn into `kos-execute-request` messages
  // routed to the host's KosDataSource. The host replies with
  // `kos-execute-response` keyed by the same requestId.
  // ──────────────────────────────────────────────────────────────────────
  | {
      type: "kos-execute-request";
      requestId: string;
      cpu: string;
      script: string;
      args: KosScriptArg[];
      /**
       * When set, the host's KosDataSource auto-syncs `script` on the kOS
       * volume to `managed.body` before RUNPATH. Lets stations benefit
       * from the same auto-upload that main-screen widgets get — without
       * it, a station that dispatches a script the main screen has never
       * run would hit "file not found" on the kOS volume.
       */
      managed?: import("@gonogo/data").KosManagedScript;
    }
  | {
      type: "kos-execute-response";
      requestId: string;
      data?: KosData;
      error?: string;
      /**
       * Set when `error` originates from the running kerboscript (explicit
       * [KOSERROR] or kOS runtime exception), as opposed to transport /
       * timeout / session-death. Stations re-raise these as
       * `KosScriptError` so the interval-mode breaker only counts real
       * script bugs and not flaky proxy hops.
       */
      isScriptError?: boolean;
    }
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
      snapshot: import("@gonogo/components").TriggerSnapshot;
    }
  | {
      type: "trigger-arm";
      dataKey: string;
      op: import("@gonogo/components").ThresholdOp;
      value: number;
      inputs: import("@gonogo/components").FrozenPlanInputs;
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
  | { type: "note-reorder"; id: string; afterId: string | null };
