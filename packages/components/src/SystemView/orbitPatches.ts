import type { OrbitPatch } from "@ksp-gonogo/core";
import type { EncounterDirection } from "./encounter";

/** The orbit's elements as plain numbers, the shape a patch is sampled from. */
export type ConicElements = Pick<
  OrbitPatch,
  | "inclination"
  | "eccentricity"
  | "epoch"
  | "argumentOfPeriapsis"
  | "sma"
  | "lan"
  | "maae"
>;

function endTransition(
  direction: EncounterDirection | null,
  endsAtTransition: boolean,
): OrbitPatch["patchEndTransition"] {
  if (!endsAtTransition) return "FINAL";
  if (direction === "escape") return "ESCAPE";
  return "ENCOUNTER";
}

/**
 * The one conic the vessel's orbit honestly predicts from `startUt`: up to the
 * next SOI transition, or one period. The post-transition elements are not on
 * the wire, so no second patch is fabricated. Elliptical orbits only; empty
 * otherwise.
 */
export function conicPatches({
  elements,
  referenceBody,
  startUt,
  period,
  encounterDirection,
  encounterTimeUt,
  encounterBody,
}: {
  elements: ConicElements;
  referenceBody: string;
  startUt: number;
  period: number | null | undefined;
  encounterDirection: EncounterDirection | null;
  encounterTimeUt: number | null;
  encounterBody: string | null;
}): OrbitPatch[] {
  if (period == null || period <= 0) return [];
  if (!(elements.eccentricity < 1)) return [];
  const endsAtTransition =
    encounterDirection !== null &&
    encounterTimeUt != null &&
    encounterTimeUt > startUt;
  return [
    {
      startUT: startUt,
      endUT: endsAtTransition ? encounterTimeUt : startUt + period,
      patchStartTransition: "INITIAL",
      patchEndTransition: endTransition(encounterDirection, endsAtTransition),
      PeA: 0,
      ApA: 0,
      ...elements,
      period,
      referenceBody,
      semiLatusRectum: 0,
      semiMinorAxis: 0,
      closestEncounterBody: encounterBody,
    },
  ];
}
