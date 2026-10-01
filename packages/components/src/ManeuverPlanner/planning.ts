/**
 * Plan dispatch for the Maneuver Planner, pure so the non-React trigger services share it.
 *
 * Not a reckoner: each preset solves the burn that would reach a chosen orbit or rendezvous from the orbit as measured at the view time. A planned node is an event nobody has flown, so it is exactly as current as the elements it was solved from, which the planner's inputs already label. The plan sits on no channel, and `registerReckoner` takes a `TopicId`.
 */
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
  stateAtUT,
} from "@ksp-gonogo/core";
import { type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { isFiniteNumber, type PresetId } from "./presets";

export interface PlanInputs {
  preset: PresetId;
  currentOrbit: CurrentOrbit | null;
  currentUT: Value<"ut"> | undefined;
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
  /** Body radius: converts the Hohmann altitude input into a radius. */
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

/** A single-burn plan or a multi-burn sequence (Hohmann). */
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
      // PeA is an ALTITUDE; convert to PeR (from the body centre).
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
  const burnUT = burnInstant(i, i.currentUT);
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

/** The custom burn's instant: as entered, or the entered lead from now, never earlier than now. */
function burnInstant(
  i: Pick<PlanInputs, "utMode" | "burnAtUT" | "burnInSeconds">,
  currentUT: Value<"ut">,
): Value<"ut"> {
  return i.utMode === "absolute"
    ? value("ut", i.burnAtUT)
    : currentUT.plus(value("s", i.burnInSeconds).max(0));
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

/** A CurrentOrbit, or null unless every scalar is finite (the propagator would otherwise hit NaNs). */
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
  return {
    sma,
    eccentricity: ecc,
    ApR,
    PeR,
    timeToAp: value("s", timeToAp),
    timeToPe: value("s", timeToPe),
  };
}

/** Relative inclination (°) between two orbits from each one's inclination and LAN, or null if any input is missing. */
export function computeRelInc(
  inc1: number | undefined,
  lan1: number | undefined,
  inc2: number | undefined,
  lan2: number | undefined,
): number | null {
  if (
    inc1 === undefined ||
    lan1 === undefined ||
    inc2 === undefined ||
    lan2 === undefined
  ) {
    return null;
  }
  const i1 = (inc1 * Math.PI) / 180;
  const i2 = (inc2 * Math.PI) / 180;
  const dOmega = ((lan2 - lan1) * Math.PI) / 180;
  const cosRel =
    Math.cos(i1) * Math.cos(i2) +
    Math.sin(i1) * Math.sin(i2) * Math.cos(dOmega);
  return (Math.acos(Math.max(-1, Math.min(1, cosRel))) * 180) / Math.PI;
}

export interface BurnTrueAnomalyInputs {
  preset: PresetId;
  currentOrbit: CurrentOrbit | null;
  currentUT: Value<"ut"> | undefined;
  mu: number;
  trueAnomaly: number | undefined;
  utMode: "relative" | "absolute";
  burnAtUT: number;
  burnInSeconds: number;
}

/** True anomaly at the burn, for the drag handle; null outside the custom presets or before inputs are ready. */
export function computeBurnTrueAnomaly(
  i: BurnTrueAnomalyInputs,
): number | null {
  if (!i.currentOrbit || i.currentUT === undefined || i.mu <= 0) return null;
  if (i.preset === "custom-apo") return 180;
  if (i.preset === "custom-peri") return 0;
  if (i.preset !== "custom-ut") return null;
  if (i.trueAnomaly === undefined) return null;
  const burnUT = burnInstant(i, i.currentUT);
  if (burnUT.lessThanOrEqual(i.currentUT)) return null;
  const state = stateAtUT(
    i.currentOrbit,
    i.trueAnomaly,
    i.mu,
    i.currentUT,
    burnUT,
  );
  return state ? state.trueAnomalyDeg : null;
}

/**
 * μ from live telemetry only, never the body registry: vis-viva
 * (v²·a·r/(2a-r)), else Kepler's third law (4π²a³/T²) while speed and radius
 * have not streamed yet. 0 when neither has usable inputs.
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
