import { magnitudeOf } from "@ksp-gonogo/ui-kit";

/**
 * Reading a wire field as a number, for all three Breaking Ground widgets.
 *
 * Lives here rather than in each widget because the same helper was
 * copy-pasted into `RoboticsConsole`, `RotorTachometer` and `DeployedScience`,
 * and two of those copies defaulted a withheld reading to `0`. It cannot live
 * in `ui-kit` or `sitrep-sdk`: {@link magnitudeOf} is already published there
 * and owns the actual rule. What is left is reaching a `Quantityish` out of an
 * `unknown` off the wire, which belongs to the Uplink that parses the wire.
 */

/**
 * The magnitude, or `null` for anything the mod withheld.
 *
 * Takes a `Value` as well as a bare number: a declared quantity arrives
 * wrapped from the decode, and a `typeof === "number"` test answers "no
 * reading" for every one of them, which is silent and total.
 *
 * The narrowing is written out rather than asserted with an `as`, and the
 * finiteness rule is still {@link magnitudeOf}'s: a local copy of that rule is
 * how two spine files came to disagree about whether absence is `null` or
 * `NaN`, and a `NaN` is the one substitution no consumer's `??` catches.
 */
export function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return magnitudeOf(v);
  if (typeof v === "object" && v !== null && "magnitude" in v) {
    const { magnitude } = v;
    return typeof magnitude === "number" ? magnitudeOf({ magnitude }) : null;
  }
  return null;
}

/**
 * The magnitude, or `fallback`. The fallback is REQUIRED: the whole defect
 * behind this module was a `fallback = 0` default that no call site had to
 * write down, so six withheld readings became zeros that the operator read as
 * "stopped", "empty" and "at target", and two steppers then commanded from
 * them. A caller that cannot name a safe substitute wants {@link numOrNull}.
 */
export function num(v: unknown, fallback: number): number {
  return numOrNull(v) ?? fallback;
}
