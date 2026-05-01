import type { BufferedDataSource } from "@gonogo/data";
import { LocalStorageStore } from "@gonogo/data";
import type { PeerHostService } from "../peer/PeerHostService";
import { AlarmPeerBridge } from "./AlarmPeerBridge";
import { AlarmStateMachine, type TelemetryReader } from "./AlarmStateMachine";
import {
  type Alarm,
  type AlarmSnapshot,
  type AlarmTrigger,
  DEFAULT_WARP_SAFETY_MARGIN_SECONDS,
  MAX_WARP_SAFETY_MARGIN_SECONDS,
  MIN_WARP_SAFETY_MARGIN_SECONDS,
  migrateAlarm,
} from "./types";
import { WarpControl } from "./WarpControl";
import { WarpObserver } from "./WarpObserver";

/**
 * Main-screen mission-alarm service.
 *
 * Responsibilities:
 *   - Maintain the canonical alarm list (persisted in localStorage).
 *   - Tick at 1 Hz using Telemachus's `t.universalTime` to advance alarm
 *     state (pending → arming → firing → fired).
 *   - When an alarm arms, drop KSP's warp to index 0 via `t.timeWarp[0]`.
 *   - Watch observed warp state for unscheduled changes (warp went up
 *     without an alarm commanding it or a station explicitly asking for
 *     it) — surface as `unscheduledWarp` in the snapshot.
 *   - Broadcast snapshots to connected peers via the host service.
 *   - Accept add / update / delete from peers via the host service.
 *
 * The stateful pieces are extracted into collaborating modules:
 *   - `AlarmStateMachine` — `deriveState`, threshold-match tracking,
 *     slope-fit ETA, and the closest/eligible-alarm queries.
 *   - `WarpControl` — the warp-to controller and `stepWarpDown`.
 *   - `WarpObserver` — warp telemetry + unscheduled-warp detection.
 *   - `AlarmPeerBridge` — peer event wiring and broadcasts.
 */

const STORAGE_KEY = "gonogo.alarms.list";
const WARP_MARGIN_STORAGE_KEY = "gonogo.alarms.warpSafetyMargin";

type SnapshotListener = (snapshot: AlarmSnapshot) => void;
type FireListener = (alarm: Alarm) => void;

export interface AlarmHostOptions {
  nowMs?: () => number;
  tickIntervalMs?: number;
  storage?: Storage;
}

export class AlarmHostService {
  private alarms: Alarm[] = [];
  private snapshotListeners = new Set<SnapshotListener>();
  private fireListeners = new Set<FireListener>();
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private observedUT: number | null = null;
  private telemetry: TelemetryReader | null;
  private opts: Required<Pick<AlarmHostOptions, "nowMs" | "tickIntervalMs">>;
  private storage: Storage;
  private alarmStore: LocalStorageStore<Alarm[]>;
  private stateMachine: AlarmStateMachine;
  private warp: WarpControl;
  private warpObserver: WarpObserver;
  private peerBridge: AlarmPeerBridge;

  constructor(
    host: PeerHostService | null,
    telemetry: TelemetryReader | null,
    opts: AlarmHostOptions = {},
  ) {
    this.telemetry = telemetry;
    this.opts = {
      nowMs: opts.nowMs ?? (() => Date.now()),
      tickIntervalMs: opts.tickIntervalMs ?? 1000,
    };
    this.storage = opts.storage ?? globalThis.localStorage;
    this.alarmStore = new LocalStorageStore<Alarm[]>({
      key: STORAGE_KEY,
      defaults: [],
      storage: this.storage,
    });

    this.stateMachine = new AlarmStateMachine(
      telemetry,
      () => this.alarms,
      () => this.observedUT,
    );

    const initialMargin = this.loadMargin();
    this.warpObserver = new WarpObserver(
      telemetry,
      {
        getAlarms: () => this.alarms,
        getObservedUT: () => this.observedUT,
        isWarpToActive: () => this.warp.isActive(),
      },
      this.opts.nowMs,
    );

    this.warp = new WarpControl(
      telemetry,
      this.stateMachine,
      {
        getObservedIndex: () => this.warpObserver.getWarp().index,
        registerOwnWarpIntent: () => this.warpObserver.registerIntent(),
      },
      this.opts.nowMs,
      initialMargin,
    );

    this.peerBridge = new AlarmPeerBridge(host, {
      addAlarm: (input) => {
        this.addAlarm(input);
      },
      updateAlarm: (id, patch) => this.updateAlarm(id, patch),
      deleteAlarm: (id) => this.deleteAlarm(id),
      acknowledgeAlarm: (id) => this.acknowledgeAlarm(id),
      acknowledgeUnscheduledWarp: () => this.acknowledgeUnscheduledWarp(),
      registerStationWarpIntent: () => this.registerStationWarpIntent(),
    });

    this.loadAlarms();
    this.start();
  }

