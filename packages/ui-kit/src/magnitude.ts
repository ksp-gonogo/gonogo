/**
 * Taking a quantity's magnitude, at the places where a widget genuinely has to.
 *
 * ## When this is right
 *
 * A widget that draws or computes. SVG attributes take numbers; a Kepler
 * solver, a median filter and a rolling window all take numbers; a model that
 * predates the unit system and is shared with code that does the above takes
 * numbers. Those boundaries are real, and one funnel through them is better
 * than `.magnitude` sprinkled at every use.
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
 * the migration a given field is on.
 *
 * Lives in ui-kit (not `@ksp-gonogo/components`) because it is a genuinely
 * generic numeric primitive with no dependency on the built-in widget
 * library: any Uplink client widget that draws or computes needs the same
 * funnel, and ui-kit is the published package a third-party Uplink can
 * import. `@ksp-gonogo/components`'s own `shared/magnitude.ts` re-exports
 * this rather than carrying a second copy.
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
