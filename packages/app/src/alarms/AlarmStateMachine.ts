import { slopeFit } from "@ksp-gonogo/core";
import {
  type EventOccurrence,
  getContractsActive,
  getValue,
} from "@ksp-gonogo/sitrep-client";
import type { CareerContract } from "@ksp-gonogo/sitrep-sdk";
import { KspParameterState } from "@ksp-gonogo/sitrep-sdk";
import {
  type Alarm,
  type ContractParameterTargetState,
  type ContractParameterTrigger,
  type EventTrigger,
  isScetTrigger,
  type ThresholdOp,
  type ThresholdTrigger,
} from "./types";

/**
 * A one-way light time fit to be subtracted: a non-finite or negative reading
 * is no light time rather than a negative one, which would push a SCET instant
 * further away instead of closer.
 */
function safeOwltSeconds(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

/**
 * Reader for the revealed occurrences on an event topic, the seam the
 * `event` trigger consumes. Returns occurrences already past the reveal gate
 * (delay + connectivity), newest-last; see `EventTimeline.revealed`. Defaults
 * to empty on the host until a producer topic is wired.
 */
export type RevealedEventsReader = (
  topic: string,
) => readonly EventOccurrence[];

interface ThresholdSample {
  ut: number;
  value: number;
}

/**
 * A contract-parameter trigger's persisted target word → KSP's own ordinal.
 *
 * The trigger stores a word because it lives in the operator's saved alarms and
 * is our vocabulary, not KSP's wire; this is the one place it has to meet the
 * wire, and it meets it as a number.
 */
const TARGET_STATE_ORDINAL: Record<
  ContractParameterTargetState,
  KspParameterState
> = {
  Complete: KspParameterState.Complete,
  Failed: KspParameterState.Failed,
};

const THRESHOLD_SAMPLE_COUNT = 16;
const MIN_SAMPLES_FOR_SLOPE = 4;
const MIN_SAMPLE_SPAN_GAME_SECONDS = 1;

/**
 * Owns the per-tick alarm state derivation: contiguous-match tracking for
 * threshold triggers, the rolling sample buffers used by the warp-to ETA
 * estimator, and the helpers (`findClosestPendingTrackableAlarm`,
 * `findEligiblePendingAlarm`, `hasUnmodelableThresholdOther`) that the warp
 * controller queries.
 *
 * The host owns the alarm array and `observedUT`; this module reads them
 * through getter callbacks so it never holds stale copies. Threshold
 * `dataKey` reads and the contract-parameter trigger's `contracts.active`
 * read both come off the stream now (`getValue`/`getContractsActive`,
 * `@ksp-gonogo/sitrep-client`) rather than the legacy `"data"` `DataSource`,
 * `DataKeyPicker`'s Value restriction (`useValueKeys`) guarantees a
 * `ThresholdTrigger.dataKey` always has a stream home.
 */
export class AlarmStateMachine {
  private thresholdSamples = new Map<string, ThresholdSample[]>();
  /**
   * Per-event-alarm watch baseline: the observed UT at which the alarm first
   * ticked. Only occurrences revealed after this fire, so an alarm never
   * replays an event already in the buffer when it's created. Not persisted,
   * a reload restarts the watch from the reload UT (old events don't re-fire;
   * an already-latched `matchSinceUT` still keeps the alarm fired).
   */
  private eventWatchFrom = new Map<string, number>();

  constructor(
    private readonly getAlarms: () => readonly Alarm[],
    private readonly getObservedUT: () => number | null,
    private readonly getRevealedEvents: RevealedEventsReader = () => [],
    /**
     * The active contract list the contract-parameter trigger matches against.
     * Injected like the three readers above it, and defaulted to the live
     * stream read so no caller changes.
     *
     * It was a bare module-level `getContractsActive()` call inside the matcher,
     * which is the one read this class made without a seam: a test could only
     * reach it by standing up a whole `TelemetryProvider` and keeping a
     * subscription open, so the trigger's own matching rule had no unit-level
     * coverage at all. It is the trigger whose failure mode is an alarm that
     * never fires, so that is the wrong one to leave unreachable.
     */
    private readonly getContracts: () =>
      | readonly CareerContract[]
      | undefined = getContractsActive,
    /**
     * One-way light time to the craft, seconds, or 0 where there is none.
     *
     * Only the SCET arm needs it, and it needs it for one thing: a SCET alarm's
     * instant is on the craft's clock while every countdown drawn here is on the
     * view clock, so the two are a light-time apart and a warp-to ladder that
     * did not close the gap would plan against an instant that is not the one
     * the mod will stop it at. Defaulted so no existing caller changes.
     */
    private readonly getOwltSeconds: () => number = () => 0,
  ) {}

  /**
   * Update threshold-match state for one alarm and append a slope-fit
   * sample if the alarm is still in the pending pre-match phase. Mutates
   * `alarm.matchSinceUT`. Returns true if `matchSinceUT` changed.
   *
   * `previously` is the UT of the last tick, and it is what lets an
   * UNREADABLE read be held apart from a read that says no: see
   * `evalThreshold`. Pass `null` where there is no previous tick, and an
   * unreadable read simply leaves the latch untouched.
   *
   * IMPORTANT: must run *before* `deriveState` for the same tick, it
   * inspects `alarm.state` from the previous tick to decide whether to
   * keep the rolling buffer.
   */
  updateThresholdTracking(
    alarm: Alarm,
    ut: number,
    previously: number | null = null,
  ): boolean {
    if (alarm.trigger.kind !== "threshold") return false;
    /*
     * A SCET threshold is the mod's to evaluate, and this would do more than
     * duplicate it: the latch it writes is the SAME field the fire notice
     * writes, so a client comparing its own delayed reading would clear a latch
     * the mod had already set, or set one the mod never will. The read here is
     * a light-time old by construction, which is the whole reason the arm
     * exists.
     */
    if (isScetTrigger(alarm.trigger)) return false;
    let changed = false;
    const matched = this.evalThreshold(alarm.trigger);
    if (matched === null) {
      /*
       * The read failed, so the condition neither held nor ended and the
       * latch stays. What the seconds since the last tick DID do is go
       * unobserved, so they must not pay into `sustainSeconds`: slide the
       * latch forward by the gap instead, and the sustain keeps measuring
       * time we actually watched the condition hold. Clearing the latch (what
       * this did) restarts the sustain on every dropout, so a link flapping
       * faster than `sustainSeconds` never lets the alarm fire; holding it
       * without the slide fires on a blackout nobody saw through.
       */
      if (
        alarm.matchSinceUT != null &&
        previously !== null &&
        ut > previously
      ) {
        alarm.matchSinceUT += ut - previously;
        changed = true;
      }
    } else if (matched) {
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

  /**
   * Update contract-parameter match state. Same shape as
   * `updateThresholdTracking` minus the slope-fit sample buffer (no
   * numeric value to model). Mutates `alarm.matchSinceUT`; returns true
   * iff it changed.
   *
   * `previously` is the UT of the last tick, and it does the same job here as
   * it does there: an UNREADABLE contract list leaves the latch alone and
   * slides it forward by the gap, so seconds nobody watched cannot pay into
   * `sustainSeconds`. Pass `null` where there is no previous tick.
   */
  updateContractParameterTracking(
    alarm: Alarm,
    ut: number,
    previously: number | null = null,
  ): boolean {
    if (alarm.trigger.kind !== "contract-parameter") return false;
    const matched = this.evalContractParameter(alarm.trigger);
    if (matched === null) {
      // See `updateThresholdTracking`: the read failed, so the condition
      // neither held nor ended. Hold the latch, slide it past the unobserved
      // gap. Clearing restarts the sustain on every dropout; holding without
      // the slide fires on a blackout nobody saw through.
      if (
        alarm.matchSinceUT != null &&
        previously !== null &&
        ut > previously
      ) {
        alarm.matchSinceUT += ut - previously;
        return true;
      }
      return false;
    }
    if (matched) {
      if (alarm.matchSinceUT == null) {
        alarm.matchSinceUT = ut;
        return true;
      }
      return false;
    }
    if (alarm.matchSinceUT != null) {
      alarm.matchSinceUT = null;
      return true;
    }
    return false;
  }

  /**
   * Latch an event alarm the moment a matching occurrence is revealed after
   * the alarm began watching. Edge-triggered: `matchSinceUT` is set to the
   * observed UT at reveal (NOT the occurrence's own UT, a delayed occurrence
   * reveals long after it happened, and the firing window must start from
   * reveal so the `firing` transition isn't skipped). Once latched it never
   * clears; an occurrence is a fact of the past. Returns true iff it changed.
   *
   * The occurrence's own `ut` is kept separately on `alarm.eventUT`: it is
   * when the thing HAPPENED, which under delay is long before it was revealed,
   * and it is the number an operator reads first.
   */
  updateEventTracking(alarm: Alarm, ut: number): boolean {
    if (alarm.trigger.kind !== "event") return false;
    if (alarm.matchSinceUT != null) return false;
    const from = this.eventWatchFrom.get(alarm.id);
    if (from == null) {
      // First tick for this alarm: start watching from now.
      this.eventWatchFrom.set(alarm.id, ut);
      return false;
    }
    const match = this.findEventMatch(alarm.trigger, from, ut);
    if (match !== null) {
      alarm.matchSinceUT = ut;
      alarm.eventUT = match.ut;
      return true;
    }
    return false;
  }

  /** Drop sample buffer for an alarm: used on delete or trigger change. */
  forget(alarmId: string): void {
    this.thresholdSamples.delete(alarmId);
    this.eventWatchFrom.delete(alarmId);
  }

  /**
   * Compute the next state for an alarm given the current observed UT.
   *
   * `previously` is the UT this same alarm was last evaluated at, and it is
   * what makes a time alarm (and a sustained threshold or contract-parameter
   * alarm, which come due at `matchSinceUT + sustainSeconds`) survive warp.
   * An `event` alarm needs no such companion: it latches `matchSinceUT` at
   * reveal, so its window opens on the deriving tick itself. The firing test
   * used to be pure
   * CONTAINMENT (`now - ut < 2`), and the host fires only on the TRANSITION
   * into `firing`; but the host ticks at 1 Hz while `viewUt` advances at the
   * warp rate, so one tick moves the clock by ~W seconds. Above ~1000x neither
   * that 2-second window nor the arming window is ever observed: the alarm went
   * straight to `fired`, and nothing notified, nothing broadcast, no `onFire`
   * action group ran and warp was never stepped down.
   *
   * A CROSSING test is the fix rather than a wider window, because any window
   * is only a faster warp away from the same silence. Pass `null` (the default)
   * where there is no previous evaluation to compare against, and the old
   * containment behaviour is what remains.
   */
  deriveState(
    alarm: Alarm,
    now: number | null = this.getObservedUT(),
    previously: number | null = null,
  ): Alarm["state"] {
    if (now === null) return "pending";
    if (isScetTrigger(alarm.trigger)) {
      /*
       * Not ours to decide. The instant is on the craft's clock and the mod is
       * what compares against it, upstream of the reveal gate; comparing it to
       * the view clock here would fire the alarm a light-time after the mod
       * already stopped the warp, which is the drift the SCET arm exists to
       * remove.
       *
       * So this arm is LATCHED from outside, the same shape the `event` arm
       * uses: the fire notice off `alarm.scet.fired` sets `matchSinceUT`, and
       * from there the ordinary two-second banner window runs.
       */
      if (alarm.state === "fired") return "fired";
      if (alarm.matchSinceUT == null) return "pending";
      return now - alarm.matchSinceUT < 2 ? "firing" : "fired";
    }
    if (alarm.trigger.kind === "time") {
      const { ut, leadSeconds } = alarm.trigger;
      // Crossed the moment since the last evaluation, however far the clock
      // jumped: this tick is the one that owes the operator the banner.
      const crossed = previously !== null && previously < ut && now >= ut;
      if (crossed) return "firing";
      if (now >= ut && now - ut < 2) return "firing";
      if (now >= ut) return "fired";
      if (ut - now <= leadSeconds) return "arming";
      return "pending";
    }
    if (alarm.trigger.kind === "event") {
      /*
       * Edge-triggered: no arming, no sustain. Fire the instant a matching
       * occurrence latched `matchSinceUT`, hold `firing` for the standard 2s
       * banner window, then settle to `fired`.
       *
       * This containment test needs no crossing companion, and the reason is
       * the latch UT rather than the window: `updateEventTracking` sets
       * `matchSinceUT` to the REVEAL UT, which is the same tick that derives
       * here, so the difference is zero however far a warp step moved the
       * clock. It is the one arm a jump cannot step over. Move the latch to
       * the occurrence's own `ut` and that stops being true.
       */
      if (alarm.state === "fired") return "fired";
      if (alarm.matchSinceUT == null) return "pending";
      return now - alarm.matchSinceUT < 2 ? "firing" : "fired";
    }
    if (alarm.state === "fired") return "fired";
    // Threshold and contract-parameter both use the matchSinceUT +
    // sustainSeconds shape; the underlying match check differs but the
    // state transition logic is identical.
    const t = alarm.trigger;
    if (alarm.matchSinceUT == null) return "pending";
    /*
     * The moment this alarm comes due, as an instant rather than a duration,
     * so the same crossing test the time arm uses applies here too. Under warp
     * one tick can move `heldFor` from 0 to thousands, clean over both the
     * sustain window and the 2-second firing window that follows it, and the
     * alarm reached `fired` without ever passing through `firing`: no banner,
     * no tone, no peer broadcast, no `onFire` action group, no warp step-down.
     */
    const dueAt = alarm.matchSinceUT + t.sustainSeconds;
    if (previously !== null && previously < dueAt && now >= dueAt) {
      return "firing";
    }
    if (now < dueAt) return "pending";
    if (now - dueAt < 2) return "firing";
    return "fired";
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
        /* A SCET instant is on the craft's clock and `ut` is on the view
           clock, so the light-time comes off it: the mod will stop the warp
           when the GAME reaches `ut - lead`, which the operator's screen
           reaches one light-time earlier. */
        const vantageOffset = isScetTrigger(a.trigger)
          ? safeOwltSeconds(this.getOwltSeconds())
          : 0;
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
      /* A SCET threshold is not warp-targetable either, for a different
         reason: there IS a scalar, but the mod is watching it and will stop the
         warp on its own. A ladder aimed at it would be planning against
         readings a light-time behind the comparison that decides it. */
      if (isScetTrigger(a.trigger)) continue;
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
      /* Never a SCET threshold. This caps the warp so an unmodelable alarm has
         ticks to register in, and a mod-owned one needs none: the stop happens
         upstream of everything this side can see, at whatever rate the game is
         running. */
      if (isScetTrigger(a.trigger)) return false;
      if (a.matchSinceUT != null) return false;
      const t = a.trigger;
      if (t.op === "==" || t.op === "!=") return true;
      return this.estimateThresholdEta(a) === null;
    });
  }

  /**
   * Three answers, not two: the condition holds, the condition does not hold,
   * or `null` for a read we could not make at all.
   *
   * `getValue` answers `undefined` for four different situations, and its own
   * doc hands the surface that stored the key the job of telling them apart:
   * nothing has arrived on the topic yet, the value is currently absent or
   * non-finite, the link is down, or the saved `dataKey` names a subject that
   * no longer resolves. Collapsing all four into `false` published a failed
   * read as the confident fact "the condition is not met", which is what let a
   * dropout clear a sustain latch.
   */
  private evalThreshold(t: ThresholdTrigger): boolean | null {
    const observed = this.readTelemetryNumber(t.dataKey);
    if (observed === null) return null;
    return compare(observed, t.op, t.value);
  }

  /**
   * Three answers, not two, for the same reason `evalThreshold` gives them.
   *
   * `getContractsActive` answers a non-array whenever nothing has arrived on
   * `contracts.active` yet or the link is down, and that is a different claim
   * from an EMPTY list: empty says the contract is no longer active, non-array
   * says nobody could ask. Both used to come back `false`, which published a
   * failed read as the confident fact "the condition just ended" and cleared
   * the sustain latch.
   *
   * The same distinction applies one level down, to a contract record that
   * arrives carrying no `parameters` array: the record is half-formed, so
   * nothing in it can be compared and `null` is the only honest answer. EMPTY
   * stays a real answer at both levels, an empty active list and an empty
   * objective list each mean the condition does not hold.
   */
  private evalContractParameter(t: ContractParameterTrigger): boolean | null {
    const active = this.getContracts();
    if (!Array.isArray(active)) return null;
    for (const c of active) {
      if (!c || typeof c !== "object") continue;
      // `CareerContract.id` is a wire string; `ContractParameterTrigger
      // .contractId` predates any real contract-id picker UI and is still
      // `number` (see `types.ts`): compare as strings rather than widen
      // the trigger's own persisted shape here.
      if (c.id !== String(t.contractId)) continue;
      /*
       * The contract is here and its objectives are not, which is the same
       * failed read the non-array list above answers `null` for, one level
       * down: a record that arrived truncated or malformed. Answering `false`
       * published "the objective is no longer complete" about a record nobody
       * could read, and cleared the sustain latch on it. An EMPTY `parameters`
       * array is a different claim and still falls through to the `false`
       * below, exactly as an empty active list does.
       */
      if (!Array.isArray(c.parameters)) return null;
      for (const p of c.parameters) {
        if (!p || typeof p !== "object") continue;
        if (p.title !== t.parameterTitle) continue;
        // Ordinal on both sides. `p.state` is KSP's `ParameterState` NAME, and
        // comparing it to the trigger's persisted word meant an alarm the
        // operator armed on "Complete" silently never fired if KSP ever renamed
        // the member: no throw, no warning, just an alarm that does not go off,
        // which is the worst thing an alarm can do. `targetState` stays a word
        // because it lives in the operator's saved alarms and is OUR vocabulary,
        // so it is mapped to an ordinal here rather than migrated on disk.
        const target = TARGET_STATE_ORDINAL[t.targetState];
        const observed = p.stateOrdinal;
        if (typeof observed !== "number") return false;
        return observed === target;
      }
      return false;
    }
    return false;
  }

  /**
   * The earliest revealed occurrence on the trigger's topic that happened
   * strictly after the watch baseline and by the current observed UT, matching
   * the optional `eventKind` filter, or `null` for none. The reader returns
   * already-revealed occurrences newest-last (delay + connectivity applied
   * upstream); the `fromUt`/`nowUt` bounds gate the watch window.
   *
   * It returned a bare boolean, which threw away `o.ut`: the occurrence was in
   * hand and the one fact an operator wants from an event alarm, when it
   * happened, was dropped at the only point it was available.
   */
  private findEventMatch(
    t: EventTrigger,
    fromUt: number,
    nowUt: number,
  ): EventOccurrence | null {
    for (const o of this.getRevealedEvents(t.topic)) {
      if (o.ut <= fromUt || o.ut > nowUt) continue;
      if (t.eventKind != null && o.kind !== t.eventKind) continue;
      return o;
    }
    return null;
  }

  private recordThresholdSample(alarm: Alarm, ut: number): void {
    if (alarm.trigger.kind !== "threshold") return;
    /* Samples exist to fit an ETA for the warp-to ladder, and a SCET threshold
       has no use for one: the mod stops the warp itself, in the frame it
       decides to, so a ladder planned from delayed samples would only be a
       second authority arriving late. */
    if (isScetTrigger(alarm.trigger)) return;
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
    /* See `recordThresholdSample`: no samples are kept for a SCET threshold, so
       this would answer null anyway. Said here as well, because a reader
       deciding whether a warp-to can target one should not have to trace it
       through an empty buffer. */
    if (isScetTrigger(alarm.trigger)) return null;
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
    const v = getValue("data", key);
    return v === undefined ? null : v;
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
