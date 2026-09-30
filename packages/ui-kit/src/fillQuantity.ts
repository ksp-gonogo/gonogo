import type { Value } from "@ksp-gonogo/sitrep-sdk";

/**
 * How much there is, and what that is a fraction of, for {@link ProgressBar}. Both
 * halves share one unit, and the primitive divides them itself under a type
 * that refuses to cross dimensions.
 *
 * @category Unit
 */
export interface FillQuantity<Unit extends string = string> {
  /** How much there is now. */
  amount: Value<Unit>;
  /** The full tank: what `amount` is read as a fraction of. */
  capacity: Value<Unit>;
}

/**
 * The pair, as the 0..1 a track is drawn from. `dividedBy` makes the quotient
 * dimensionless. A capacity of zero is no tank at all, so it yields `null`.
 *
 * @category Unit
 */
export function fillFraction<Unit extends string>(
  pair: FillQuantity<Unit> | null,
): number | null {
  if (pair === null) return null;
  if (!pair.capacity.isPositive()) return null;
  return pair.amount.dividedBy(pair.capacity).magnitude;
}
