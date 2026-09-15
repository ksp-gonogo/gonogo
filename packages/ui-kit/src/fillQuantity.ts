import type { Value } from "@ksp-gonogo/sitrep-sdk";

/**
 * How much there is, and what that is a fraction OF.
 *
 * Both halves are `Value<U>` of the same unit, which is the whole reason this
 * shape exists rather than a pre-divided number: a fill fraction is the one
 * place two quantities have to be the same kind, and a bare
 * `amount / capacity` at a call site is where nothing checks that they were.
 * The primitive divides them itself, so the division happens once, under a type
 * that refuses to cross dimensions.
 *
 * `ProgressBar`'s shape, and no longer `Meter`'s: a meter takes its two halves
 * as two props, so each can carry its own currency and its own band, which a
 * bundle has nowhere to put. This stays for the bar, where both halves are
 * plain numbers a build reports together and neither has a reading of its own.
 */
export interface FillQuantity<U extends string = string> {
  /** How much there is now. */
  amount: Value<U>;
  /** The full tank: what `amount` is read as a fraction of. */
  capacity: Value<U>;
}

/**
 * The pair, as the 0..1 a track is drawn from.
 *
 * `dividedBy` is what makes the two halves have to be the same kind: an amount
 * in kg over a capacity in litres does not typecheck, and the quotient of two
 * same-kind values is dimensionless by construction. The single `.magnitude`
 * is therefore on a number that has already stopped being a quantity, and it
 * is where a fraction leaves the algebra for the two numeric slots that cannot
 * hold a unit: a CSS width and an `aria-valuenow`.
 *
 * A capacity of zero is not a full tank and not an empty one, it is no tank:
 * `null` is the honest answer, the same one an unread pair gets.
 */
export function fillFraction<U extends string>(
  pair: FillQuantity<U> | null,
): number | null {
  if (pair === null) return null;
  if (!pair.capacity.isPositive()) return null;
  return pair.amount.dividedBy(pair.capacity).magnitude;
}
