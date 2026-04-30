import { logger } from "@gonogo/core";
import type { BufferedDataSource } from "@gonogo/data";
import type { PeerHostService } from "../peer/PeerHostService";
import {
  type Alarm,
  type AlarmSnapshot,
  type AlarmTrigger,
  type AlarmWarpState,
  DEFAULT_WARP_SAFETY_MARGIN_SECONDS,
  MAX_WARP_SAFETY_MARGIN_SECONDS,
  MIN_WARP_SAFETY_MARGIN_SECONDS,
  migrateAlarm,
  type ThresholdOp,
  type ThresholdTrigger,
  type TimeTrigger,
} from "./types";

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
 * Intentionally minimal v1: the warp step-down is a single `t.timeWarp[0]`
 * command; KSP's own gradual-drop behaviour smooths the transition. More
 * elaborate step ladders can slot in later without changing the shape.
 */

const STORAGE_KEY = "gonogo.alarms.list";
const WARP_MARGIN_STORAGE_KEY = "gonogo.alarms.warpSafetyMargin";
/** Grace window around a station-initiated warp intent — any observed
 *  warp change within this window is attributed to the station. */
const WARP_INTENT_WINDOW_MS = 2_000;
/** Minimum interval between `t.timeWarp[0]` executes to avoid spamming. */
const WARP_COMMAND_COOLDOWN_MS = 1_500;
/** KSP HIGH-warp ladder. Index → multiplier. Mirrors WarpControl widget. */
const HIGH_WARP_RATES: readonly number[] = [
  1, 5, 10, 50, 100, 1000, 10000, 100000,
];
/** Cap warp-to ladder when any threshold alarm is pending — at 100× one
 *  1-Hz tick advances 100 game-seconds, leaving room for telemetry-driven
 *  alarms to register before they're skipped past. */
const THRESHOLD_PRESENT_MAX_INDEX = 4;

interface TelemetryReader {
  getLatestValue(key: string): unknown;
  execute(action: string): Promise<void>;
}

type SnapshotListener = (snapshot: AlarmSnapshot) => void;
type FireListener = (alarm: Alarm) => void;

export interface AlarmHostOptions {
  /** Override for tests — defaults to setInterval / Date.now. */
  nowMs?: () => number;
  /** ms between ticks. Default 1000. */
  tickIntervalMs?: number;
  /** Storage override for tests. */
  storage?: Storage;
}

export class AlarmHostService {
  private alarms: Alarm[] = [];
  private snapshotListeners = new Set<SnapshotListener>();
  private fireListeners = new Set<FireListener>();
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private lastStepDownAt = 0;
  private lastStationWarpIntentAt: number | null = null;
  private observedWarp: AlarmWarpState = {
    index: 0,
    rate: 1,
    mode: "UNKNOWN",
  };
  private observedUT: number | null = null;
  private unscheduledWarp: AlarmSnapshot["unscheduledWarp"] = null;
  private warpToActive = false;
  private warpToAlarmId: string | null = null;
  private warpToTargetIndex = 0;
  private warpSafetyMarginSeconds: number = DEFAULT_WARP_SAFETY_MARGIN_SECONDS;
  private host: PeerHostService | null;
  private telemetry: TelemetryReader | null;
  private opts: Required<Pick<AlarmHostOptions, "nowMs" | "tickIntervalMs">>;
  private storage: Storage;

  constructor(
    host: PeerHostService | null,
    telemetry: TelemetryReader | null,
    opts: AlarmHostOptions = {},
  ) {
    this.host = host;
    this.telemetry = telemetry;
    this.opts = {
      nowMs: opts.nowMs ?? (() => Date.now()),
      tickIntervalMs: opts.tickIntervalMs ?? 1000,
    };
    this.storage = opts.storage ?? globalThis.localStorage;
    this.load();
    this.bindPeerListeners();
    this.start();
  }

  // ── Public API ────────────────────────────────────────────────────────

