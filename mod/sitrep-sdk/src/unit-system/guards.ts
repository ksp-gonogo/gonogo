import { lookupUnit } from "./registry";
import type { Value } from "./value";

/**
 * Narrowing a value whose unit the build could not see, by asking the runtime.
 *
 * `Value<UnknownUnit>` refuses all arithmetic, which is correct and is also a
 * dead end on its own: an Uplink that wants to compute anything needs a way
 * back to a concrete unit. This is that way, and the only one, deliberately.
 *
 * ## Why this is not the thing we refused to build
 *
 * Generating types from a mod's resource list was rejected because it claims
 * knowledge nobody has: a player switches Kerbalism profile and the generated
 * union is a lie that still compiles. This looks superficially similar, since
 * a literal symbol is written down, and it is the opposite:
 *
 * - A generated catalogue ASSERTS "these units exist" at build time.
 * - `unitGuard("Oxygen:u")` ASKS "is this one oxygen?" at runtime.
 *
 * If the profile has no oxygen, the guard returns false, the branch does not
 * run, and nothing is wrong. The assertion is verified rather than assumed,
 * which is what makes writing the literal honest. The widget declares an
 * interest and gets checked for it.
 *
 * ## Identity, not compatibility
 *
 * The check is on the TOKEN, so `unitGuard("kg")` does not match a value in
 * tonnes even though the two are addable. That is the right test for what this
 * is for, and it costs nothing: after narrowing to `Value<"kg">`,
 * `CombinableWith<"kg">` still admits `"t"`, so kilograms and tonnes go on
 * combining.
 *
 * Each operand needs its own proof. `isOxygen(a) && isOxygen(b)` is the
 * pattern, and the asymmetry is the point: narrowing one side and not the
 * other leaves them different types, so it still will not compile.
 */
export function unitGuard<const S extends string>(symbol: S) {
  return (candidate: Value): candidate is Value<S> => candidate.unit === symbol;
}

/**
 * Catches the one way {@link unitGuard} fails silently: a typo.
 *
 * A guard for a symbol that does not exist is always false. The branch never
 * runs, the widget renders nothing, and not one thing errors anywhere, which
 * is the worst shape a bug can take. `unitGuard("Oxgyen:u")` costs an
 * afternoon.
 *
 * **The SDK cannot check this for you, and that is not an oversight.** An
 * unregistered symbol is indistinguishable from a resource the player's
 * profile legitimately lacks. Warning on it would fire on correct code every
 * time somebody flies a profile without oxygen, and a warning that cries wolf
 * is worse than none.
 *
 * An UPLINK can tell the difference, because it knows what it registered.
 * Call this at module load, after registration, with the symbols your guards
 * use:
 *
 * ```ts
 * registerResourceUnits(discovered);
 * assertGuardsRegistered(["Oxygen:u", "Food:u"]);
 * ```
 *
 * Throws rather than warns: this can only fire on a symbol the caller both
 * guards on AND believes it registered, so it is a bug in the Uplink every
 * time, and a warning in a console nobody reads is how it survives to ship.
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
