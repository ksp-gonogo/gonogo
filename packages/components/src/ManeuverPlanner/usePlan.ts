import { useTelemetry } from "@ksp-gonogo/core";
import { useMemo } from "react";
import { useThrottledBucket } from "../GroundTrack/predictionThrottle";
import { isGroundedSituation } from "../LandingStatus/grounded";
import {
  type CaptureFault,
  captureFault as captureFaultOf,
  computeBurnTrueAnomaly,
  computePlan,
  isSequence,
  meetsSurfaceBeforeBurn,
  type PlanResult,
} from "./planning";
import { isFiniteNumber, usesBodyTransfer } from "./presets";
import { planBodyTransfer, type TransferContext } from "./transferPlan";
import type { PlannerInputs } from "./usePlannerInputs";
import type { PlannerTelemetry } from "./usePlannerTelemetry";

/** The plan the current inputs describe against the current orbit, and whether it can be judged, flown or drawn. */
export function usePlan(inputs: PlannerInputs, telemetry: PlannerTelemetry) {
  const identityReading = useTelemetry("vessel.identity");
  const landed = isGroundedSituation(
    identityReading.state === "observed" || identityReading.state === "held"
      ? identityReading.value.situation
      : undefined,
  );
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
    captureAltitudeKm,
    captureCircularise,
    transferBody,
  } = inputs;
  const {
    orbitPresent,
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
    openOrbit,
    currentUT,
    trueAnomaly,
    targetTrueAnomaly,
    craftElements,
    craftBody,
    celestialBodies,
    nowUtSeconds,
  } = telemetry;

  // The search starts from the view's instant, which moves every frame; a held whole second gives the operator the same plan without a Lambert search per frame.
  const transferNowUt = useThrottledBucket(nowUtSeconds, 1);
  // Held on the orbit's shape and a whole second: the reckoned elements are re-dated to the view's instant every frame without the orbit changing, and a Lambert search keyed on them ran once a frame.
  // biome-ignore lint/correctness/useExhaustiveDependencies: craftElements is read at the held second; its shape is keyed below
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
    craftElements !== null,
    craftElements?.sma,
    craftElements?.ecc,
    craftElements?.inc,
    craftElements?.lan,
    craftElements?.argPe,
    craftElements?.mu,
    craftBody,
    celestialBodies,
    transferBody,
    targetAltitudeKm,
    transferNowUt,
    nowUtSeconds === undefined,
  ]);

  // Altitude is over the body the craft is approaching; unset follows the periapsis, which is a circular capture.
  const captureTargetRadius =
    openOrbit && captureAltitudeKm !== null && body
      ? body.radius + captureAltitudeKm * 1000
      : undefined;
  const captureFault: CaptureFault | null =
    openOrbit && body && captureTargetRadius !== undefined
      ? captureFaultOf(
          captureTargetRadius,
          body.radius,
          craftBody?.atmosphere?.depth ?? undefined,
          craftBody?.soi ?? undefined,
        )
      : null;

  // Solved on its own so the per-frame inputs of every other plan do not run the search again.
  const planned = !openOrbit && currentOrbit !== null && mu > 0;
  const transferPlan = useMemo(
    () => (planned && transfer ? planBodyTransfer(transfer) : null),
    [planned, transfer],
  );

  const plan: PlanResult | null = useMemo(
    () =>
      computePlan({
        preset,
        currentOrbit,
        openOrbit,
        captureTargetRadius: captureFault ? undefined : captureTargetRadius,
        captureCircularise,
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
        transferPlan,
      }),
    [
      currentOrbit,
      openOrbit,
      captureTargetRadius,
      captureCircularise,
      captureFault,
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
      transferPlan,
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
   * Positive finite checks, since values can land NaN mid-scene-load. A held
   * orbit plans too, carrying its held mark: a maneuver is a delta-v at a time,
   * so it can be authored from the last state received, and the send is what
   * the link decides. A craft on the ground is withheld: its elements describe
   * a path through the ground, which no burn can be planned on.
   */
  const meetsSurface = meetsSurfaceBeforeBurn({
    preset,
    mu,
    sma,
    ecc,
    PeR,
    bodyRadius: body?.radius,
    timeToAp,
    timeToPe,
  });
  const closedPlanReady =
    !landed &&
    !meetsSurface &&
    orbitPresent &&
    isFiniteNumber(sma) &&
    isFiniteNumber(ecc) &&
    isFiniteNumber(ApR) &&
    isFiniteNumber(PeR) &&
    isFiniteNumber(timeToAp) &&
    isFiniteNumber(timeToPe) &&
    currentUT?.isFinite() === true &&
    mu > 0;

  /*
   * An open orbit still inbound is planned from its periapsis alone: it has no
   * apoapsis or period to wait for. Past periapsis it reads as not plannable.
   */
  const capturable =
    !landed &&
    orbitPresent &&
    openOrbit !== null &&
    currentUT?.isFinite() === true &&
    mu > 0;
  const planReady = closedPlanReady || (capturable && captureFault === null);

  // An escape orbit has no apoapsis and reads as waiting, so raw ecc tells it apart from no telemetry.
  const hyperbolic = isFiniteNumber(ecc) && ecc >= 1;

  return {
    plan,
    requiredDeltaV,
    feasible,
    burnTrueAnomaly,
    planReady,
    hyperbolic,
    capturable,
    captureFault,
    landed,
    meetsSurface,
  };
}
