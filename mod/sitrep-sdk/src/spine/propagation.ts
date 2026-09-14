/**
 * Orbit scalars read straight off streamed elements, for a caller that already
 * holds them and wants a closed-form property of the ellipse.
 *
 * Nothing here propagates. Advancing elements to a future UT is
 * `orbit-trajectory.ts`'s job, because that question cannot be answered from
 * the elements alone: it needs the elected provider's `PropagationHorizon` for
 * how far they may be extrapolated and for whether a conic is the right
 * renderer at all. `orbitalPeriod` needs neither, being a property of the
 * ellipse wherever the craft is on it.
 */

import type { OrbitElements } from "./kepler";

const TWO_PI = 2 * Math.PI;

/** Re-exported for this module's long-standing importers; declared in the unit system. */
export { STANDARD_GRAVITY } from "../unit-system/definitions";

/** Orbital period (seconds) of an ellipse: `2π·sqrt(sma³/mu)`. `null` for a non-bound (sma ≤ 0) or non-finite orbit. */
export function orbitalPeriod(elements: OrbitElements): number | null {
  if (elements.sma <= 0 || !Number.isFinite(elements.sma)) return null;
  const period = TWO_PI * Math.sqrt(elements.sma ** 3 / elements.mu);
  return Number.isFinite(period) ? period : null;
}