  snapshot(): AlarmSnapshot {
    return {
      alarms: [...this.alarms],
      ut: this.observedUT,
      warp: this.observedWarp,
      unscheduledWarp: this.unscheduledWarp,
      warpTo: this.warpToActive
        ? {
            alarmId: this.warpToAlarmId ?? "",
            targetIndex: this.warpToTargetIndex,
          }
        : null,
      warpSafetyMarginSeconds: this.warpSafetyMarginSeconds,
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
      // firing with the usual side effects (warp step-down etc.), so the
      // state machine stays driven from a single place.
      state: "pending",
      createdBy: input.createdBy ?? "main",
      createdAt: this.opts.nowMs(),
      matchSinceUT: input.trigger.kind === "threshold" ? null : undefined,
    };
    this.alarms.push(alarm);
    this.persist();
    // Reconcile immediately so the banner doesn't show "pending" for a
    // second after adding an already-arming alarm, and so the warp
    // step-down fires without waiting for the next interval.
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
    // If the trigger kind changed, reset the match-tracking state so the
    // sustain timer doesn't carry stale data across the change.
    if (patch.trigger && patch.trigger.kind !== prev.trigger.kind) {
      next.matchSinceUT = patch.trigger.kind === "threshold" ? null : undefined;
      next.state = "pending";
    } else {
      next.state = this.deriveState(next);
    }
    this.alarms[idx] = next;
    this.persist();
    this.emit();
  }

  deleteAlarm(id: string): void {
    const before = this.alarms.length;
    this.alarms = this.alarms.filter((a) => a.id !== id);
    if (this.alarms.length !== before) {
      this.persist();
      this.emit();
    }
  }

