import type { Value } from "@ksp-gonogo/sitrep-sdk";
import { type FormatQuantityOptions, writeQuantity } from "./units";

/**
 * The precision a figure is drawn at, reduced to one test: whether two figures
 * come out as the same drawing.
 *
 * @category Unit
 */
export interface DrawnPrecision<Figure> {
  readsAsOne(a: Figure, b: Figure): boolean;
}

/**
 * Drawn as text: two figures are one where `write` gives them the same text.
 *
 * @category Unit
 */
export function writtenAs<Figure>(
  write: (figure: Figure) => string,
): DrawnPrecision<Figure> {
  return { readsAsOne: (a, b) => write(a) === write(b) };
}

/**
 * A quantity drawn as {@link writeQuantity} writes it, which is also how {@link Unit} draws it with the same options.
 *
 * @category Unit
 */
export function writtenQuantity<Unit extends string>(
  opts: FormatQuantityOptions = {},
): DrawnPrecision<Value<Unit>> {
  return writtenAs((quantity) => writeQuantity(quantity, opts));
}

/**
 * How far apart two positions on an instrument's scale sit, as a fraction of
 * the whole scale, before they read as two.
 *
 * One percent, the finest step a percentage readout writes.
 *
 * @category Unit
 */
export const SCALE_TOLERANCE = 0.01;

/**
 * Placed on an instrument's scale: each figure is a fraction of it, clamped to
 * it first, and two read as one within one percent of the scale. `wraps`
 * measures the short way round a scale whose ends meet.
 *
 * @category Unit
 */
export function placedOnScale({
  wraps = false,
}: {
  wraps?: boolean;
} = {}): DrawnPrecision<number> {
  const onScale = (at: number): number =>
    wraps ? at - Math.floor(at) : Math.min(1, Math.max(0, at));
  return {
    readsAsOne(a, b) {
      const apart = Math.abs(onScale(a) - onScale(b));
      return (wraps ? Math.min(apart, 1 - apart) : apart) <= SCALE_TOLERANCE;
    },
  };
}

/**
 * Whether a model's figure stands apart from the observation at the precision
 * both are drawn, so drawing it says something the observation beside it does
 * not. Several figures, such as a band's two ends, stand apart where any one
 * does. Beside no observation at all, every figure stands apart.
 *
 * @category Unit
 */
export function standsApart<Figure>(
  observed: Figure | null | undefined,
  modelled: Figure | readonly Figure[],
  precision: DrawnPrecision<Figure>,
): boolean {
  const figures: readonly Figure[] = Array.isArray(modelled)
    ? modelled
    : [modelled as Figure];
  if (observed === null || observed === undefined) return figures.length > 0;
  return figures.some((figure) => !precision.readsAsOne(observed, figure));
}
