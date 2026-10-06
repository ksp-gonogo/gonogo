/**
 * Anything {@link magnitudeOf} accepts: a quantity such as a `Value`, a plain
 * number, `null` or `undefined`.
 *
 * Take a magnitude only to compute or draw with a number, such as an SVG
 * coordinate or an orbit calculation. To show a quantity, pass it whole to
 * `<Unit>`, which formats it in its own unit.
 *
 * @category Units and values
 */
// `magnitude` is required, not optional: an optional one lets any object at all through, a Reading included.
export type Quantityish = { magnitude: number } | number | null | undefined;

/**
 * Returns the number inside a quantity, or `null` when it is absent or not
 * finite. A plain number is returned as it is.
 *
 * @category Units and values
 */
export function magnitudeOf(v: Quantityish): number | null {
  const n = typeof v === "object" && v !== null ? v.magnitude : v;
  return n === null || n === undefined || !Number.isFinite(n) ? null : n;
}

/**
 * Returns the number inside a quantity, or `fallback` when it is absent or
 * not finite. Only for a calculation that needs a number either way: to show a
 * missing value, show it as missing rather than as `fallback`.
 *
 * @category Units and values
 */
export function magnitudeOr(v: Quantityish, fallback: number): number {
  return magnitudeOf(v) ?? fallback;
}

/**
 * Returns `value` as a {@link Quantityish} when it is one, and `undefined` when
 * it is not, such as a string where a number was expected. Use it on data
 * whose type is not known before passing it to {@link magnitudeOf}.
 *
 * @category Units and values
 */
export function asQuantityish(value: unknown): Quantityish {
  if (value === null || value === undefined || typeof value === "number") {
    return value;
  }
  if (typeof value !== "object") return undefined;
  const magnitude: unknown = Reflect.get(value, "magnitude");
  return typeof magnitude === "number"
    ? (value as { magnitude: number })
    : undefined;
}
