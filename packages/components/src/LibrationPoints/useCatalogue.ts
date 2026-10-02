import {
  CELESTIAL_FACTS,
  type CelestialFacts,
  useProcessor,
} from "@ksp-gonogo/sitrep-client";
import type { HeldSince } from "../shared/heldFigure";

/** The celestial catalogue. It does not decay down a link, so a held one is still the catalogue. */
export function useCatalogue(): CelestialFacts | undefined {
  const reading = useProcessor(CELESTIAL_FACTS);
  if (reading?.state === "observed" || reading?.state === "held") {
    return reading.value;
  }
  return undefined;
}

/** The catalogue beside how current its last reading is, for dating a figure derived from its orbits. */
export function useCatalogueWithCurrency(): {
  facts: CelestialFacts | undefined;
  heldSince: HeldSince;
} {
  const reading = useProcessor(CELESTIAL_FACTS);
  if (reading?.state === "observed") {
    return { facts: reading.value, heldSince: null };
  }
  if (reading?.state === "held") {
    return {
      facts: reading.value,
      heldSince: { asOfUt: reading.asOfUt, grade: reading.grade },
    };
  }
  return { facts: undefined, heldSince: null };
}
