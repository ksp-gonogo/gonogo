import type { HeldGrade, Reading, ReadingState, Reckoning } from "./reading";
import type { Value } from "./unit-system/value";

/**
 * Computes one value from several readings, and returns it as a
 * {@link Reading} with a state of its own.
 *
 * @example
 * ```ts
 * const target = useTelemetry("vessel.target");
 * const range = combineReadings([target.relativePosition], (position) =>
 *   vectorMagnitude(position),
 * );
 * ```
 *
 * ## State
 *
 * The result is as current as its least current input:
 *
 * - every input `"observed"` gives `"observed"`, at the oldest input's `atUt`
 * - any input `"held"` gives `"held"`, as of the oldest instant among the
 *   inputs
 * - an input in any other state, or carrying no value (`undefined` or `null`),
 *   gives that input's state with no value, and `compute` does not run. Where
 *   several inputs qualify, the first in argument order decides
 *
 * The forward model is combined separately from the state: two observed inputs
 * whose models both declined give an observed result with a declined
 * reckoning. The result never carries a band.
 *
 * ## No result
 *
 * `compute` may return `undefined` where the arithmetic has no answer, such as
 * the direction of a zero vector. The result then keeps the state and instant
 * its inputs gave it and carries no value.
 *
 * @category Reading telemetry
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

  // Past the guard every input is `observed` or `held` AND carries a value, so
  // each has one and an instant. The cast is that fact, not an assumption about
  // the caller.
  const values = inputs.map((input) => input.value) as ReadingValues<Inputs>;
  const oldest = oldestSpoken(inputs);
  const held = inputs.some((input) => input.state === "held");

  return {
    state: held ? "held" : "observed",
    value: compute(...values),
    ...(held ? { asOfUt: oldest.instant } : { atUt: oldest.instant }),
    ...(held && oldest.grade !== undefined ? { grade: oldest.grade } : {}),
    reckoning: combineReckonings(inputs, compute),
  };
}

/**
 * One input to {@link datedFrom}: its state, when it was observed, and why it
 * is held where it is.
 *
 * @category Reading telemetry
 */
export interface CarriedCurrency {
  readonly state: ReadingState;
  /** When the observation behind it was made, where it has one. */
  readonly instant: Value<"ut"> | undefined;
  readonly grade?: HeldGrade | undefined;
}

/**
 * Returns a value you have already computed as a {@link Reading}, dated by
 * the inputs it came from.
 *
 * Unlike {@link combineReadings}, it never withholds the value: use it when
 * your own code has already decided what a missing input means.
 *
 * Each input is passed as a {@link CarriedCurrency}. Read its `instant` with
 * {@link observedAt}, which covers a held reading's `asOfUt` as well as an
 * observed one's `atUt`.
 *
 * The result is `"held"` when any input that carries a value is held, and
 * `"observed"` otherwise, dated by the oldest instant among the inputs. Inputs
 * that carry no value are ignored. When none carries a value, the result is
 * `"observed"` with no instant. It never carries a forward model or a band.
 *
 * @category Reading telemetry
 */
export function datedFrom<Derived>(
  carriers: readonly CarriedCurrency[],
  value: Derived,
): Reading<Derived> {
  let instant: Value<"ut"> | undefined;
  let grade: HeldGrade | undefined;
  let held = false;
  for (const carrier of carriers) {
    if (!CARRIES_VALUE.has(carrier.state)) continue;
    if (carrier.state === "held") held = true;
    const spoken = carrier.instant;
    if (spoken === undefined) continue;
    if (instant === undefined || spoken.lessThan(instant)) {
      instant = spoken;
      grade = carrier.grade;
    }
  }
  return {
    state: held ? "held" : "observed",
    value,
    ...(held ? { asOfUt: instant } : { atUt: instant }),
    ...(held && grade !== undefined ? { grade } : {}),
    reckoning: { status: "none" },
  };
}

/**
 * The value types of a tuple of readings, in the same order.
 *
 * @category Reading telemetry
 */
export type ReadingValues<Inputs extends readonly Reading<unknown>[]> = {
  [Index in keyof Inputs]: Inputs[Index] extends Reading<infer Payload>
    ? Payload
    : never;
};

/** The two states on which a reading carries a value. */
const CARRIES_VALUE: ReadonlySet<ReadingState> = new Set<ReadingState>([
  "observed",
  "held",
]);

/**
 * The oldest instant any input speaks for, and the grade that explains it.
 *
 * The grade travels WITH the instant rather than being ranked across inputs,
 * because `HeldGrade` is not a severity ladder: its own doc calls the four
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
  grade: HeldGrade | undefined;
} {
  let instant: Value<"ut"> | undefined;
  let grade: HeldGrade | undefined;
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
  let atUt: Value<"ut"> | undefined;
  let beyondReceived = false;
  for (const input of inputs) {
    if (input.reckoning.status !== "available") return { status: "none" };
    if (
      input.reckoning.modelled === undefined ||
      input.reckoning.modelled === null
    )
      return { status: "none" };
    // Figures modelled for two different instants do not combine into one.
    if (atUt && !atUt.equals(input.reckoning.atUt)) return { status: "none" };
    atUt = input.reckoning.atUt;
    if (input.reckoning.beyondReceived) beyondReceived = true;
    modelled.push(input.reckoning.modelled);
  }
  if (!atUt) return { status: "none" };

  const combined = compute(...(modelled as ReadingValues<Inputs>));
  /* The arithmetic had no answer for the modelled figures, so there is no
     modelled figure to offer. Same rule the observation follows above, and it
     keeps `modelled` the required value its own type declares. */
  if (combined === undefined || combined === null) return { status: "none" };

  return {
    status: "available",
    modelled: combined,
    atUt,
    beyondReceived,
    basis: "combination",
  };
}