  // ── Public API ────────────────────────────────────────────────────────

  snapshot(): AlarmSnapshot {
    return {
      alarms: [...this.alarms],
      ut: this.observedUT,
      warp: this.warpObserver.getWarp(),
      unscheduledWarp: this.warpObserver.getUnscheduled(),
      warpTo: this.warp.snapshot(),
      warpSafetyMarginSeconds: this.warp.getMarginSeconds(),
    };
  }

  subscribe(cb: SnapshotListener): () => void {
    this.snapshotListeners.add(cb);
    return () => this.snapshotListeners.delete(cb);
  }

  onFire(cb: FireListener): () => void {
    this.fireListeners.add(cb);
    return () => this.fireListeners.delete(cb);
  }

  addAlarm(input: {
    name: string;
    notes?: string;
    trigger: AlarmTrigger;
    createdBy?: string;
  }): Alarm {
    const alarm: Alarm = {
      id: generateId(),
      name: input.name.trim() || "Alarm",
      notes: input.notes?.trim() || undefined,
      trigger: input.trigger,
      // Always start "pending" — the next tick() transitions to arming /
      // firing with the usual side effects, so the state machine stays
      // driven from a single place.
      state: "pending",
      createdBy: input.createdBy ?? "main",
      createdAt: this.opts.nowMs(),
      matchSinceUT: input.trigger.kind === "threshold" ? null : undefined,
    };
    this.alarms.push(alarm);
    this.persist();
    this.tick();
    return alarm;
  }

  updateAlarm(
    id: string,
    patch: Partial<Pick<Alarm, "name" | "notes" | "trigger">>,
  ): void {
    const idx = this.alarms.findIndex((a) => a.id === id);
    if (idx < 0) return;
    const prev = this.alarms[idx];
    const next: Alarm = {
      ...prev,
      ...(patch.name !== undefined
        ? { name: patch.name.trim() || prev.name }
        : {}),
      ...(patch.notes !== undefined
        ? { notes: patch.notes.trim() || undefined }
        : {}),
      ...(patch.trigger !== undefined ? { trigger: patch.trigger } : {}),
    };
    if (patch.trigger && patch.trigger.kind !== prev.trigger.kind) {
      next.matchSinceUT = patch.trigger.kind === "threshold" ? null : undefined;
      next.state = "pending";
    } else {
      next.state = this.stateMachine.deriveState(next);
    }
    if (patch.trigger) this.stateMachine.forget(id);
    this.alarms[idx] = next;
    this.persist();
    this.emit();
  }

  deleteAlarm(id: string): void {
    const before = this.alarms.length;
    this.alarms = this.alarms.filter((a) => a.id !== id);
    if (this.alarms.length !== before) {
      this.stateMachine.forget(id);
      this.persist();
      this.emit();
    }
  }

  acknowledgeUnscheduledWarp(): void {
    if (this.warpObserver.acknowledgeUnscheduled()) this.emit();
  }

  /**
   * Dismiss a fired alarm. Threshold and time alarms both stay in the
   * `fired` state until the user (or a peer) acks — the original "auto
   * purge after 5s" behaviour silently swallowed alarms before the
   * operator noticed them.
   */
  acknowledgeAlarm(id: string): void {
    const idx = this.alarms.findIndex((a) => a.id === id);
    if (idx < 0) return;
    if (this.alarms[idx].state !== "fired") return;
    this.alarms.splice(idx, 1);
    this.persist();
    this.emit();
  }

  registerStationWarpIntent(): void {
    this.warpObserver.registerIntent();
  }

  /**
   * Begin a "warp to next alarm" session. The controller targets the
   * closest pending alarm — time alarms by their UT, threshold alarms by
   * a least-squares slope projected to the threshold value — and
   * re-targets each tick.
   */
  beginWarpTo(): void {
    if (!this.warp.begin()) return;
    this.tick();
  }

