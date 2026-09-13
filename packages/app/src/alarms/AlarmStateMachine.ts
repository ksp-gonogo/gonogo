import {
  type EventOccurrence,
  getContractsActive,
} from "@ksp-gonogo/sitrep-client";
import type { CareerContract } from "@ksp-gonogo/sitrep-sdk";
import { KspParameterState } from "@ksp-gonogo/sitrep-sdk";
import { readThresholdTelemetryNumber } from "./AlarmWarpPlanner";
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
 * Reader for the revealed occurrences on an event topic, the seam the
 * `event` trigger consumes. Returns occurrences already past the reveal gate
 * (delay + connectivity), newest-last; see `EventTimeline.revealed`. Defaults
 * to empty on the host until a producer topic is wired.
 */
export type RevealedEventsReader = (
  topic: string,
) => readonly EventOccurrence[];

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

/**
 * Owns the per-tick alarm state derivation: contiguous-match tracking for
 * threshold, contract-parameter and event triggers, and the `deriveState`
 * transition that reads the latches they write.
 *
 * The warp-to ladder's ETA planner is NOT here, it is `AlarmWarpPlanner`. The
 * two were one class and have different futures: deciding whether a condition
 * holds belongs to the simulation, which reads it undelayed, while deciding how
 * far to warp is fitted to the delayed samples this screen has and stays
 * client-side. The planner's sampling is driven from the host tick rather than
 * from here, so it survives this class being deleted.
 *
 * Every method here takes the one alarm it works on, so the alarm ARRAY is no
 * longer a dependency: the planner took the last reader of it out with the
 * queries. `observedUT` stays a getter callback, owned by the host, so this
 * never holds a stale copy. Threshold
 * `dataKey` reads and the contract-parameter trigger's `contracts.active`
 * read both come off the stream now (`readThresholdTelemetryNumber` over
 * `getValue`, and `getContractsActive`) rather than the legacy `"data"`
 * `DataSource`,
 * `DataKeyPicker`'s Value restriction (`useValueKeys`) guarantees a
 * `ThresholdTrigger.dataKey` always has a stream home.
 */
export class AlarmStateMachine {
  /**
   * Per-event-alarm watch baseline: the observed UT at which the alarm first
   * ticked. Only occurrences revealed after this fire, so an alarm never
   * replays an event already in the buffer when it's created. Not persisted,
   * a reload restarts the watch from the reload UT (old events don't re-fire;
   * an already-latched `matchSinceUT` still keeps the alarm fired).
   */
  private eventWatchFrom = new Map<string, number>();

  constructor(
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
  ) {}

  /**
   * Update threshold-match state for one alarm. Mutates
   * `alarm.matchSinceUT`. Returns true if `matchSinceUT` changed.
   *
   * `previously` is the UT of the last tick, and it is what lets an
   * UNREADABLE read be held apart from a read that says no: see
   * `evalThreshold`. Pass `null` where there is no previous tick, and an
   * unreadable read simply leaves the latch untouched.
   *
   * IMPORTANT: must run *before* `deriveState` for the same tick, and before
   * `AlarmWarpPlanner.recordThresholdSample`, which reads the latch written
   * here.
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
    return changed;
  }

  /**
   * Update contract-parameter match state. Same shape as
   * `updateThresholdTracking`, over a discrete state match rather than a
   * numeric one, so nothing here feeds the warp-to ETA planner (there is no
   * scalar to fit). Mutates `alarm.matchSinceUT`; returns true iff it changed.
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

  /**
   * Drop per-alarm tracking state: used on delete or trigger change. The
   * warp-to sample buffer is `AlarmWarpPlanner.forget`, and the host calls both.
   */
  forget(alarmId: string): void {
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
    const observed = readThresholdTelemetryNumber(t.dataKey);
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
