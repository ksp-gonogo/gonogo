import {
  CELESTIAL_FACTS,
  type CelestialBody,
  useProcessor,
} from "@ksp-gonogo/sitrep-client";

export type { BodyAtmosphere, CelestialBody } from "@ksp-gonogo/sitrep-client";

/**
 * Stable empty catalogue. `useProcessor` answers `undefined` before the first
 * frame, and a fresh `[]` per render would re-seed every downstream memo that
 * takes the list as a dep.
 */
const NO_BODIES: CelestialBody[] = [];

/**
 * The celestial-body tree, enriched with the almanac values the wire
 * deliberately drops.
 *
 * The derivation itself is `CELESTIAL_FACTS` in the SDK, which runs ONCE per
 * Sitrep frame however many surfaces read it. It used to live here, memoised on
 * `[systemBodies, ut]`, and `ut` moves every frame, so the whole map re-ran per
 * frame in each of the four consumers.
 *
 * A consumer wanting the index lookups (`nameByIndex` / `indexByName`) or a
 * single body by index reads `useProcessor(CELESTIAL_FACTS)` directly and uses
 * `bodyAtIndex` / `bodyNamed`; this hook is the plain-list read the diagram and
 * the almanac panels want.
 */
export function useCelestialBodies(): CelestialBody[] {
  return useProcessor(CELESTIAL_FACTS)?.bodies ?? NO_BODIES;
}
