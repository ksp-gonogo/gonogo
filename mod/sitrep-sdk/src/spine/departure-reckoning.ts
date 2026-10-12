import type { PropagationDepartureKnot } from "../__generated__/contract";
import type { Value } from "../unit-system";
import { value } from "../unit-system/value";
import type { OrbitElements } from "./kepler";

/**
 * How far a provider says the published orbit is from the vessel's actual path
 * at one instant. Useful for deciding how long a propagated orbit can be
 * trusted. Returned by `departureAt`.
 *
 * @category Reckoners
 */
export interface Departure {
  /** The largest position drift reached up to the instant. */
  readonly metres: Value<"m">;
  /** The largest velocity drift reached up to the instant. */
  readonly metresPerSecond: Value<"m/s">;
}

/**
 * The departure cap in force at the view time `viewUt`: the first knot whose
 * instant is at or after it. Useful for telling how far the published orbit may
 * have drifted from the vessel's path at that instant. Used by the orbit
 * reckoner in the core.
 *
 * Each knot is a running maximum, so the list reads as a step function: a view
 * time just past one knot takes the next knot's figure and is never
 * interpolated. `undefined` where the provider stated nothing, where the view
 * precedes the sample the envelope was measured from, and past the last knot,
 * where the orbit has already been refused.
 */
export function departureAt(
  knots: readonly PropagationDepartureKnot[] | null | undefined,
  sampleUt: number,
  viewUt: number,
): Departure | undefined {
  if (knots == null || knots.length === 0 || viewUt < sampleUt) {
    return undefined;
  }
  const view = value("ut", viewUt);
  for (const knot of knots) {
    if (view.lessThanOrEqual(knot.untilUt)) {
      return knot.metres.isFinite() && knot.metresPerSecond.isFinite()
        ? { metres: knot.metres, metresPerSecond: knot.metresPerSecond }
        : undefined;
    }
  }
  return undefined;
}

/**
 * The most the mean anomaly can be off by when the vessel is `metres` from where
 * the orbit puts it, at orbital radius `radius` (metres). Useful for turning a
 * position drift into an error in the vessel's place along its orbit. Used by
 * the orbit reckoner in the core.
 *
 * Treats the whole distance as along-track, which is the conservative reading:
 * an along-track error of `d` moves the true anomaly by at most `d / r`, and
 * `dM / dnu = r^2 / (a^2 sqrt|1 - e^2|)`, so `|dM| <= d r / (a^2 sqrt|1 - e^2|)`.
 * The absolute values make the one expression serve both signs of `a` and of
 * `1 - e^2`. `undefined` for a parabola, where the denominator is zero.
 */
export function meanAnomalySpread(
  metres: Value<"m">,
  elements: Pick<OrbitElements, "sma" | "ecc">,
  radius: number,
): Value<"rad"> | undefined {
  const shape = Math.sqrt(Math.abs(1 - elements.ecc * elements.ecc));
  const axis = Math.abs(elements.sma);
  if (shape === 0 || axis === 0) return undefined;
  const spread = value("rad", 1).times(
    metres.per(value("m", axis)).times(radius / (axis * shape)),
  );
  return spread.isFinite() ? spread : undefined;
}
