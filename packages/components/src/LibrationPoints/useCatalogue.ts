import {
  CELESTIAL_FACTS,
  type CelestialFacts,
  useProcessor,
} from "@ksp-gonogo/sitrep-client";

/** The celestial catalogue. It does not decay down a link, so a held one is still the catalogue. */
export function useCatalogue(): CelestialFacts | undefined {
  const reading = useProcessor(CELESTIAL_FACTS);
  if (reading?.state === "observed" || reading?.state === "stale") {
    return reading.value;
  }
  return undefined;
}
