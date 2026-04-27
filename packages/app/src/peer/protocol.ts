import type { DataSourceStatus } from "@gonogo/core";
import type { DataKeyMeta, KosData, KosScriptArg } from "@gonogo/data";
import type { AlarmSnapshot } from "../alarms/types";

export type { DataSourceStatus };

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
  // unknown.
  | { type: "hello"; version: string; buildTime: string }
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
  // whenever the proxy is re-resolved. null means the main screen no longer
  // has a live proxy connection.
  | { type: "ocisly-proxy-peer-id"; peerId: string | null }
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
    }
  | {
      type: "kos-execute-response";
      requestId: string;
      data?: KosData;
      error?: string;
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
  | {
      type: "alarm-add";
      name: string;
      notes?: string;
      trigger: import("../alarms/types").AlarmTrigger;
    }
  | {
      type: "alarm-update";
      id: string;
      patch: {
        name?: string;
        notes?: string;
        trigger?: import("../alarms/types").AlarmTrigger;
      };
    }
  | { type: "alarm-delete"; id: string }
  // Station → host: user dismissed the "unscheduled warp" warning.
  | { type: "alarm-ack-unscheduled-warp" }
  // Station → host: user pressed a warp control on the station dashboard.
  // The host records the requested index so the unscheduled-warp detector
  // doesn't false-positive on a legitimate station-initiated change.
  | { type: "alarm-warp-intent"; index: number }
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
    };
