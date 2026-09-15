import type {
  ModelledField,
  TopicPayload,
  TopicReading,
  TopicReckoningAvailable,
  UncertaintyBand,
  Value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  bandFor,
  bandIn,
  readingOf,
  topicReading,
} from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf } from "@ksp-gonogo/ui-kit";
// Side-effect: registers the model whose interval this module exists to carry.
// A module that reads bands and can load without the thing that mints them
// hands every meter a bandless reading and reports success, which is the one
// failure mode here nothing else would catch. `index.ts` loads it too, for the
// declaration-emit reason its own header gives; this one is about not being
// loadable in a state that carries nothing.
import "../crewReckoning";
import { KERBALISM_CREW_TOPIC } from "../topics";
import { KERBALISM } from "../uplink";
import { onFatalAxis, ruleFraction } from "./processor";

// ---------------------------------------------------------------------------
// Each survival rule's 0..1 figure AS A READING: how current it is, and how
// well the crew model knows it.
//
// This was an augment. `crewReckoning.ts` is the one model in this tree that
// mints a real uncertainty interval, and `CrewSurvival`'s Processor flattens
// each rule to a bare `fraction`, which has nowhere to put the second end. So
// the interval used to be drawn as TEXT on the roster row, beside a meter that
// was already drawing the number it bounds, and the operator rejected that
// picture twice.
//
// `Meter` now takes a whole `Reading` and draws the band itself, one mark per
// bound on the track the bar is already on, so the second end has somewhere to
// go that is not a second row. What was missing between the model and the
// meter is this: a contribution is handed its Topic deps as PAYLOADS and never
// as readings (`DepValue` in the sdk says so), so nothing downstream of the
// Processor could see a reckoning at all.
//
// ## Why a Processor may hand back a `Reading` here
//
// `ReadingDep`'s own doc says a Processor should not return one, and gives the
// reason: a `Reading` is ONE Topic's currency, and a conclusion drawn across
// several is not any single Topic's anything. That is the test, and this is
// inside it. Every figure here is one field of `kerbalism.crew` divided by
// another field of the same rule of the same Topic, so its currency and its
// model are exactly that Topic's. Nothing from `vessel.crew` reaches these
// numbers; the roster only supplies names, and it does that next door.
// ---------------------------------------------------------------------------

type Crew = TopicPayload<typeof KERBALISM_CREW_TOPIC>;

/**
 * Every rule the Kerbalism wire reports, keyed by {@link ruleKey}.
 *
 * Sparse: a rule with nothing to place on the toward-fatal axis is absent
 * rather than present with a zero, for the reason `ruleFraction` returns null
 * instead of 0. Zero on that axis is the reading that says the crew is fine.
 *
 * A plain record and never a `Map`, because a Processor result is DATA: the
 * evaluator's notify guard compares one frame's answer against the last by
 * walking own enumerable keys, and a `Map` hides its entries behind methods,
 * so every consumer would be woken on every frame with nothing able to notice.
 * `PROCESSOR_UNCOMPARABLE_BUDGET` fails the suite over it, and did over this.
 */
export type RuleReadings = Readonly<Record<string, TopicReading<number>>>;

/**
 * How a rule is addressed across this folder: the kerbal it is about, then the
 * rule's own wire name.
 *
 * One spelling, exported, because the same string is both a meter's id and the
 * key this map is read back by, and two copies of it would drift into a lookup
 * that quietly finds nothing and falls back to a bare number.
 */
export function ruleKey(kerbalName: string, ruleName: string): string {
  return `${kerbalName}:${ruleName}`;
}

/**
 * The whole derivation, pure, so a test drives it against a real reading off a
 * live stream without reaching the Processor registry.
 *
 * Keyed by NAME rather than by wire position, because position is what the
 * consumer does not have: the Processor sorts each kerbal's rules worst-first
 * and drops the ones it cannot place, so its indices are not the wire's. Two
 * kerbals sharing a name (legal in KSP) resolve to the first seat, which is
 * the ambiguity the meter ids already carry.
 */
export function ruleReadings(reading: TopicReading<Crew>): RuleReadings {
  const readings: Record<string, TopicReading<number>> = {};
  const observed =
    reading.state === "observed" || reading.state === "stale"
      ? reading.value
      : undefined;
  if (!observed) return readings;
  observed.forEach((entry, kerbal) => {
    entry.rules?.forEach((rule, index) => {
      const fraction = ruleFraction(rule);
      const threshold = rule.fatalThreshold;
      if (fraction === null || threshold === undefined) return;
      if (entry.name == null || rule.name == null) return;
      const key = ruleKey(entry.name, rule.name);
      if (Object.hasOwn(readings, key)) return;
      readings[key] = fractionReading(
        reading,
        fraction,
        kerbal,
        index,
        threshold,
      );
    });
  });
  return readings;
}

