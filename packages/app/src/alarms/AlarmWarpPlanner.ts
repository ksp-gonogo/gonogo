import { slopeFit } from "@ksp-gonogo/core";
import { getObservedValue } from "@ksp-gonogo/sitrep-client";
import { type Alarm, isAtSubjectVantage } from "./types";

interface ThresholdSample {
  ut: number;
  value: number;
}

const THRESHOLD_SAMPLE_COUNT = 16;
const MIN_SAMPLES_FOR_SLOPE = 4;
const MIN_SAMPLE_SPAN_GAME_SECONDS = 1;

/**
 * A threshold trigger's saved `dataKey`, read off the stream as a number, or
 * `null` for a read nobody could make. Only a reading that is `observed` now
 * answers: a held last payload is the number a widget last drew, not the
 * craft's, and comparing against it would fire or clear an alarm on history.
 *
 * It lives here rather than beside the evaluator because this is the module
 * that stays: the planner needs it to fill its sample buffer, and
 * `AlarmStateMachine` borrows it for the match comparison it will not own for
 * much longer. The import points the way the deletion goes.
 */
export function readThresholdTelemetryNumber(key: string): number | null {
  const v = getObservedValue("data", key);
  return v === undefined ? null : v;
}

/**
 * A one-way light time to be subtracted: a non-finite or negative reading
 * is no light time rather than a negative one, which would push a SCET instant
 * further away instead of closer.
 */
