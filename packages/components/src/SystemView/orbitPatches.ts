import type { OrbitPatch } from "@ksp-gonogo/core";
import type { VesselOrbit as WireVesselOrbit } from "@ksp-gonogo/sitrep-sdk";
import type { EncounterDirection } from "./encounter";

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
  orbit,
  referenceBody,
  startUt,
  period,
  encounterDirection,
  encounterTimeUt,
  encounterBody,
}: {
  orbit: WireVesselOrbit;
  referenceBody: string;
  startUt: number;
  period: number | null | undefined;
  encounterDirection: EncounterDirection | null;
  encounterTimeUt: number | null;
  encounterBody: string | null;
}): OrbitPatch[] {
  if (period == null || period <= 0) return [];
  if (!orbit.ecc.lessThan(1)) return [];
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
      // Plain numbers: every element is sampled into plot coordinates.
      inclination: orbit.inc.magnitude,
      eccentricity: orbit.ecc.magnitude,
      epoch: orbit.epoch.magnitude,
      period,
      argumentOfPeriapsis: orbit.argPe?.magnitude ?? 0,
      sma: orbit.sma.magnitude,
      lan: orbit.lan?.magnitude ?? 0,
      maae: orbit.meanAnomalyAtEpoch.magnitude,
      referenceBody,
      semiLatusRectum: 0,
      semiMinorAxis: 0,
      closestEncounterBody: encounterBody,
    },
  ];
}