/**
 * One rule's figure, on the arm the whole payload arrived on, carrying the
 * model only where the model spoke about this rule.
 *
 * `readingOf` for the arms, since the five of them are the part that gets
 * written wrongly and the sdk already enumerates them. It drops the model by
 * design, which is the right answer for every rule the model did not move: a
 * reckoning kept through a selector would claim a model for a number nobody
 * modelled. What is added back, deliberately and in one place, is the model
 * for the rule it IS about.
 */
function fractionReading(
  reading: TopicReading<Crew>,
  observedFraction: number,
  kerbal: number,
  index: number,
  threshold: Value<"units">,
): TopicReading<number> {
  const base = readingOf(reading, () => observedFraction);
  if (reading.reckoning.status !== "available") return base;
  const path = `${kerbal}.rules.${index}.value`;
  // The model's own path vocabulary, read back verbatim: `crewReckoning.ts`
  // keys both `modelled` and `bands` by this string, dotted from the payload
  // root. A rule missing from `modelled` is one the model copied rather than
  // carried, and claiming a basis for it would be a modelled label over an
  // observation.
  const moved = reading.reckoning.modelled.find((field) => field.path === path);
  if (!moved) return base;
  const reckoned = fractionReckoning(
    reading.reckoning,
    moved,
    kerbal,
    index,
    threshold,
  );
  if (base.state === "observed") {
    return topicReading({
      state: "observed",
      reckoning: reckoned,
      value: base.value,
      atUt: base.atUt,
    });
  }
  if (base.state === "stale") {
    return topicReading({
      state: "stale",
      reckoning: reckoned,
      value: base.value,
      asOfUt: base.asOfUt,
      grade: base.grade,
    });
  }
  return base;
}

/**
 * The crew model's answer for one rule, re-expressed on the axis the bar is
 * drawn on.
 *
 * The model works in the accumulator's own units and the meter is a fraction
 * of that rule's fatal threshold, so the interval has to be divided by the
 * same number the figure was. `MeterEntry.value`'s own doc states the rule
 * this satisfies: a model that bands the underlying quantity has to say so as
 * a fraction of the same axis, or the meter has nothing to place. Handing the
 * interval over in units would not draw it fifty times too wide; `bandIn`
 * would refuse the unit and the marks would silently never appear.
 */
function fractionReckoning(
  reckoned: TopicReckoningAvailable<Crew>,
  moved: ModelledField,
  kerbal: number,
  index: number,
  threshold: Value<"units">,
): TopicReckoningAvailable<number> {
  const path = `${kerbal}.rules.${index}.value`;
  const carried = reckoned.value[kerbal]?.rules?.[index]?.value;
  const band = bandIn(bandFor(reckoned, path), "units");
  return {
    status: "available",
    value:
      carried === undefined || magnitudeOf(carried) === null
        ? 0
        : (magnitudeOf(onFatalAxis(carried, threshold)) ?? 0),
    atUt: reckoned.atUt,
    // The basis of the entry covering THIS rule, not the one covering the
    // root: the two agree in this model and nothing makes them.
    basis: moved.basis,
    // The root, because this reading IS the one figure. The path the crew
    // model keys by names a field of a roster, and a consumer holding a lone
    // fraction has no roster to walk.
    modelled: [{ path: "", basis: moved.basis }],
    owner: reckoned.owner,
    bands: band === undefined ? undefined : { "": onAxis(band, threshold) },
  };
}

/** One interval, moved onto the 0..1 toward-fatal axis end by end, through the
 *  same division the figure it bounds went through. Ordering survives because
 *  the clamp is monotonic, so the ends still bracket the value and
 *  `bandIsWellFormed` still holds. */
function onAxis(
  band: UncertaintyBand<"units">,
  threshold: Value<"units">,
): UncertaintyBand<"ratio"> {
  return {
    value: onFatalAxis(band.value, threshold),
    lo: onFatalAxis(band.lo, threshold),
    hi: onFatalAxis(band.hi, threshold),
    kind: band.kind,
  };
}

/**
 * `kerbalism:crew-rule-readings`. The owner-stamped Processor handle: import
 * it to consume the derivation, never re-declare it.
 */
export const CREW_RULE_READINGS = KERBALISM.registerProcessor({
  id: "crew-rule-readings",
  // A READING, not the payload, and the only dep: the reckoning is the whole
  // subject here, and a contribution cannot ask for one itself.
  deps: [{ reading: KERBALISM_CREW_TOPIC }] as const,
  compute: ([reading]: readonly [TopicReading<Crew>]): RuleReadings =>
    ruleReadings(reading),
});