function safeOwltSeconds(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

/**
 * The warp-to ladder's planner: the rolling sample buffers behind the
 * slope-fit ETA, and the three queries `WarpControl` asks of them
 * (`findClosestPendingTrackableAlarm`, `findEligiblePendingAlarm`,
 * `hasUnmodelableThresholdOther`).
 *
 * Separate from `AlarmStateMachine` because the two have different futures.
 * Deciding whether an alarm's condition holds is the simulation's job and is
 * moving into the mod, where the reading is not a light-time old. Deciding how
 * far to warp is not: the operator's "warp until it fires" wants an ETA fitted
 * to the delayed samples this screen actually has, so it stays on this side
 * whatever the evaluator does.
 *
 * The host owns the alarm array and `observedUT`; this module reads them
 * through getter callbacks so it never holds stale copies. Sampling is driven
 * from the host tick rather than from the evaluator, so nothing here depends on
 * the evaluator running at all.
 */
export class AlarmWarpPlanner {
  private thresholdSamples = new Map<string, ThresholdSample[]>();

  constructor(
    private readonly getAlarms: () => readonly Alarm[],
    private readonly getObservedUT: () => number | null,
    /**
     * One-way light time to the craft, seconds, or 0 where there is none.
     *
     * A SCET alarm's instant is on the craft's clock while every countdown
     * planned here is on the view clock, so the two are a light-time apart and
     * a warp-to ladder that did not close the gap would plan against an instant
     * that is not the one the mod will stop it at. Defaulted so a caller with
     * no vantage of its own needs no argument.
     */
    private readonly getOwltSeconds: () => number = () => 0,
  ) {}

  /**
   * Append a slope-fit sample for one alarm, if it is still in the pending
   * pre-match phase.
   *
   * IMPORTANT: must run AFTER match tracking and BEFORE `deriveState` for the
   * same tick. It reads the latch that tracking just wrote, and `alarm.state`
   * from the PREVIOUS tick, to decide whether to keep the rolling buffer.
   */
  recordThresholdSample(alarm: Alarm, ut: number): void {
    if (alarm.trigger.kind !== "threshold") return;
    /* Samples exist to fit an ETA for the warp-to ladder, and a mod-stopped
       threshold has no use for one: the mod stops the warp itself, in the frame
       it decides to, so a ladder planned from delayed samples would only be a
       second authority arriving late.

       Asks the WARP-STOP question, not the vantage one. They coincide today
       because every alarm the mod holds is at its own subject's vantage or is
       a command-vantage threshold it does not yet latch. They diverge when
       that threshold flips: this then wants `ScetAlarmBridge.holdsAlarm`, and
       the planner has no bridge to ask. */
    if (isAtSubjectVantage(alarm.trigger)) return;
    if (alarm.state !== "pending" || alarm.matchSinceUT != null) {
      this.thresholdSamples.delete(alarm.id);
      return;
    }
    const v = readThresholdTelemetryNumber(alarm.trigger.dataKey);
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

  /** Drop sample buffer for an alarm: used on delete or trigger change. */
  forget(alarmId: string): void {
    this.thresholdSamples.delete(alarmId);
  }

  /**
   * Pick the closest pending alarm we can plan against, earliest time
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
        /* Every time instant is the game's own universal time and `ut` is the
           view clock, so the light-time always comes off it: the mod stops the
           warp when the GAME reaches `ut - lead`, which the operator's screen
           reaches one light-time later. Not conditional, because a time alarm
           carries no vantage to be conditional on. */
        const vantageOffset = safeOwltSeconds(this.getOwltSeconds());
        remaining = a.trigger.ut - vantageOffset - a.trigger.leadSeconds - ut;
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
      // Contract-parameter and event triggers are discrete transitions;
      // there's no scalar to warp toward, so they're not warp-targetable.
      if (a.trigger.kind === "contract-parameter") continue;
      if (a.trigger.kind === "event") continue;
      /* Not warp-targetable either, for a different reason: there IS a scalar,
         but the mod is watching it and will stop the warp on its own. A ladder
         aimed at it would be planning against readings a light-time behind the
         comparison that decides it.

         Asks the WARP-STOP question, not the vantage one. They coincide today
         because every alarm the mod holds is at its own subject's vantage or is
         a command-vantage threshold it does not yet latch. They diverge when
         that threshold flips: this then wants `ScetAlarmBridge.holdsAlarm`, and
         the planner has no bridge to ask. */
      if (isAtSubjectVantage(a.trigger)) continue;
      const t = a.trigger;
      if (t.op === "==" || t.op === "!=") continue;
      if (a.matchSinceUT != null) continue;
      return a;
    }
    return null;
  }

  /**
   * True iff a *different* pending threshold alarm exists whose ETA
   * cannot currently be modelled: the warp controller uses this to cap
   * the rate so the unmodelable target gets a chance to register.
   */
  hasUnmodelableThresholdOther(target: Alarm): boolean {
    return this.getAlarms().some((a) => {
      if (a.id === target.id) return false;
      if (a.state !== "pending") return false;
      if (a.trigger.kind !== "threshold") return false;
      /* Never one the mod stops. This caps the warp so an unmodelable alarm has
         ticks to register in, and a mod-stopped one needs none: the stop happens
         upstream of everything this side can see, at whatever rate the game is
         running.

         Asks the WARP-STOP question, not the vantage one. They coincide today
         because every alarm the mod holds is at its own subject's vantage or is
         a command-vantage threshold it does not yet latch. They diverge when
         that threshold flips: this then wants `ScetAlarmBridge.holdsAlarm`, and
         the planner has no bridge to ask. */
      if (isAtSubjectVantage(a.trigger)) return false;
      if (a.matchSinceUT != null) return false;
      const t = a.trigger;
      if (t.op === "==" || t.op === "!=") return true;
      return this.estimateThresholdEta(a) === null;
    });
  }

  private estimateThresholdEta(alarm: Alarm): number | null {
    if (alarm.trigger.kind !== "threshold") return null;
    /* See `recordThresholdSample`: no samples are kept for one the mod stops,
       so this would answer null anyway. Said here as well, because a reader
       deciding whether a warp-to can target one should not have to trace it
       through an empty buffer. It carries the same expiry as that one. */
    if (isAtSubjectVantage(alarm.trigger)) return null;
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
}