  cancelWarpTo(): void {
    if (this.warp.cancel()) this.emit();
  }

  setWarpSafetyMargin(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    const clamped = Math.max(
      MIN_WARP_SAFETY_MARGIN_SECONDS,
      Math.min(MAX_WARP_SAFETY_MARGIN_SECONDS, seconds),
    );
    if (clamped === this.warp.getMarginSeconds()) return;
    this.warp.setMarginSeconds(clamped);
    this.persistWarpMargin();
    this.emit();
  }

  dispose(): void {
    if (this.tickHandle !== null) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  // ── Tick loop ─────────────────────────────────────────────────────────

  private start(): void {
    if (this.tickHandle !== null) return;
    this.tickHandle = setInterval(() => this.tick(), this.opts.tickIntervalMs);
    this.tick();
  }

  private tick(): void {
    const ut = this.readTelemetryNumber("t.universalTime");
    this.observedUT = ut ?? this.observedUT;
    this.warpObserver.observeWarp();

    if (ut !== null) {
      let changed = false;
      for (const alarm of this.alarms) {
        // Threshold tracking must run *before* deriveState — it reads
        // last-tick's `alarm.state` to decide whether to keep the rolling
        // sample buffer. Don't reorder.
        if (alarm.trigger.kind === "threshold") {
          if (this.stateMachine.updateThresholdTracking(alarm, ut)) {
            changed = true;
          }
        }

        const nextState = this.stateMachine.deriveState(alarm, ut);
        if (nextState !== alarm.state) {
          if (alarm.state !== "arming" && nextState === "arming") {
            this.warp.stepWarpDown();
          }
          if (alarm.state !== "firing" && nextState === "firing") {
            this.notifyFire(alarm);
            // Force warp to 0 again — in case the warp recovered between
            // `arming` and `firing`, or for threshold alarms where there
            // was no `arming` phase at all.
            this.warp.stepWarpDown();
          }
          alarm.state = nextState;
          changed = true;
        }
      }
      if (changed) this.persist();
    }

    this.warp.reconcile(this.observedUT);
    this.warpObserver.detectUnscheduled();
    this.emit();
  }

  // ── Listeners + persistence ──────────────────────────────────────────

  private emit(): void {
    const snap = this.snapshot();
    for (const cb of this.snapshotListeners) cb(snap);
    this.peerBridge.broadcastSnapshot(snap);
  }

  private notifyFire(alarm: Alarm): void {
    for (const cb of this.fireListeners) cb(alarm);
    this.peerBridge.broadcastFire(alarm, this.observedUT);
  }

  private loadAlarms(): void {
    const stored = this.alarmStore.get();
    if (Array.isArray(stored) && stored.length > 0) {
      this.alarms = stored
        .map(migrateAlarm)
        .filter((a): a is Alarm => a !== null);
    }
  }

  private loadMargin(): number {
    const rawMargin = this.storage.getItem(WARP_MARGIN_STORAGE_KEY);
    if (rawMargin === null) return DEFAULT_WARP_SAFETY_MARGIN_SECONDS;
    const parsed = Number.parseFloat(rawMargin);
    if (!Number.isFinite(parsed)) return DEFAULT_WARP_SAFETY_MARGIN_SECONDS;
    return Math.max(
      MIN_WARP_SAFETY_MARGIN_SECONDS,
      Math.min(MAX_WARP_SAFETY_MARGIN_SECONDS, parsed),
    );
  }

  private persist(): void {
    this.alarmStore.set(this.alarms);
  }

  private persistWarpMargin(): void {
    this.storage.setItem(
      WARP_MARGIN_STORAGE_KEY,
      String(this.warp.getMarginSeconds()),
    );
  }

  private readTelemetryNumber(key: string): number | null {
    const v = this.telemetry?.getLatestValue(key);
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
}

export function createAlarmHost(
  host: PeerHostService | null,
  getTelemetry: () => BufferedDataSource | null,
  opts?: AlarmHostOptions,
): AlarmHostService {
  const telemetry: TelemetryReader = {
    getLatestValue(key: string): unknown {
      return getTelemetry()?.getLatestValue(key);
    },
    execute(action: string): Promise<void> {
      const src = getTelemetry();
      if (!src) return Promise.resolve();
      return src.execute(action);
    },
  };
  return new AlarmHostService(host, telemetry, opts);
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `alarm_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}
