import type { PeerClientService } from "../peer/PeerClientService";
import type { AlarmSnapshot } from "./types";

/**
 * Station-side mirror of AlarmHostService. Receives snapshots from the
 * host; exposes the same read+CRUD surface the host does so widgets can
 * use the same API on either screen.
 */

const EMPTY_SNAPSHOT: AlarmSnapshot = {
  alarms: [],
  ut: null,
  warp: { index: 0, rate: 1, mode: "UNKNOWN" },
  unscheduledWarp: null,
};

type Listener = (snap: AlarmSnapshot) => void;
type FireListener = (fire: { id: string; name: string; ut: number }) => void;

export class AlarmClientService {
  private current: AlarmSnapshot = EMPTY_SNAPSHOT;
  private snapshotListeners = new Set<Listener>();
  private fireListeners = new Set<FireListener>();
  private client: PeerClientService;

  constructor(client: PeerClientService) {
    this.client = client;
    this.client.onAlarmSnapshot((snap) => {
      this.current = snap;
      for (const cb of this.snapshotListeners) cb(snap);
    });
    this.client.onAlarmFired((fire) => {
      for (const cb of this.fireListeners) cb(fire);
    });
  }

  snapshot(): AlarmSnapshot {
    return this.current;
  }

  subscribe(cb: Listener): () => void {
    this.snapshotListeners.add(cb);
    return () => this.snapshotListeners.delete(cb);
  }

  onFire(cb: FireListener): () => void {
    this.fireListeners.add(cb);
    return () => this.fireListeners.delete(cb);
  }

  addAlarm(input: {
    ut: number;
    name: string;
    notes?: string;
    leadSeconds?: number;
  }): void {
    this.client.sendAlarmAdd(input);
  }

  updateAlarm(
    id: string,
    patch: { ut?: number; name?: string; notes?: string; leadSeconds?: number },
  ): void {
    this.client.sendAlarmUpdate(id, patch);
  }

  deleteAlarm(id: string): void {
    this.client.sendAlarmDelete(id);
  }

  acknowledgeUnscheduledWarp(): void {
    this.client.sendAlarmAckUnscheduledWarp();
  }

  registerStationWarpIntent(index: number): void {
    this.client.sendAlarmWarpIntent(index);
  }
}
