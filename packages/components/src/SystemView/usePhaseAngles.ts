import type { CelestialBody } from "./useCelestialBodies";

/**
 * Phase angle (deg) from each body to the active vessel, keyed by body index —
 * the input the AlmanacPanel's transfer-window readout and SystemDiagram's
 * per-body label used to show.
 *
 * FOLLOW-UP (not yet reimplemented): this rode Telemachus's derived
 * `b.o.phaseAngle[i]` key via `getDataSource("data")` — a source deleted in the
 * Telemachus removal, so the hook already degraded to an empty result. The
 * `system.bodies` stream carries no phase angle (it's a static body snapshot,
 * not vessel-relative), so a faithful replacement must DERIVE it client-side
 * from the active vessel's orbital longitude and each body's, at the current
 * view-UT (roughly `wrap(bodyLon − vesselLon)` where `lon ≈ lan + argPe + ν`).
 * That needs the vessel orbit + UT threaded in here and its sign convention
 * validated against KSP, so it's deferred to keep this migration a strict
 * non-regression: the map is empty exactly as it already was in the field.
 *
 * Returning an empty map is safe for every consumer — `SystemView`'s
 * transfer-window highlighting and the AlmanacPanel phase row both already
 * treat "no live phase angle" as their default (no highlight / row omitted).
 */
export function usePhaseAngles(
  _bodies: readonly CelestialBody[],
): Map<number, number> {
  return EMPTY;
}

// Stable identity so a consumer memoising on the returned map doesn't churn.
const EMPTY: Map<number, number> = new Map();
