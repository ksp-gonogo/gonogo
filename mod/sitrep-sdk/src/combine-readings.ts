import type { Reading, ReadingState, Reckoning, StaleGrade } from "./reading";
import type { Value } from "./unit-system/value";

/**
 * Compute one value from several readings, and give the result an honest
 * currency of its own.
 *
 * A widget that divides, adds or takes a magnitude of published numbers has
 * always had a third number with no currency at all. The range to a target,
 * worked out from a relative-position vector, is a distance nobody observed:
 * nothing on it says how current it is or whether a model stands behind it.
 * This is where such a number gets both.
 *
 * ```ts
 * const range = combineReadings([relativePosition], (p) =>
 *   value("m", Math.hypot(p.x, p.y, p.z)),
 * );
 * ```
 *
 * ## The rule: as current as its least current input
 *
 * Readings in one frame are resolved against ONE view time, so they are
 * contemporaneous by construction rather than by luck. That is what licenses
 * combining them at all, and it is worth being precise about what it licenses:
 * it says the inputs are about the same instant, NOT that their errors are
 * independent. Only the second would justify combining their intervals, which
 * is why this carries no band (see below).
 *
 * - every input `observed` gives `observed`, stamped at the **oldest** `atUt`.
 *   A result cannot be fresher than the stalest thing it was computed from
 * - any input `stale` gives `stale`, as of the **oldest instant any input
 *   speaks for**
 * - any input `absent`, `pending` or `unowned` gives that state with no value,
 *   taking the **first such input in argument order**. There is no meaningful
 *   ranking between those three, so the rule is positional and written down
 *   rather than invented per call
 * - an input carrying **no value** gives its own state with no value, by the
 *   same positional rule, even where that state is `observed` or `stale`. A
 *   field reading projected off an OPTIONAL payload field the wire did not
 *   carry is `observed` with no value: the topic WAS observed and the field was
 *   simply not in it, so the state is right and there is still nothing to
 *   compute from. Passing the state through says exactly that, and avoids
 *   inventing the `atUt` an `absent` arm would need. It is the one shape the
 *   states alone get wrong, and it is the common one: a career reporting an
 *   upkeep and no subsidy crashed this function before the check existed,
 *   because the guard trusted `state` and handed `compute` an `undefined`
 * - **`null` counts as no value too**, because that is how the wire spells an
 *   absent field. `Sitrep.Contract` nulls a field whenever the raw value is
 *   absent or non-finite, so a projected field reading of one is `observed`
 *   with `null`, and a guard that only tested `undefined` let it through to
 *   `compute`: `vessel.target.relativePosition` is null off a target with no
 *   relative geometry, and that reached `bare()` and threw on `.x`
 *
 * ## The two axes stay separate, exactly as they do on a `Reading`
 *
 * State is decided by the inputs' states; the model is decided by the inputs'
 * models. A combination of two `observed` readings whose models both declined
 * is `observed` with a declined reckoning, and that is the same orthogonality
 * a `Reading` already has rather than a special case here.
 *
 * ## It carries NO band, deliberately
 *
 * Propagating an interval through arbitrary arithmetic is width arithmetic over
 * inputs whose errors this cannot know to be independent. A combination that
 * deserves a band deserves a model: publish one, and the band comes from the
 * mathematics that knows it.
 *
 * ## `compute` may answer `undefined`, and that is not the same as an absence
 *
 * Arithmetic has domains. A range rate needs a line of sight to project onto
 * and has none at zero separation; a unit vector of a zero vector does not
 * exist; an arccos outside [-1, 1] is not a number. Those cases have no answer
 * rather than a wrong one, and the result says so by carrying no value while
 * keeping the state and the instant its inputs earned: the inputs DID arrive,
 * so reporting `absent` would be a claim about the wire instead of about the
 * mathematics. `Reading`'s value is optional on every arm, which is what makes
 * this expressible without a cast, and `Unit` draws it as the null token.
 */
export function combineReadings<
  const Inputs extends readonly Reading<unknown>[],
  Result,
