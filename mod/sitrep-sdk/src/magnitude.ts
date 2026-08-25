/**
 * Taking a quantity's magnitude, at the places where a caller genuinely has to.
 *
 * ## When this is right
 *
 * Code that draws or computes. SVG attributes take numbers; a Kepler solver, a
 * median filter and a rolling window all take numbers; a model that predates
 * the unit system and is shared with code that does the above takes numbers.
 * Those boundaries are real, and one funnel through them is better than
 * `.magnitude` sprinkled at every use.
 *
 * ## When this is WRONG
 *
 * Showing the value. `<Unit value={x} />` is how a quantity is displayed, and
 * reaching for a magnitude to build a string is how a dashboard ends up with
 * six spellings of "m/s" and one readout quietly showing kilometres under a
 * metres label. If the number is going on screen, this is not the function you
 * want.
 *
 * The narrow `{ magnitude: number }` parameter rather than `Value<U>` is
 * deliberate: it accepts a plain number too, which is what the app's own
 * derived models still carry, so a caller does not have to know which side of
 * the migration a given field is on. It is REQUIRED rather than optional for a
 * reason worth keeping: with `magnitude?: number` any object at all satisfies
 * the parameter, and a diverged copy that made it optional is how a test came
 * to hand a widget a `Reading` where a payload belonged and typecheck.
 *
 * ## Why it lives HERE
 *
 * With `Value`, which is what it unwraps. It sat in ui-kit until 2026-08-25,
 * which reads sensibly (ui-kit is published, so a third-party Uplink can import
 * it) and had one consequence nobody wrote down: **ui-kit depends on this
 * package**, so nothing in `sitrep-sdk` could reach the canonical unwrap
 * without a cycle. Two spine files therefore carried their own, and the two
 * disagreed about absence, one answering `NaN` and one throwing. One of those
 * was a live defect: four `VesselState` fields declared `number | null`
 * answered `NaN` on a partial frame, which no consumer's `??` catches, so every
 * threshold compared against them silently stopped firing.
 *
 * `@ksp-gonogo/ui-kit` re-exports all three names, so no call site changed in
 * the move and an Uplink author still reaches them from the package they
 * already import.
 */
export type Quantityish = { magnitude: number } | number | null | undefined;

/** The magnitude, or `null` for anything absent or non-finite. */
export function magnitudeOf(v: Quantityish): number | null {
  const n = typeof v === "object" && v !== null ? v.magnitude : v;
  return n === null || n === undefined || !Number.isFinite(n) ? null : n;
}

/** The magnitude, or `fallback` when there is nothing usable to take. */
export function magnitudeOr(v: Quantityish, fallback: number): number {
  return magnitudeOf(v) ?? fallback;
}
