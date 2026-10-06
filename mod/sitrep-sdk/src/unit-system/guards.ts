import { lookupUnit } from "./registry";
import type { Value } from "./value";

/**
 * Returns a type guard that checks whether a {@link Value} is in exactly
 * `symbol`, and narrows it to `Value<symbol>` when it is. Use it to compute
 * with a value whose unit is an {@link UnknownUnit}, such as a resource an
 * Uplink registers at runtime.
 *
 * The check is on the symbol alone, so a guard for `"kg"` does not match a
 * value in tonnes. After narrowing, the value combines with every unit of its
 * dimension as usual.
 *
 * Narrow each value separately: two values must both pass before they can be
 * combined.
 *
 * @example
 * ```ts
 * const isOxygen = unitGuard("Oxygen:u");
 *
 * function freeOxygen(stored: Value, capacity: Value) {
 *   if (!isOxygen(stored) || !isOxygen(capacity)) return undefined;
 *   return capacity.minus(stored);
 * }
 * ```
 *
 * @category Units and values
 */
export function unitGuard<const Unit extends string>(symbol: Unit) {
  return (candidate: Value): candidate is Value<Unit> =>
    candidate.unit === symbol;
}

/**
 * Returns whether `candidate` is in exactly `unit`, and narrows it to
 * `Value<unit>` when it is. The same check as {@link unitGuard}, for a unit
 * passed in as a parameter rather than written in the code.
 *
 * The check is on the symbol alone, so `isUnit(v, "kg")` is `false` for a
 * value in tonnes.
 *
 * @category Units and values
 */
export function isUnit<Unit extends string>(
  candidate: Value,
  unit: Unit,
): candidate is Value<Unit> {
  return candidate.unit === unit;
}

/**
 * Throws when any of `symbols` is not a registered unit. A guard from
 * {@link unitGuard} for a misspelt symbol is always `false` and raises no
 * error, so call this when your client package loads, after registering your
 * units, with every symbol your guards check.
 *
 * Gonogo cannot check this for you: an unregistered symbol looks the same as a
 * resource the player's game legitimately lacks.
 *
 * @example
 * ```ts
 * assertGuardsRegistered(["Oxygen:u", "Food:u"]);
 * ```
 *
 * @category Units and values
 */
export function assertGuardsRegistered(symbols: readonly string[]): void {
  const missing = symbols.filter((symbol) => lookupUnit(symbol) === undefined);
  if (missing.length === 0) {
    return;
  }
  throw new Error(
    `Guarded unit symbol(s) not registered: ${missing.join(", ")}. ` +
      "A guard for an unregistered symbol is always false, so the code behind " +
      "it never runs and nothing errors. Either register the unit before " +
      "calling this, or correct the spelling. If the symbol is genuinely " +
      "optional (a resource this profile may not have), leave it out of this " +
      "list rather than registering it to silence the check.",
  );
}
