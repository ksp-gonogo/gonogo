import {
  type CurrentOrbit,
  circularizeAtApo,
  circularizeAtPeri,
  customAtApsis,
  customAtUT,
  gravParameterFromState,
  hohmannRendezvous,
  hohmannToRadius,
  type ManeuverPlan,
  type ManeuverSequence,
  matchInclination,
  matchTargetPlane,
} from "@gonogo/core";
import { isFiniteNumber, type PresetId } from "./presets";

/**
 * Plan-dispatch helpers. Pure functions — same inputs → same result.
 * Lifted out of the widget so non-React surfaces (the trigger host
 * service, future tests) can reuse the math without dragging the React
 * tree along.
 */

export interface PlanInputs {
  preset: PresetId;
  currentOrbit: CurrentOrbit | null;
  currentUT: number | undefined;
  mu: number;
  prograde: number;
  normal: number;
  radial: number;
  burnInSeconds: number;
  utMode: "relative" | "absolute";
  burnAtUT: number;
  trueAnomaly: number | undefined;
  argPe: number | undefined;
  inclination: number | undefined;
  targetInclination: number;
  targetInclinationLive: number | undefined;
  targetLanLive: number | undefined;
  lan: number | undefined;
  /** Body radius — converts the Hohmann altitude input into a radius. */
  bodyRadius: number | undefined;
  /** Hohmann target altitude (km above the reference body). */
  targetAltitudeKm: number;
  /** Live target orbit fields for hohmann-rendezvous-target. */
  targetSma: number | undefined;
  targetPeA: number | undefined;
  targetArgPe: number | undefined;
  targetTrueAnomaly: number | undefined;
  targetPeriod: number | undefined;
  /** Rendezvous standoff offset along-track on target orbit (m). */
  standoffMeters: number;
}

/** Either a single-burn plan (existing presets) or a multi-burn sequence
 *  (Hohmann). Render code branches on `"burns" in result`. */
export type PlanResult = ManeuverPlan | ManeuverSequence;

export function isSequence(result: PlanResult): result is ManeuverSequence {
  return "burns" in result;
}

export function computePlan(i: PlanInputs): PlanResult | null {
  if (!i.currentOrbit || i.currentUT === undefined || i.mu <= 0) return null;
  switch (i.preset) {
    case "circularize-apo":
      return circularizeAtApo(i.currentOrbit, i.mu, i.currentUT);
    case "circularize-peri":
      return circularizeAtPeri(i.currentOrbit, i.mu, i.currentUT);
    case "custom-apo":
    case "custom-peri":
      return customAtApsis(
        i.currentOrbit,
        i.mu,
        i.currentUT,
        i.preset === "custom-apo" ? "apo" : "peri",
        i.prograde,
        i.normal,
        i.radial,
      );
    case "custom-ut":
      return planCustomUT(i);
    case "hohmann-to-altitude":
      return planHohmann(i);
    case "hohmann-rendezvous-target":
      return planHohmannRendezvous(i);
    case "match-inclination":
      return planMatchInclination(i, i.targetInclination);
    case "match-target-inclination":
      if (i.targetInclinationLive === undefined) return null;
      return planMatchInclination(i, i.targetInclinationLive);
    case "match-target-plane":
      return planMatchTargetPlane(i);
  }
}

function planHohmann(i: PlanInputs): ManeuverSequence | null {
  if (
    !i.currentOrbit ||
    i.currentUT === undefined ||
    i.bodyRadius === undefined ||
    !(i.bodyRadius > 0)
  ) {
    return null;
  }
  const targetR = i.bodyRadius + i.targetAltitudeKm * 1000;
  if (!(targetR > 0)) return null;
  return hohmannToRadius(i.currentOrbit, i.mu, i.currentUT, targetR);
}