>(
  inputs: Inputs,
  compute: (...values: ReadingValues<Inputs>) => Result | undefined,
): Reading<Result> {
  const missing = inputs.find(
    (input) =>
      !CARRIES_VALUE.has(input.state) ||
      input.value === undefined ||
      input.value === null,
  );
  if (missing) {
    return { state: missing.state, reckoning: { status: "none" } };
  }

  // Past the guard every input is `observed` or `stale` AND carries a value, so
  // each has one and an instant. The cast is that fact, not an assumption about
  // the caller.
  const values = inputs.map((input) => input.value) as ReadingValues<Inputs>;
  const oldest = oldestSpoken(inputs);
  const stale = inputs.some((input) => input.state === "stale");

  return {
    state: stale ? "stale" : "observed",
    value: compute(...values),
    ...(stale ? { asOfUt: oldest.instant } : { atUt: oldest.instant }),
    ...(stale && oldest.grade !== undefined ? { grade: oldest.grade } : {}),
    reckoning: combineReckonings(inputs, compute),
  };
}

/** The value types of a tuple of readings, in the same order. */
export type ReadingValues<Inputs extends readonly Reading<unknown>[]> = {
  [K in keyof Inputs]: Inputs[K] extends Reading<infer V> ? V : never;
};

/** The two states on which a reading carries a value. */
const CARRIES_VALUE: ReadonlySet<ReadingState> = new Set<ReadingState>([
  "observed",
  "stale",
]);

/**
 * The oldest instant any input speaks for, and the grade that explains it.
 *
 * The grade travels WITH the instant rather than being ranked across inputs,
 * because `StaleGrade` is not a severity ladder: its own doc calls the four
 * different KINDS of missed update, and singles out `recorded` as exact for its
 * own `asOfUt`. There is no defensible "worse" between a dead transport and an
 * exact value taken out of contact, so nothing here invents one. The result is
 * as of one instant; the grade is why THAT instant is where it is.
 *
 * Where several inputs tie on the oldest instant, the grade is kept only if
 * they agree on it. Disagreement means the reason is not single, and saying so
 * by omission beats picking one arbitrarily and reading as though it were the
 * whole story.
 */
function oldestSpoken(inputs: readonly Reading<unknown>[]): {
  instant: Value<"ut"> | undefined;
  grade: StaleGrade | undefined;
} {
  let instant: Value<"ut"> | undefined;
  let grade: StaleGrade | undefined;
  let tied = false;

  for (const input of inputs) {
    const spoken = input.asOfUt ?? input.atUt;
    if (spoken === undefined) continue;
    if (instant === undefined || spoken.lessThan(instant)) {
      instant = spoken;
      grade = input.grade;
      tied = false;
      continue;
    }
    if (spoken.equals(instant) && input.grade !== grade) {
      tied = true;
    }
  }

  return { instant, grade: tied ? undefined : grade };
}

/**
 * The combination's model: available only where every input had one.
 *
 * A declined input declines the result and **names itself**, so an operator
 * reading the decline learns which input stopped it rather than that something
 * did. The first declining input in argument order is the one reported, the
 * same positional rule the absent states use.
 *
 * An `available` reckoning whose modelled value is MISSING is no model here,
 * for the reason the value guard above gives: a field projection covered by a
 * model can still find nothing at its path, and `compute` cannot be handed an
 * `undefined` to multiply.
 */
function combineReckonings<
  const Inputs extends readonly Reading<unknown>[],
  Result,
>(
  inputs: Inputs,
  compute: (...values: ReadingValues<Inputs>) => Result | undefined,
): Reckoning<Result> {
  const declined = inputs.find(
    (input) => input.reckoning.status === "declined",
  );
  if (declined && declined.reckoning.status === "declined") {
    return { status: "declined", declined: declined.reckoning.declined };
  }

  const modelled: unknown[] = [];
  for (const input of inputs) {
    if (input.reckoning.status !== "available") return { status: "none" };
    if (
      input.reckoning.modelled === undefined ||
      input.reckoning.modelled === null
    )
      return { status: "none" };
    modelled.push(input.reckoning.modelled);
  }

  const combined = compute(...(modelled as ReadingValues<Inputs>));
  /* The arithmetic had no answer for the modelled figures, so there is no
     modelled figure to offer. Same rule the observation follows above, and it
     keeps `modelled` the required value its own type declares. */
  if (combined === undefined || combined === null) return { status: "none" };

  return { status: "available", modelled: combined, basis: "combination" };
}
