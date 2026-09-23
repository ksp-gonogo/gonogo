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
  modOwnsLatch,
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
    /**
     * Whether the mod REFUSED to arm this alarm, and so will never latch it.
     *
     * The other half of {@link modOwnsLatch}, which says only that a kind is
     * mod-owned. An arm can be refused, for a vantage naming no place or a
     * Topic with no reading behind it, and an alarm whose kind says the mod
     * latches it while the mod has declined to hold it is one NOBODY latches:
     * it sits pending for ever, which reads exactly like a condition not yet
     * met.
     *
     * A REFUSAL rather than roster membership, and the difference is the whole
     * of why this is not the predicate the warp stop uses. The roster does not
     * contain an alarm that has merely not been armed YET, and a mod-owned
     * alarm latched during that window leaves `pending`, and out of `pending`
     * the arm reconciles only an alarm still owed one: it would then never be
     * armed, so never held, so never latched by anybody. A refusal is the mod
     * having actually answered.
     *
     * Defaults to "nothing was refused", which defers to a mod that may not
     * exist. That is safe because an alarm of a mod-owned kind on a client with
     * no stream is one the operator cannot be served by either evaluator, and
     * silently latching it here would claim otherwise.
     */
    private readonly modRefused: (alarm: Alarm) => boolean = () => false,
  ) {}

  /**
   * Whether this side must leave the latch alone: the kind is mod-owned and the
   * mod has not refused it.
   */
  private latchedElsewhere(alarm: Alarm): boolean {
    return modOwnsLatch(alarm.trigger) && !this.modRefused(alarm);
  }

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
    if (this.latchedElsewhere(alarm)) return false;
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
   * reveals long after it happened, and the banner window runs from the moment
   * the operator could first have known). Once latched it never
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
   * Level, not edge: an alarm that is due and has not yet fired goes to
   * `firing` on whichever evaluation first finds it due, however far past the
   * due moment that is. The host ticks at 1 Hz while the view clock runs at
   * the warp rate, a reload can open long after an alarm came due, and an edit
   * can make a held condition due at once, so "due within the last two
   * seconds" is a window any of them steps clean over. `firing` settles to
   * `fired` on a later evaluation two seconds past the due moment, so the
   * banner window always lasts at least one evaluation, and neither state
   * falls back to `pending` while the trigger stands.
   */
  deriveState(
    alarm: Alarm,
    now: number | null = this.getObservedUT(),
  ): Alarm["state"] {
    if (now === null) return "pending";
    const trigger = alarm.trigger;
    if (trigger.kind === "time" && !this.latchedElsewhere(alarm)) {
      // The one arm that can move BACK out of a fire: an edit to a later
      // instant is a new alarm as far as the operator is concerned.
      if (now < trigger.ut) {
        return trigger.ut - now <= trigger.leadSeconds ? "arming" : "pending";
      }
      return settleFire(alarm.state, now, trigger.ut);
    }
    const dueAt = this.dueAt(alarm);
    if (alarm.state === "firing" || alarm.state === "fired") {
      return settleFire(alarm.state, now, dueAt);
    }
    if (dueAt === null || now < dueAt) return "pending";
    return "firing";
  }

  /**
   * The instant a latched alarm came due, or `null` while nothing has latched.
   *
   * An alarm the mod latches, and an `event` alarm, are due AT the latch: the
   * mod has already waited out any sustain before its notice arrives, and an
   * occurrence has no sustain. Comparing a mod-owned instant against the view
   * clock here instead would fire a light-time after the mod already stopped
   * the warp, which is the drift the SCET arm exists to remove. Threshold and
   * contract-parameter alarms evaluated on this side come due once the match
   * has held for `sustainSeconds`.
   */
  private dueAt(alarm: Alarm): number | null {
    if (alarm.matchSinceUT == null) return null;
    const t = alarm.trigger;
    if (
      this.latchedElsewhere(alarm) ||
      t.kind === "event" ||
      t.kind === "time"
    ) {
      return alarm.matchSinceUT;
    }
    return alarm.matchSinceUT + t.sustainSeconds;
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
   * says nobody could ask.
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

/**
 * The next state of an alarm that is due. One that has not fired yet fires
 * now; one already firing holds the two-second banner window from the due
 * moment, and settles to `fired` without it where the moment is gone.
 */
function settleFire(
  state: Alarm["state"],
  now: number,
  dueAt: number | null,
): Alarm["state"] {
  if (state === "fired") return "fired";
  if (state !== "firing") return "firing";
  return dueAt !== null && now - dueAt < 2 ? "firing" : "fired";
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