function planHohmannRendezvous(i: PlanInputs): ManeuverSequence | null {
  if (
    !i.currentOrbit ||
    i.currentUT === undefined ||
    i.trueAnomaly === undefined ||
    i.argPe === undefined ||
    i.inclination === undefined ||
    i.lan === undefined ||
    i.targetSma === undefined ||
    i.targetPeA === undefined ||
    i.targetInclinationLive === undefined ||
    i.targetLanLive === undefined ||
    i.targetArgPe === undefined ||
    i.targetTrueAnomaly === undefined ||
    i.targetPeriod === undefined ||
    i.bodyRadius === undefined ||
    !(i.bodyRadius > 0)
  ) {
    return null;
  }
  return hohmannRendezvous(
    i.currentOrbit,
    i.trueAnomaly,
    i.argPe,
    i.inclination,
    i.lan,
    i.mu,
    i.currentUT,
    {
      sma: i.targetSma,
      // Telemachus reports PeA (altitude); convert to PeR (from body centre).
      PeR: i.bodyRadius + i.targetPeA,
      inclinationDeg: i.targetInclinationLive,
      lanDeg: i.targetLanLive,
      argPeDeg: i.targetArgPe,
      trueAnomalyDeg: i.targetTrueAnomaly,
      period: i.targetPeriod,
    },
    i.standoffMeters,
  );
}

function planCustomUT(i: PlanInputs): ManeuverPlan | null {
  if (
    i.trueAnomaly === undefined ||
    !i.currentOrbit ||
    i.currentUT === undefined
  ) {
    return null;
  }
  const burnUT =
    i.utMode === "absolute"
      ? i.burnAtUT
      : i.currentUT + Math.max(0, i.burnInSeconds);
  return customAtUT(
    i.currentOrbit,
    i.trueAnomaly,
    i.mu,
    i.currentUT,
    burnUT,
    i.prograde,
    i.normal,
    i.radial,
  );
}

function planMatchInclination(
  i: PlanInputs,
  targetInc: number,
): ManeuverPlan | null {
  if (
    !i.currentOrbit ||
    i.currentUT === undefined ||
    i.trueAnomaly === undefined ||
    i.argPe === undefined ||
    i.inclination === undefined
  ) {
    return null;
  }
  return matchInclination(
    i.currentOrbit,
    i.trueAnomaly,
    i.argPe,
    i.inclination,
    i.mu,
    i.currentUT,
    targetInc,
  );
}

function planMatchTargetPlane(i: PlanInputs): ManeuverPlan | null {
  if (
    !i.currentOrbit ||
    i.currentUT === undefined ||
    i.trueAnomaly === undefined ||
    i.argPe === undefined ||
    i.inclination === undefined ||
    i.lan === undefined ||
    i.targetInclinationLive === undefined ||
    i.targetLanLive === undefined
  ) {
    return null;
  }
  return matchTargetPlane(
    i.currentOrbit,
    i.trueAnomaly,
    i.argPe,
    i.inclination,
    i.lan,
    i.targetInclinationLive,
    i.targetLanLive,
    i.mu,
    i.currentUT,
  );
}

/**
 * All orbital scalars must be finite before we can construct a
 * CurrentOrbit — otherwise the propagator hits NaNs and downstream
 * widgets render garbage.
 */
export function buildCurrentOrbit(vals: {
  sma: number | undefined;
  ecc: number | undefined;
  ApR: number | undefined;
  PeR: number | undefined;
  timeToAp: number | undefined;
  timeToPe: number | undefined;
}): CurrentOrbit | null {
  const { sma, ecc, ApR, PeR, timeToAp, timeToPe } = vals;
  if (
    !isFiniteNumber(sma) ||
    !isFiniteNumber(ecc) ||
    !isFiniteNumber(ApR) ||
    !isFiniteNumber(PeR) ||
    !isFiniteNumber(timeToAp) ||
    !isFiniteNumber(timeToPe)
  ) {
    return null;
  }
  return { sma, eccentricity: ecc, ApR, PeR, timeToAp, timeToPe };
}

/**
 * μ from live telemetry only — never the body-registry value. vis-viva
 * (v²·a·r/(2a−r)) is preferred; Kepler's 3rd (4π²a³/T²) is the fallback
 * for the brief window at scene load when orbitalSpeed/radius haven't
 * streamed yet. Returns 0 when neither formula has usable inputs.
 */
export function computeMu(
  orbitalSpeed: number | undefined,
  radius: number | undefined,
  sma: number | undefined,
  period: number | undefined,
): number {
  if (
    isFiniteNumber(orbitalSpeed) &&
    isFiniteNumber(radius) &&
    isFiniteNumber(sma) &&
    orbitalSpeed > 0 &&
    sma > 0
  ) {
    const viaVisViva = gravParameterFromState(orbitalSpeed, radius, sma);
    if (viaVisViva > 0) return viaVisViva;
  }
  if (isFiniteNumber(period) && isFiniteNumber(sma) && period > 0) {
    return (4 * Math.PI * Math.PI * sma ** 3) / (period * period);
  }
  return 0;
}
