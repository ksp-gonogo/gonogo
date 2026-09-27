import { useMemo } from "react";
import {
  computeBurnTrueAnomaly,
  computePlan,
  isSequence,
  type PlanResult,
} from "./planning";
import { isFiniteNumber } from "./presets";
import type { PlannerInputs } from "./usePlannerInputs";
import type { PlannerTelemetry } from "./usePlannerTelemetry";

/** The plan the current inputs describe against the current orbit, and whether it can be judged, flown or drawn. */
export function usePlan(inputs: PlannerInputs, telemetry: PlannerTelemetry) {
  const {
    preset,
    prograde,
    normal,
    radial,
    burnInSeconds,
    utMode,
    burnAtUT,
    targetInclination,
    targetAltitudeKm,
    standoffMeters,
  } = inputs;
  const {
    orbitObserved,
    mu,
    argPe,
    inclination,
    targetInclinationLive,
    targetLanLive,
    lan,
    body,
    targetSma,
    targetPeA,
    targetArgPe,
    targetPeriod,
    availableDeltaV,
    sma,
    ecc,
    ApR,
    PeR,
    timeToAp,
    timeToPe,
  } = telemetry;

  // Built against what the command will find when it lands; see `usePlannerTelemetry`.
  const planning = telemetry.planning;
  const plan: PlanResult | null = useMemo(
    () =>
      computePlan({
        preset,
        currentOrbit: planning.currentOrbit,
        currentUT: planning.currentUT,
        mu,
        prograde,
        normal,
        radial,
        burnInSeconds,
        utMode,
        burnAtUT,
        trueAnomaly: planning.trueAnomaly,
        argPe,
        inclination,
        targetInclination,
        targetInclinationLive,
        targetLanLive,
        lan,
        bodyRadius: body?.radius,
        targetAltitudeKm,
        targetSma,
        targetPeA,
        targetArgPe,
        targetTrueAnomaly: planning.targetTrueAnomaly,
        targetPeriod,
        standoffMeters,
      }),
    [
      planning.currentOrbit,
      mu,
      planning.currentUT,
      preset,
      prograde,
      normal,
      radial,
      burnInSeconds,
      utMode,
      burnAtUT,
      planning.trueAnomaly,
      argPe,
      inclination,
      targetInclination,
      targetInclinationLive,
      targetLanLive,
      lan,
      body?.radius,
      targetAltitudeKm,
      targetSma,
      targetPeA,
      targetArgPe,
      planning.targetTrueAnomaly,
      targetPeriod,
      standoffMeters,
    ],
  );

  let requiredDeltaV = 0;
  if (plan) {
    requiredDeltaV = isSequence(plan) ? plan.totalDeltaV : plan.requiredDeltaV;
  }
  // `null` when we cannot judge; a real zero budget compares like any number and comes out short.
  const feasible =
    plan === null || availableDeltaV === null
      ? null
      : availableDeltaV >= requiredDeltaV;

  // True anomaly at the burn, placing the preview's drag handle.
  const burnTrueAnomaly: number | null = useMemo(
    () =>
      computeBurnTrueAnomaly({
        preset,
        currentOrbit: planning.currentOrbit,
        currentUT: planning.currentUT,
        mu,
        trueAnomaly: planning.trueAnomaly,
        utMode,
        burnAtUT,
        burnInSeconds,
      }),
    [
      preset,
      planning.currentOrbit,
      planning.currentUT,
      mu,
      planning.trueAnomaly,
      utMode,
      burnAtUT,
      burnInSeconds,
    ],
  );

  /*
   * Positive finite checks, since values can land NaN mid-scene-load. Withheld
   * on a stale orbit too: a craft out of contact may have burned unseen, so its
   * carried elements can describe an orbit it has left. This gates planning
   * only, never the diagram's own trajectory.
   */
  const planReady =
    orbitObserved &&
    isFiniteNumber(sma) &&
    isFiniteNumber(ecc) &&
    isFiniteNumber(ApR) &&
    isFiniteNumber(PeR) &&
    isFiniteNumber(timeToAp) &&
    isFiniteNumber(timeToPe) &&
    isFiniteNumber(planning.currentUT) &&
    mu > 0;

  // An escape orbit has no apoapsis and reads as waiting, so raw ecc tells it apart from no telemetry.
  const hyperbolic = isFiniteNumber(ecc) && ecc >= 1;

  return {
    plan,
    requiredDeltaV,
    feasible,
    burnTrueAnomaly,
    planReady,
    hyperbolic,
  };
}
