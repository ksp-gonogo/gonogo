import {
  CELESTIAL_FACTS,
  type CelestialBody,
  useProcessor,
} from "@ksp-gonogo/sitrep-client";

export type { BodyAtmosphere, CelestialBody } from "@ksp-gonogo/sitrep-client";

/** Stable empty catalogue, so a fresh `[]` before the first frame does not re-seed every downstream memo. */
const NO_BODIES: CelestialBody[] = [];

/**
 * The celestial-body list, enriched with almanac values, from `CELESTIAL_FACTS` (which runs once per frame however many surfaces read it).
 * A consumer wanting index lookups or a single body reads `useProcessor(CELESTIAL_FACTS)` directly.
 */
export function useCelestialBodies(): CelestialBody[] {
  // A held catalogue is still the catalogue.
  const reading = useProcessor(CELESTIAL_FACTS);
  const facts =
    reading?.state === "observed" || reading?.state === "stale"
      ? reading.value
      : undefined;
  return facts?.bodies ?? NO_BODIES;
}
