import type { PeerMessage } from "../peer/protocol";
import type {
  Alarm,
  AlarmFireAction,
  AlarmRequestedBy,
  AlarmSnapshot,
} from "./types";

/**
 * The nine members of `PeerHostService` this bridge actually uses.
 *
 * Named rather than taking the whole class, because the whole class is a live
 * PeerJS connection with a broker behind it, and a test that wants to watch one
 * alarm message cross cannot stand one up. The real service satisfies this
 * structurally, so the production call site is unchanged.
 */
export interface AlarmPeerHost {
  onPeerConnect(cb: (peerId: string) => void): () => void;
  onAlarmAdd(
    cb: (
      peerId: string,
      msg: Extract<PeerMessage, { type: "alarm-add" }>,
    ) => void,
  ): () => void;
  onAlarmUpdate(
    cb: (
      peerId: string,
      msg: Extract<PeerMessage, { type: "alarm-update" }>,
    ) => void,
  ): () => void;
  onAlarmDelete(cb: (peerId: string, id: string) => void): () => void;
  onAlarmAcknowledge(cb: (peerId: string, id: string) => void): () => void;
  onAlarmAckUnscheduledWarp(cb: (peerId: string) => void): () => void;
  onAlarmWarpIntent(cb: (peerId: string, index: number) => void): () => void;
  sendToPeer(peerId: string, msg: PeerMessage): void;
  broadcast(msg: PeerMessage): void;
}

export interface AlarmPeerBridgeHandlers {
  addAlarm(input: {
    name: string;
    notes?: string;
    trigger: Alarm["trigger"];
    createdBy?: string;
    requestedBy?: AlarmRequestedBy;
    onFire?: AlarmFireAction[];
  }): void;
  updateAlarm(
    id: string,
    patch: Partial<Pick<Alarm, "name" | "notes" | "trigger" | "onFire">>,
  ): void;
  deleteAlarm(id: string): void;
  acknowledgeAlarm(id: string): void;
  acknowledgeUnscheduledWarp(): void;
  registerStationWarpIntent(): void;
  /**
   * Returns the host's current alarm snapshot for targeted delivery to a
   * latecomer station. Without this, a station that connects after an
   * alarm has been added waits up to one tick (default 1s) to learn
   * about it via the next broadcast: bigger gaps happen if the alarm
   * fires between the add and that next tick, since the snapshot the
   * station eventually receives would carry the fired state but the
   * pre-add gap means the banner can race the fire event.
   */
  getSnapshot(): AlarmSnapshot;
}

/**
 * Pure event wiring: subscribes the host to peer broadcasts, and exposes
 * `broadcastSnapshot` / `broadcastFire` for the host to call when state
 * changes. No alarm state lives here.
 */
export class AlarmPeerBridge {
  constructor(
    private readonly host: AlarmPeerHost | null,
    handlers: AlarmPeerBridgeHandlers,
  ) {
    if (!host) return;
    host.onAlarmAdd((peerId, msg) => {
      handlers.addAlarm({
        name: msg.name,
        notes: msg.notes,
        trigger: msg.trigger,
        createdBy: peerId,
        // Two different questions, so both are carried: `createdBy` is which
        // screen the request came from, `requestedBy` is which Uplink asked
        // for it. An Uplink widget on a station answers both at once.
        requestedBy: msg.requestedBy,
        onFire: msg.onFire,
      });
    });
    host.onAlarmUpdate((_peerId, msg) => {
      handlers.updateAlarm(msg.id, msg.patch);
    });
    host.onAlarmDelete((_peerId, id) => {
      handlers.deleteAlarm(id);
    });
    host.onAlarmAcknowledge((_peerId, id) => {
      handlers.acknowledgeAlarm(id);
    });
    host.onAlarmAckUnscheduledWarp(() => {
      handlers.acknowledgeUnscheduledWarp();
    });
    host.onAlarmWarpIntent(() => {
      handlers.registerStationWarpIntent();
    });
    // Latecomer's initial snapshot: fire the host's current alarms at
    // every new peer immediately so the station doesn't wait for the
    // next tick to learn what alarms exist. Matches the
    // CoverageSyncHostService / GoNoGoHostService / Notes pattern. Reported
    // as "Banners not showing for stations" in the 2026-05-17 21:11 BST
    // session: the user set an alarm, refreshed a station, and the
    // station never showed the alarm.
    host.onPeerConnect((peerId) => {
      host.sendToPeer(peerId, {
        type: "alarm-snapshot",
        snapshot: handlers.getSnapshot(),
      });
    });
  }

  broadcastSnapshot(snapshot: AlarmSnapshot): void {
    this.host?.broadcast({ type: "alarm-snapshot", snapshot });
  }

  broadcastFire(alarm: Alarm, observedUT: number | null): void {
    // Backwards-compatible top-level `ut` for stations on older bundles.
    // Threshold alarms report the UT at which the condition fired
    // (matchSinceUT + sustain).
    const firedUt =
      alarm.trigger.kind === "time"
        ? alarm.trigger.ut
        : alarm.trigger.kind === "event"
          ? // Event: matchSinceUT is the reveal UT (no sustain to add).
            (alarm.matchSinceUT ?? observedUT ?? 0)
          : (alarm.matchSinceUT ?? observedUT ?? 0) +
            alarm.trigger.sustainSeconds;
    this.host?.broadcast({
      type: "alarm-fired",
      id: alarm.id,
      name: alarm.name,
      ut: firedUt,
    });
  }
}
