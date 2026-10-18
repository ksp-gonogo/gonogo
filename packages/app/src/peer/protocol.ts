import type { DataSourceStatus } from "@ksp-gonogo/core";
import type {
  DataKeyMeta,
  FlightChapterRecord,
  FlightRecord,
} from "@ksp-gonogo/data";
import type { AlarmSnapshot } from "../alarms/types";
import type { RunningUplink } from "../uplinks/loaderState";

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
  // emitted before `schema`. `sessionToken` is fresh per host page-load so
  // stations can distinguish "transient broker hiccup, same host process"
  // from "host restarted": used to clear stale GO/NO-GO votes that would
  // otherwise re-broadcast from station memory on reconnect.
  | {
      type: "hello";
      version: string;
      buildTime: string;
      sessionToken: string;
    }
  | {
      type: "schema";
      sources: PeerSchemaSource[];
    }
  | { type: "status"; sourceId: string; status: DataSourceStatus }
  | { type: "data"; sourceId: string; key: string; value: unknown }
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
  /* Host → one station, just before the host closes its connection: another
     page with the same stationKey has connected and now holds the station.
     One station identity holds one live connection, so the page told this
     stops reconnecting until its operator takes the station back. */
  | { type: "station-superseded" }
  /* Station → host, the first message on every connection: the station's
     secret, which the host remembers its approval against. A station that
     sends none reads but is never approved. */
  | { type: "station-credential"; credential: string }
  /* Host → one station: where the main screen's approval of it stands. Sent
     after each `station-info`, and as "refused" just before the host closes
     the connection, so the page stops reconnecting until its operator asks
     again. A pending or refused station reads but has every command refused. */
  | { type: "station-approval"; state: "pending" | "approved" | "refused" }
  /* Host → one station: a message by which it acted was refused, because the
     main screen has not approved it. For the writes with no reply of their
     own (a vote, an abort, an alarm change, a widget push); a command, a
     flight request, an Uplink call and a note are refused on their own
     reply. `refused` is the refused message's `type`. */
  | { type: "station-write-refused"; refused: string; reason: string }
  // Host → stations: the relay's TURN credentials, the payload the host
  // fetched from /ice-config, which a station cannot fetch itself because
  // that address is the host's loopback. Sent on connect and on every
  // refresh, and only when there are any. A station applies them to its
  // own Peer and hands them to an Uplink's media connection.
  | {
      type: "relay-ice-servers";
      iceServers: RTCIceServer[];
    }
  // Station → host: relay a single call through to a host-side handle
  // registered for `uplinkId` (see `@ksp-gonogo/core`'s
  // `registerUplinkHandle`/`getUplinkHandle`). ONE generic pair serves every
  // Uplink, rather than a hardcoded request/response pair each (in-game
  // script dispatch, camera WebRTC offer/answer signalling): a station
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
  // Axiom transport: they never read a local consent value, they follow
  // the host. Privacy-first: a station defaults to disabled until this
  // arrives. `runId` is the analytics run the station stamps on its own
  // entries, present only while analytics is on.
  | { type: "analytics-consent"; enabled: boolean; runId?: string }
  // Host -> peer: the command centre the main screen is standing at, sent on
  // connect and whenever it moves. A pilot on a session of its own never sees
  // the host's frames, so this is the only way it learns which centre its
  // words are timed against. `null` until the host's session has been placed.
  | { type: "host-command-centre"; centreId: string | null }
  // Host -> peer: the Uplinks the main screen runs, sent on connect and
  // whenever the set changes. A station loads exactly this set. `null` until
  // the main screen's loader has settled.
  | { type: "host-uplinks"; uplinks: RunningUplink[] | null }
  // Station → host on connect and whenever the user renames the station.
  // Host keys peer id → name for grid attribution and abort reporting.
  // `version` + `buildTime` are optional so a pre-versioned station still
  // wire-compatible: the host treats absence as "unknown".
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
      // Which seat this peer is sitting at. Absent means mission control,
      // matching this message's existing back-compat posture: every client
      // that predates the pilot seat is at a command centre by construction.
      seat?: import("@ksp-gonogo/sitrep-sdk/spine").Seat;
    }
  /* Station → host whenever the local GO/NO-GO vote changes. `null` means no
     GO/NO-GO widget is mounted on that screen, which is also what a screen
     sends when its widget is removed. A screen whose vote is null stays
     listed but is not in the poll: it neither blocks a countdown nor counts
     towards one. */
  | { type: "gonogo-vote"; status: "go" | "no-go" | null }
  /* Host → stations when the poll reads GO: at least one screen has voted GO
     and none has voted NO-GO. `t0Ms` is a wall-clock (`Date.now()`) instant:
     pre-synchronise to the host so the countdown display matches across
     devices within a small skew. */
  | { type: "gonogo-countdown-start"; t0Ms: number }
  // Host → stations when a vote flips to NO-GO during an active countdown or when a station disconnects mid-countdown.
  | { type: "gonogo-countdown-cancel"; reason?: string }
  // Station → host after launch, when the operator hits the big red ABORT
  // button. Host re-sends the action group execution for `f.abort`.
  | { type: "gonogo-abort" }
  // Host → stations: someone triggered the abort. Carries the name so all
  // screens can show who did it.
  | { type: "gonogo-abort-notify"; stationName: string; t: number }
  // Push-to-main: a station mirrors one of its widgets onto the main
  // screen's modal dashboard. Config is passed through to the main's
  // registered component; input mappings stay station-local. `width` and
  // `height` are the widget's grid units on the station's grid, the main
  // modal uses them as the ideal size and scales uniformly if it can't
  // fit everything without scrolling.
  | {
      type: "widget-push";
      widgetInstanceId: string;
      componentId: string;
      config: Record<string, unknown>;
      width: number;
      height: number;
    }
  | { type: "widget-recall"; widgetInstanceId: string }
  // Internal mission alarms. The main screen owns the canonical list and
  // warp-step ladder; stations get a live snapshot and can add/update/
  // delete entries.
  // Host → stations: full snapshot on every change (alarms list, observed
  // warp state, unscheduled-warp flag). Not incremental: the list is
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
      // Present when an Uplink widget on the station asked for the alarm rather
      // than the operator. Carried so the row reads the same on both screens:
      // without it an alarm an Uplink requested from a station would arrive
      // anonymous, and the host's dedupe would have nothing to key on.
      requestedBy?: import("../alarms/types").AlarmRequestedBy;
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
  // shape (mutation by either side). Empty payload, recipients reload via
  // their own `listFlights()`. Stations get this on their own mutations
  // too so the modal stays consistent without the station having to
  // optimistically reload after every RPC.
  | { type: "flight-list-changed" }
  // ──────────────────────────────────────────────────────────────────────
  // Mission notes: the host owns one list per command centre and sends each
  // station the list of the centre it stands at, in full, on every change.
  // Stations send mutations as `note-add`, `note-update`, `note-delete`,
  // `note-reorder`; the host applies them and answers the sender with
  // `note-result`. Templated `{{key.path}}` tags inside `body` are
  // resolved client-side at render time against the local data feed.
  // ──────────────────────────────────────────────────────────────────────
  | {
      type: "notes-snapshot";
      snapshot: import("../notes/types").NotesSnapshot;
    }
  | { type: "note-add"; ref: string; body: string }
  | {
      type: "note-update";
      ref: string;
      id: string;
      body: string;
      baseVersion: number;
    }
  | { type: "note-delete"; ref: string; id: string; baseVersion: number }
  | {
      type: "note-reorder";
      ref: string;
      id: string;
      afterId: string | null;
      baseVersion: number;
    }
  // Host → the one station that sent the mutation `ref`. A refusal carries
  // the note as the host now holds it, or null when it no longer exists.
  | {
      type: "note-result";
      ref: string;
      ok: boolean;
      current?: import("../notes/types").Note | null;
      /** Refused because the main screen has not approved this station yet. */
      awaitingApproval?: true;
    }

  // ──────────────────────────────────────────────────────────────────────
  // Sitrep telemetry-stream forwarding. The host taps its own
  // TelemetryClient (SitrepPeerRelay, one live subscriber to the mod,
  // never a second connection) and relays every `stream-data`/`event`
  // frame it receives VERBATIM to connected stations, wrapped here. No
  // re-timestamping: `message.meta.validAt`/`deliveredAt` are the exact
  // values the mod computed for the HOST's own vantage, so a station's
  // TimelineStore/ViewClock fits the identical UT<->wall observations the
  // host's own clock did.
  // v1 is eager broadcast-all (mirrors this file's existing
  // `peer-data-mode` broadcast-all default): every carried topic is sent
  // to every connected station unconditionally; there is no
  // sitrep-subscribe/unsubscribe pair yet.
  // ──────────────────────────────────────────────────────────────────────
  | {
      type: "sitrep-frame";
      message: import("@ksp-gonogo/sitrep-sdk").ServerMessage;
      /** Set when numbers the packer cannot write ride in `message` as tagged strings (see `wideNumbers.ts`). */
      wide?: true;
      /** Set on a frame replayed from the host's history, which describes the past and is not the newest word on the link. */
      replay?: true;
    }
  // Host -> station: the host's own stream restarted from a new game process,
  // whose timeline epoch counts from zero. A station's store refuses frames
  // from an epoch below the one it holds, so the station rebuilds its client
  // and store and subscribes again.
  | { type: "sitrep-reset" }
  // Station -> host: what this station's mounted widgets are reading. A
  // station's own widgets are the only thing that knows what a station needs,
  // and they know it at mount time, so the subscribe call a widget already
  // makes IS the request; nothing declares a topic ahead of time. The host
  // refcounts these across connections and holds a matching subscription on
  // its own client, so a topic is pulled from the mod while any screen reads
  // it and not otherwise.
  //
  // Re-sent in full on every fresh connection, exactly as
  // `WebSocketTransport` re-subscribes its live topics on every socket open:
  // the host's per-connection claims die with the old `DataConnection`.
  //
  // `sitrep-set-vantage` below: the host holds one upstream session PER
  // vantage anything asks for, so the mod stays one-vantage-per-session while
  // a relay message can give different peers different vantages.
  | {
      type: "sitrep-subscribe";
      topic: string;
    }
  // Peer -> host: observe from `vantage` instead of the host's own vantage.
  // A pilot asks for the craft it is aboard so its instruments run at that
  // craft's light-time rather than the ground's; a peer that never asks reads
  // the host's, which is what every station did before this existed.
  //
  // `null` hands the connection back to the host's session. Sent on connect
  // and on every change, and re-sent on reconnect for the same reason
  // `sitrep-subscribe` is: the host's per-connection state dies with the old
  // `DataConnection`.
  | {
      type: "sitrep-set-vantage";
      vantage: string | null;
    }
  | {
      type: "sitrep-unsubscribe";
      topic: string;
    }
  // Station -> host: fire a mapped Sitrep command (`useCommand`'s carried
  // branch) through the host's own live TelemetryClient, the host is the
  // only thing that ever talks to the mod server, so this is a one-way
  // pass-through, not a second dispatch origin. Correlated by the
  // STATION's own `TelemetryClient`-minted `requestId` (the `cN` counter
  // already embedded in the `command-request` the station's `PeerTransport`
  // is asked to send), reused as the PeerJS correlation key rather than
  // inventing a second id; safe because the host always replies
  // per-connection (`conn.send`), never `broadcast`, so two stations'
  // independently-counted `"c0"`s never cross paths.
  | {
      type: "sitrep-command-request";
      requestId: string;
      command: string;
      label: string;
      topic: string;
      /**
       * Per-call vantage override, already a field on the mod's own
       * `CommandRequest`: `""` means the session vantage, `"meta"` pins instant
       * dispatch. Carried across the hop so a station's override survives
       * instead of silently re-defaulting to the host's.
       */
      vantage?: string;
      args: unknown;
    }
  // Station -> host: several commands sent together, which the host dispatches
  // as one `command-group` so they stay one message to the mod. Each member
  // keeps the station's own request id and is answered under it by the same
  // `sitrep-command-response` and `sitrep-command-error` frames a command sent
  // alone is.
  | {
      type: "sitrep-command-group";
      groupId: string;
      /** The vantage every member is sent from, as on `sitrep-command-request`. */
      vantage?: string;
      members: {
        requestId: string;
        command: string;
        label: string;
        topic: string;
        args: unknown;
      }[];
    }
  | {
      /**
       * Carries a refusal as well as a success, in the mod's own shape
       * (`CommandResult` with `success: false`): the mod refuses on its response
       * channel, so the host does too, and the station's `TelemetryClient`
       * reaches `refused` down the same branch the host's did. Sent as an error
       * instead, a refusal arrived stripped to `code` and `message`, losing the
       * typed reason and the numbers behind it. See
       * `PeerHostService.handleSitrepCommand`.
       */
      type: "sitrep-command-response";
      requestId: string;
      result: unknown;
      meta: import("@ksp-gonogo/sitrep-sdk").Meta;
    }
  | {
      /**
       * The host could not get an answer: no live client, the dispatch machinery
       * broke, the host's own transport gave up. Never a refusal, which is an
       * answer and travels above.
       */
      type: "sitrep-command-error";
      requestId: string;
      code: string;
      message: string;
    }
  // ──────────────────────────────────────────────────────────────────────
  // D6: Uplink bundle-byte conduit. A station has no route to an Uplink's
  // author host (see the app's "main screen is the sole KSP/author-host
  // consumer" constraint): the loader's `fetchBytes(url)` seam
  // (packages/app/src/uplinks/loader.ts) must go through the host instead
  // of a direct `fetch(bundleUrl)` on a station. The host downloads each
  // bundleUrl ONCE (`BundleFetchCache`, see
  // `PeerHostService.handleUplinkBundleRequest`), SHA-256-verifies it
  // against the requester's `expectedHash`, and redistributes the SAME
  // verified bytes to every station that asks for that url.
  // requestId-correlated like `query-range-*`/`uplink-relay-*`.
  //
  // Wire shape: `bytes` is sent as a raw `Uint8Array` and arrives as an
  // `ArrayBuffer`, NOT base64: PeerJS's default "binary" serialization
  // (BinaryPack) packs a `Uint8Array` natively and unpacks it as a plain
  // `ArrayBuffer`; base64 would only add ~33%
  // overhead on a channel that already carries binary natively. A fetch or
  // hash-mismatch failure is a distinct `error` variant (no `bytes`) rather
  // than a thrown exception on the wire, same convention as
  // `query-range-response`/`flight-rpc-response`.
  // ──────────────────────────────────────────────────────────────────────
  | {
      type: "uplink-bundle-request";
      requestId: string;
      bundleUrl: string;
      expectedHash: string;
    }
  | {
      type: "uplink-bundle-response";
      requestId: string;
      bytes?: Uint8Array | ArrayBuffer;
      error?: string;
    };

/**
 * A frame off a peer data channel as a protocol message, and `null` for
 * anything that does not carry a `type` to dispatch on.
 *
 * PeerJS hands `data` through as `unknown`: the channel is a pipe and the
 * sender is another browser, so nothing on this side has checked what arrived.
 * A frame with no `type` reaches no handler, and dropping it here is the same
 * outcome the dispatcher's default arm reaches, stated once.
 */
export function asPeerMessage(raw: unknown): PeerMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  return typeof Reflect.get(raw, "type") === "string"
    ? (raw as PeerMessage)
    : null;
}
