import { safeRandomUuid } from "@ksp-gonogo/core";
import { LocalStorageStore } from "@ksp-gonogo/data";
import { dispatchActiveCommand, getViewUt } from "@ksp-gonogo/sitrep-client";
import type { PeerHostService } from "../peer/PeerHostService";
import { AlarmPeerBridge } from "./AlarmPeerBridge";
import { AlarmStateMachine } from "./AlarmStateMachine";
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
 * Trigger kinds that need contiguous-match tracking via `matchSinceUT`.
 * Time triggers don't (they fire purely on UT comparison); threshold
 * and contract-parameter both do.
 */
function requiresMatchTracking(trigger: AlarmTrigger): boolean {
  return trigger.kind === "threshold" || trigger.kind === "contract-parameter";
}

/**
 * Main-screen mission-alarm service.
 *
 * Responsibilities:
 *   - Maintain the canonical alarm list (persisted in localStorage).
 *   - Tick at 1 Hz using the SDK's view time (`getViewUt`) to advance alarm
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
  private opts: Required<Pick<AlarmHostOptions, "nowMs" | "tickIntervalMs">>;
  private storage: Storage;
  private alarmStore: LocalStorageStore<Alarm[]>;
  private stateMachine: AlarmStateMachine;
  private warp: WarpControl;
  private warpObserver: WarpObserver;
  private peerBridge: AlarmPeerBridge;

  constructor(host: PeerHostService | null, opts: AlarmHostOptions = {}) {
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
      () => this.alarms,
      () => this.observedUT,
    );

    const initialMargin = this.loadMargin();
    this.warpObserver = new WarpObserver(
      {
        getAlarms: () => this.alarms,
        getObservedUT: () => this.observedUT,
        isWarpToActive: () => this.warp.isActive(),
      },
      this.opts.nowMs,
    );

    this.warp = new WarpControl(
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
      getSnapshot: () => this.snapshot(),
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
    onFire?: import("./types").AlarmFireAction[];
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
      matchSinceUT: requiresMatchTracking(input.trigger) ? null : undefined,
      onFire:
        input.onFire && input.onFire.length > 0 ? input.onFire : undefined,
    };
    this.alarms.push(alarm);
    this.persist();
    this.tick();
    return alarm;
  }

  updateAlarm(
    id: string,
    patch: Partial<Pick<Alarm, "name" | "notes" | "trigger" | "onFire">>,
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
      // Empty array is the explicit "clear" sentinel — same convention as
      // addAlarm, which normalises [] to undefined so an alarm without
      // side effects always stores `onFire: undefined`.
      ...(patch.onFire !== undefined
        ? { onFire: patch.onFire.length > 0 ? patch.onFire : undefined }
        : {}),
    };
    if (patch.trigger && patch.trigger.kind !== prev.trigger.kind) {
      next.matchSinceUT = requiresMatchTracking(patch.trigger)
        ? null
        : undefined;
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
    // Not a data-source key: `t.universalTime` was DROPPED — this is the
    // SDK's own view time, read via the non-hook `getViewUt` accessor rather
    // than the legacy telemetry reader.
    const ut = getViewUt() ?? null;
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
        // Contract-parameter tracking has the same shape (matchSinceUT
        // + sustain) but no rolling sample buffer — the underlying
        // condition is a discrete state-string match, not a numeric
        // approach.
        if (alarm.trigger.kind === "contract-parameter") {
          if (this.stateMachine.updateContractParameterTracking(alarm, ut)) {
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
    if (alarm.onFire && alarm.onFire.length > 0) {
      void this.dispatchOnFire(alarm);
    }
  }

  private async dispatchOnFire(alarm: Alarm): Promise<void> {
    if (!alarm.onFire) return;
    for (const fx of alarm.onFire) {
      switch (fx.kind) {
        case "action-group": {
          const outcome = dispatchActiveCommand("data", fx.action);
          if (outcome.routed) {
            try {
              await outcome.settled;
            } catch {
              // Swallow individual action failures so one missing action
              // group (e.g. `f.ag5` not bound on this vessel) doesn't
              // block the rest of the list. The visible alarm fire still
              // shows up regardless.
            }
          }
          break;
        }
      }
    }
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
}

/**
 * Convenience factory. Historically wrapped a live `BufferedDataSource`
 * lookup so the host could be constructed at MainScreen-mount time even
 * before the legacy `"data"` source was registered — now that every
 * telemetry read/command dispatch inside `AlarmHostService` rides the
 * stream (`getWarpState`/`getContractsActive`/`getValue`/
 * `dispatchActiveCommand`), there's nothing left to wrap; kept as a thin
 * pass-through so call sites (and `createManeuverTriggerHost`'s identical
 * shape) don't need to change.
 */
export function createAlarmHost(
  host: PeerHostService | null,
  opts?: AlarmHostOptions,
): AlarmHostService {
  return new AlarmHostService(host, opts);
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return safeRandomUuid();
  }
  return `alarm_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}
