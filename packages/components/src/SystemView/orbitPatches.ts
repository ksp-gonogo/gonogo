import type { OrbitPatch } from "@ksp-gonogo/sitrep-sdk";
import { TransitionType, value } from "@ksp-gonogo/sitrep-sdk";
import type { EncounterDirection } from "./encounter";
import type { TrajectoryPatch } from "./predictedTrajectory";

/** The orbit's elements, the part of a patch it is sampled from. */
export type ConicElements = Pick<
  OrbitPatch,
  "inc" | "ecc" | "epoch" | "argPe" | "sma" | "lan" | "meanAnomalyAtEpoch"
>;

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
}: {
  elements: ConicElements;
  referenceBody: string;
  startUt: number;
  period: number | null | undefined;
  encounterDirection: EncounterDirection | null;
  encounterTimeUt: number | null;
}): TrajectoryPatch[] {
  if (period == null || period <= 0) return [];
  if (!elements.ecc.lessThan(1)) return [];
  const endsAtTransition =
    encounterDirection !== null &&
    encounterTimeUt != null &&
    encounterTimeUt > startUt;
  return [
    {
      ...elements,
      period: value("s", period),
      startUt: value("ut", startUt),
      endUt: value("ut", endsAtTransition ? encounterTimeUt : startUt + period),
      patchStartTransition: TransitionType.Initial,
      referenceBody,
    },
  ];
}
