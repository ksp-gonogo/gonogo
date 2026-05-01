import { slopeFit } from "@gonogo/core";
import type { Alarm, ThresholdOp, ThresholdTrigger } from "./types";

interface ThresholdSample {
  ut: number;
  value: number;
}

const THRESHOLD_SAMPLE_COUNT = 16;
const MIN_SAMPLES_FOR_SLOPE = 4;
const MIN_SAMPLE_SPAN_GAME_SECONDS = 1;

export interface TelemetryReader {
  getLatestValue(key: string): unknown;
  execute(action: string): Promise<void>;
}

/**
 * Owns the per-tick alarm state derivation: contiguous-match tracking for
 * threshold triggers, the rolling sample buffers used by the warp-to ETA
 * estimator, and the helpers (`findClosestPendingTrackableAlarm`,
 * `findEligiblePendingAlarm`, `hasUnmodelableThresholdOther`) that the warp
 * controller queries.
 *
 * The host owns the alarm array and `observedUT`; this module reads them
 * through getter callbacks so it never holds stale copies.
 */
export class AlarmStateMachine {
  private thresholdSamples = new Map<string, ThresholdSample[]>();

  constructor(
    private readonly telemetry: TelemetryReader | null,
    private readonly getAlarms: () => readonly Alarm[],
    private readonly getObservedUT: () => number | null,
  ) {}

  /**
   * Update threshold-match state for one alarm and append a slope-fit
   * sample if the alarm is still in the pending pre-match phase. Mutates
   * `alarm.matchSinceUT`. Returns true if `matchSinceUT` changed.
   *
   * IMPORTANT: must run *before* `deriveState` for the same tick — it
   * inspects `alarm.state` from the previous tick to decide whether to
   * keep the rolling buffer.
   */
  updateThresholdTracking(alarm: Alarm, ut: number): boolean {
    if (alarm.trigger.kind !== "threshold") return false;
    let changed = false;
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
    this.recordThresholdSample(alarm, ut);
    return changed;
  }

  /** Drop sample buffer for an alarm — used on delete or trigger change. */
  forget(alarmId: string): void {
    this.thresholdSamples.delete(alarmId);
  }

  /** Compute the next state for an alarm given the current observed UT. */
  deriveState(
    alarm: Alarm,
    now: number | null = this.getObservedUT(),
  ): Alarm["state"] {
    if (now === null) return "pending";
    if (alarm.trigger.kind === "time") {
      const { ut, leadSeconds } = alarm.trigger;
      if (now >= ut && now - ut < 2) return "firing";
      if (now >= ut) return "fired";
      if (ut - now <= leadSeconds) return "arming";
      return "pending";
    }
    if (alarm.state === "fired") return "fired";
    const t = alarm.trigger;
    if (alarm.matchSinceUT == null) return "pending";
    const heldFor = now - alarm.matchSinceUT;
    if (heldFor < t.sustainSeconds) return "pending";
    if (heldFor < t.sustainSeconds + 2) return "firing";
    return "fired";
  }

  /**
   * Pick the closest pending alarm we can plan against — earliest time
   * alarm or smallest-ETA threshold alarm.
   */
  findClosestPendingTrackableAlarm(): {
    alarm: Alarm;
    remainingGameSeconds: number;
  } | null {
    const ut = this.getObservedUT();
    if (ut === null) return null;
    let best: { alarm: Alarm; remaining: number } | null = null;
    for (const a of this.getAlarms()) {
      if (a.state !== "pending") continue;
      let remaining: number;
      if (a.trigger.kind === "time") {
        remaining = a.trigger.ut - a.trigger.leadSeconds - ut;
      } else {
        const eta = this.estimateThresholdEta(a);
        if (eta === null) continue;
        remaining = eta;
      }
      if (remaining <= 0) continue;
      if (!best || remaining < best.remaining) {
        best = { alarm: a, remaining };
      }
    }
    return best
      ? { alarm: best.alarm, remainingGameSeconds: best.remaining }
      : null;
  }

  /** Any pending alarm we could plausibly target (for warp-to hold). */
  findEligiblePendingAlarm(): Alarm | null {
    for (const a of this.getAlarms()) {
      if (a.state !== "pending") continue;
      if (a.trigger.kind === "time") return a;
      const t = a.trigger;
      if (t.op === "==" || t.op === "!=") continue;
      if (a.matchSinceUT != null) continue;
      return a;
    }
    return null;
  }

  /**
   * True iff a *different* pending threshold alarm exists whose ETA
   * cannot currently be modelled — the warp controller uses this to cap
   * the rate so the unmodelable target gets a chance to register.
   */
  hasUnmodelableThresholdOther(target: Alarm): boolean {
    return this.getAlarms().some((a) => {
      if (a.id === target.id) return false;
      if (a.state !== "pending") return false;
      if (a.trigger.kind !== "threshold") return false;
      if (a.matchSinceUT != null) return false;
      const t = a.trigger;
      if (t.op === "==" || t.op === "!=") return true;
      return this.estimateThresholdEta(a) === null;
    });
  }

  private evalThreshold(t: ThresholdTrigger): boolean {
    const observed = this.readTelemetryNumber(t.dataKey);
    if (observed === null) return false;
    return compare(observed, t.op, t.value);
  }

  private recordThresholdSample(alarm: Alarm, ut: number): void {
    if (alarm.trigger.kind !== "threshold") return;
    if (alarm.state !== "pending" || alarm.matchSinceUT != null) {
      this.thresholdSamples.delete(alarm.id);
      return;
    }
    const v = this.readTelemetryNumber(alarm.trigger.dataKey);
    if (v === null) return;
    const buf = this.thresholdSamples.get(alarm.id) ?? [];
    const last = buf[buf.length - 1];
    if (last && last.ut === ut) {
      last.value = v;
      return;
    }
    buf.push({ ut, value: v });
    while (buf.length > THRESHOLD_SAMPLE_COUNT) buf.shift();
    this.thresholdSamples.set(alarm.id, buf);
  }

  private estimateThresholdEta(alarm: Alarm): number | null {
    if (alarm.trigger.kind !== "threshold") return null;
    const t = alarm.trigger;
    if (t.op === "==" || t.op === "!=") return null;
    if (alarm.matchSinceUT != null) return null;
    const buf = this.thresholdSamples.get(alarm.id);
    if (!buf || buf.length < MIN_SAMPLES_FOR_SLOPE) return null;
    const span = buf[buf.length - 1].ut - buf[0].ut;
    if (span < MIN_SAMPLE_SPAN_GAME_SECONDS) return null;
    const fit = slopeFit(buf.map((s) => ({ x: s.ut, y: s.value })));
    if (fit === null) return null;
    const approachingUp = t.op === ">" || t.op === ">=";
    const distance = approachingUp
      ? t.value - fit.latestY
      : fit.latestY - t.value;
    if (distance <= 0) return null;
    const approachRate = approachingUp ? fit.slope : -fit.slope;
    if (approachRate <= 0) return null;
    return distance / approachRate;
  }

  private readTelemetryNumber(key: string): number | null {
    const v = this.telemetry?.getLatestValue(key);
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
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
