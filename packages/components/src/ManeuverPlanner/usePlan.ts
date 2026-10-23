import { useMemo } from "react";
import {
  computeBurnTrueAnomaly,
  computePlan,
  isSequence,
  type PlanResult,
} from "./planning";
import { isFiniteNumber, usesBodyTransfer } from "./presets";
import type { TransferContext } from "./transferPlan";
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
    transferBody,
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
    currentOrbit,
    currentUT,
    trueAnomaly,
    targetTrueAnomaly,
    craftElements,
    craftBody,
    celestialBodies,
    nowUtSeconds,
  } = telemetry;

  const transfer = useMemo<TransferContext | null>(() => {
    if (
      !usesBodyTransfer(preset) ||
      !craftElements ||
      !craftBody ||
      nowUtSeconds === undefined
    ) {
      return null;
    }
    const target = celestialBodies.find((b) => b.name === transferBody);
    if (!target) return null;
    return {
      craft: craftElements,
      craftBody,
      target,
      bodies: celestialBodies,
      periapsisAltitude: targetAltitudeKm * 1000,
      nowUt: nowUtSeconds,
    };
  }, [
    preset,
    craftElements,
    craftBody,
    celestialBodies,
    transferBody,
    targetAltitudeKm,
    nowUtSeconds,
  ]);

  const plan: PlanResult | null = useMemo(
    () =>
      computePlan({
        preset,
        currentOrbit,
        currentUT,
        mu,
        prograde,
        normal,
        radial,
        burnInSeconds,
        utMode,
        burnAtUT,
        trueAnomaly,
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
        targetTrueAnomaly,
        targetPeriod,
        standoffMeters,
        transfer,
      }),
    [
      currentOrbit,
      mu,
      currentUT,
      preset,
      prograde,
      normal,
      radial,
      burnInSeconds,
      utMode,
      burnAtUT,
      trueAnomaly,
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
      targetTrueAnomaly,
      targetPeriod,
      standoffMeters,
      transfer,
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
        currentOrbit,
        currentUT,
        mu,
        trueAnomaly,
        utMode,
        burnAtUT,
        burnInSeconds,
      }),
    [
      preset,
      currentOrbit,
      currentUT,
      mu,
      trueAnomaly,
      utMode,
      burnAtUT,
      burnInSeconds,
    ],
  );

  /*
   * Positive finite checks, since values can land NaN mid-scene-load. Withheld
   * on a held orbit too: a craft out of contact may have burned unseen, so its
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
    currentUT?.isFinite() === true &&
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