  acknowledgeUnscheduledWarp(): void {
    if (!this.unscheduledWarp) return;
    this.unscheduledWarp = null;
    this.emit();
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

  /** Station said "I just asked KSP to change warp". Remember so the
   *  unscheduled-warp detector doesn't flag that change. */
  registerStationWarpIntent(): void {
    this.lastStationWarpIntentAt = this.opts.nowMs();
  }

  /**
   * Begin a "warp to next alarm" session. The controller targets the
   * closest pending time alarm and re-targets each tick — if a sooner
   * alarm is added mid-session, the rate cap follows automatically.
   * When any pending threshold alarm exists, the rate is capped at
   * `THRESHOLD_PRESENT_MAX_INDEX` so a single tick can't skip past a
   * telemetry-driven cross. No-op when there are no eligible alarms.
   */
  beginWarpTo(): void {
    if (this.findClosestPendingTimeAlarm() === null) return;
    this.warpToActive = true;
    this.warpToTargetIndex = 0;
    // Suppress the unscheduled-warp detector for the warp-up command we're
    // about to issue.
    this.lastStationWarpIntentAt = this.opts.nowMs();
    // Reconcile immediately so the first warp-up command fires without
    // waiting a full tick.
    this.tick();
  }

  /** End the current warp-to session and drop warp to 1×. */
  cancelWarpTo(): void {
    if (!this.warpToActive) return;
    this.warpToActive = false;
    this.warpToAlarmId = null;
    this.warpToTargetIndex = 0;
    this.commandWarp(0);
    this.emit();
  }

  /** Update the real-time safety margin used by the warp-to controller. */
  setWarpSafetyMargin(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    const clamped = Math.max(
      MIN_WARP_SAFETY_MARGIN_SECONDS,
      Math.min(MAX_WARP_SAFETY_MARGIN_SECONDS, seconds),
    );
    if (clamped === this.warpSafetyMarginSeconds) return;
    this.warpSafetyMarginSeconds = clamped;
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
    // Do an immediate pass so the first snapshot reflects persisted state.
    this.tick();
  }

  private tick(): void {
    const ut = this.readTelemetryNumber("t.universalTime");
    this.observedUT = ut ?? this.observedUT;
    this.observeWarp();

    if (ut !== null) {
      let changed = false;
      for (const alarm of this.alarms) {
        // Threshold alarms maintain `matchSinceUT` — track contiguous
        // condition match so sustain seconds is measured from the
        // current run, not an old one.
        if (alarm.trigger.kind === "threshold") {
          const matched = this.evalThreshold(alarm.trigger);
          if (matched) {
            if (alarm.matchSinceUT == null) {
              alarm.matchSinceUT = ut;
              changed = true;
            }
          } else if (alarm.matchSinceUT != null) {
            alarm.matchSinceUT = null;
            changed = true;
          }
        }

        const nextState = this.deriveState(alarm, ut);
        if (nextState !== alarm.state) {
          if (alarm.state !== "arming" && nextState === "arming") {
            this.stepWarpDown();
          }
          if (alarm.state !== "firing" && nextState === "firing") {
            this.notifyFire(alarm);
            // Also force warp to 0 one more time — in case the warp
            // recovered between `arming` and `firing`. Threshold alarms
            // also benefit (a slow build-up to a max-Q-style threshold
            // shouldn't stay in elevated warp once it fires).
            this.stepWarpDown();
          }
          alarm.state = nextState;
          changed = true;
        }
      }
      // Fired alarms now stick around until the operator acks them via
      // the banner — auto-purging after 5s let telemetry-based alarms
      // fire and vanish before anyone noticed.

      if (changed) this.persist();
    }

    this.updateWarpTo();
    this.detectUnscheduledWarp();
    this.emit();
  }

  /**
   * Walk the warp ladder up/down based on remaining game-time until the
   * closest pending time alarm's lead window. We pick the highest rate
   * that leaves at least `warpSafetyMarginSeconds` of real-time before
   * arming, so the existing alarm-arming `stepWarpDown` is a safety net
   * rather than the primary control. The closest pending time alarm is
   * recomputed each tick — adding a sooner alarm mid-session retargets
   * automatically.
   */
  private updateWarpTo(): void {
    if (!this.warpToActive) return;
    const closest = this.findClosestPendingTimeAlarm();
    // Cancel if there's nothing left to warp toward — the alarm system
    // takes over once an alarm transitions to `arming`/`firing`.
    if (closest === null) {
      this.warpToActive = false;
      this.warpToAlarmId = null;
      this.warpToTargetIndex = 0;
      return;
    }
    const ut = this.observedUT;
    if (ut === null) return;
    this.warpToAlarmId = closest.id;
    const targetIndex = this.computeWarpToIndex(
      closest.trigger as TimeTrigger,
      ut,
    );
    this.warpToTargetIndex = targetIndex;
    if (targetIndex === this.observedWarp.index) return;
    // Refresh the intent stamp so each issued command suppresses the
    // unscheduled-warp detector for its observation window.
    this.lastStationWarpIntentAt = this.opts.nowMs();
    this.commandWarp(targetIndex);
  }

  /** Return the pending time alarm with the smallest `trigger.ut`, or null. */
  private findClosestPendingTimeAlarm(): Alarm | null {
    let best: Alarm | null = null;
    let bestUt = Number.POSITIVE_INFINITY;
    for (const a of this.alarms) {
      if (a.state !== "pending") continue;
      if (a.trigger.kind !== "time") continue;
      if (a.trigger.ut < bestUt) {
        best = a;
        bestUt = a.trigger.ut;
      }
    }
    return best;
  }

  private computeWarpToIndex(trigger: TimeTrigger, utNow: number): number {
    // Game-seconds remaining until the alarm enters its lead window.
    const remainingGameSeconds = trigger.ut - trigger.leadSeconds - utNow;
    if (remainingGameSeconds <= 0) return 0;
    // Highest sustainable rate where (remaining / rate) >= safetyMargin
    // real-seconds — i.e. rate <= remaining / safetyMargin.
    const maxRate = remainingGameSeconds / this.warpSafetyMarginSeconds;
    // Threshold alarms have no fire-UT — we can't predict when they cross.
    // A single 10kx tick could skip past one entirely, so when any are
    // pending, hold rate at a level where one tick advances at most ~100s
    // of game time. 100× is a pragmatic balance: still useful for long
    // coast phases, conservative enough that altitude- or velocity-driven
    // thresholds get a chance to fire.
    const cap = this.hasPendingThresholdAlarm()
      ? THRESHOLD_PRESENT_MAX_INDEX
      : HIGH_WARP_RATES.length - 1;
    let chosen = 0;
    for (let i = cap; i >= 0; i--) {
      if (HIGH_WARP_RATES[i] <= maxRate) {
        chosen = i;
        break;
      }
    }
    return chosen;
  }

  private hasPendingThresholdAlarm(): boolean {
    return this.alarms.some(
      (a) => a.state === "pending" && a.trigger.kind === "threshold",
    );
  }

  private commandWarp(index: number): void {
    if (!this.telemetry) return;
    void this.telemetry.execute(`t.timeWarp[${index}]`).catch((err) => {
      logger.warn("alarm-host: warp command failed", {
        index,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private deriveState(
    alarm: Alarm,
    now: number | null = this.observedUT,
  ): Alarm["state"] {
    if (now === null) return "pending";
    if (alarm.trigger.kind === "time") {
      const { ut, leadSeconds } = alarm.trigger;
      if (now >= ut && now - ut < 2) return "firing";
      if (now >= ut) return "fired";
      if (ut - now <= leadSeconds) return "arming";
      return "pending";
    }
    // Threshold trigger
    const t = alarm.trigger;
    if (alarm.matchSinceUT == null) {
      // Once an alarm has fired, a state of "fired" should not regress
      // to "pending" just because the condition fell out of match. The
      // tick() filter drops fired alarms after a few seconds.
      return alarm.state === "fired" ? "fired" : "pending";
    }
    const heldFor = now - alarm.matchSinceUT;
    if (heldFor < t.sustainSeconds) return "pending";
    if (heldFor < t.sustainSeconds + 2) return "firing";
    return "fired";
  }

  private evalThreshold(t: ThresholdTrigger): boolean {
    const observed = this.readTelemetryNumber(t.dataKey);
    if (observed === null) return false;
    return compare(observed, t.op, t.value);
  }

  // ── Warp observation + detection ──────────────────────────────────────

  private observeWarp(): void {
    // Telemachus Reborn publishes the warp index as `t.timeWarp`; older
    // builds and tests sometimes use `t.currentRateIndex`. Try both.
    const index =
      this.readTelemetryNumber("t.timeWarp") ??
      this.readTelemetryNumber("t.currentRateIndex");
    const rate = this.readTelemetryNumber("t.currentRate");
    const rawMode = this.telemetry?.getLatestValue("t.warpMode");
    const mode: AlarmWarpState["mode"] =
      rawMode === "HIGH" || rawMode === "LOW" ? rawMode : "UNKNOWN";
    this.observedWarp = {
      index: index ?? this.observedWarp.index,
      rate: rate ?? this.observedWarp.rate,
      mode,
    };
  }

  private detectUnscheduledWarp(): void {
    // 1× warp is normal — clear any previous flag. Use the rate (always
    // populated by Telemachus) and the index (often null) together so a
    // missing index doesn't suppress detection.
    const elevated = this.observedWarp.index > 0 || this.observedWarp.rate > 1;
    if (!elevated) {
      this.unscheduledWarp = null;
      return;
    }

    const ut = this.observedUT;
    if (ut === null) return;

    // Any alarm currently arming/firing accounts for elevated warp.
    const anyArming = this.alarms.some(
      (a) => a.state === "arming" || a.state === "firing",
    );
    if (anyArming) {
      this.unscheduledWarp = null;
      return;
    }

    // An active warp-to session is the operator's deliberate command —
    // never flag it as unscheduled, even after the rate settles and we've
    // stopped issuing per-tick commands.
    if (this.warpToActive) {
      this.unscheduledWarp = null;
      return;
    }

    // A recent station-initiated change accounts for it, too.
    const now = this.opts.nowMs();
    if (
      this.lastStationWarpIntentAt !== null &&
      now - this.lastStationWarpIntentAt < WARP_INTENT_WINDOW_MS
    ) {
      return;
    }

    // Only flag once per episode — while warp stays elevated, keep the
    // same detection UT so the banner shows a stable "since X" clock.
    if (!this.unscheduledWarp) {
      this.unscheduledWarp = {
        index: this.observedWarp.index,
        detectedAtUT: ut,
      };
    } else {
      this.unscheduledWarp.index = this.observedWarp.index;
    }
  }

  private stepWarpDown(): void {
    // The alarm-arming side effect can be re-triggered every tick while
    // arming; throttle so KSP doesn't get flooded with the same command.
    // Independent of the warp-to controller's command stream.
    const now = this.opts.nowMs();
    if (now - this.lastStepDownAt < WARP_COMMAND_COOLDOWN_MS) return;
    this.lastStepDownAt = now;
    this.commandWarp(0);
  }

  // ── Peer wiring ───────────────────────────────────────────────────────

  private bindPeerListeners(): void {
    if (!this.host) return;
    this.host.onAlarmAdd((peerId, msg) => {
      this.addAlarm({
        name: msg.name,
        notes: msg.notes,
        trigger: msg.trigger,
        createdBy: peerId,
      });
    });
    this.host.onAlarmUpdate((_peerId, msg) => {
      this.updateAlarm(msg.id, msg.patch);
    });
    this.host.onAlarmDelete((_peerId, id) => {
      this.deleteAlarm(id);
    });
    this.host.onAlarmAcknowledge((_peerId, id) => {
      this.acknowledgeAlarm(id);
    });
    this.host.onAlarmAckUnscheduledWarp(() => {
      this.acknowledgeUnscheduledWarp();
    });
    this.host.onAlarmWarpIntent(() => {
      this.registerStationWarpIntent();
    });
  }

  private notifyFire(alarm: Alarm): void {
    for (const cb of this.fireListeners) cb(alarm);
    // Peers broadcast keeps a top-level `ut` for backwards compatibility
    // with stations on older bundles. Threshold alarms report the UT at
    // which the condition fired (matchSinceUT + sustain).
    const firedUt =
      alarm.trigger.kind === "time"
        ? alarm.trigger.ut
        : (alarm.matchSinceUT ?? this.observedUT ?? 0) +
          alarm.trigger.sustainSeconds;
    this.host?.broadcast({
      type: "alarm-fired",
      id: alarm.id,
      name: alarm.name,
      ut: firedUt,
    });
  }

  // ── Listeners + persistence ──────────────────────────────────────────

  private emit(): void {
    const snap = this.snapshot();
    for (const cb of this.snapshotListeners) cb(snap);
    this.host?.broadcast({ type: "alarm-snapshot", snapshot: snap });
  }

  private load(): void {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown[];
        if (Array.isArray(parsed)) {
          this.alarms = parsed
            .map(migrateAlarm)
            .filter((a): a is Alarm => a !== null);
        }
      } catch {
        // Corrupt — nuke and start fresh.
        this.storage.removeItem(STORAGE_KEY);
      }
    }
    const rawMargin = this.storage.getItem(WARP_MARGIN_STORAGE_KEY);
    if (rawMargin !== null) {
      const parsed = Number.parseFloat(rawMargin);
      if (Number.isFinite(parsed)) {
        this.warpSafetyMarginSeconds = Math.max(
          MIN_WARP_SAFETY_MARGIN_SECONDS,
          Math.min(MAX_WARP_SAFETY_MARGIN_SECONDS, parsed),
        );
      }
    }
  }

  private persist(): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(this.alarms));
  }

  private persistWarpMargin(): void {
    this.storage.setItem(
      WARP_MARGIN_STORAGE_KEY,
      String(this.warpSafetyMarginSeconds),
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
  // BufferedDataSource implements both getLatestValue and execute.
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

function compare(observed: number, op: ThresholdOp, value: number): boolean {
  switch (op) {
    case ">":
      return observed > value;
    case ">=":
      return observed >= value;
    case "<":
      return observed < value;
    case "<=":
      return observed <= value;
    case "==":
      return observed === value;
    case "!=":
      return observed !== value;
  }
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `alarm_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}
