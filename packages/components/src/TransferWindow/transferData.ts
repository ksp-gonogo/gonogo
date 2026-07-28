import {
  angleDelta,
  buildPorkchop,
  hohmannTransferTime,
  keplerTransferSolver,
  type PorkchopGrid,
  type TransferSolution,
} from "@ksp-gonogo/core";
import { type OrbitElements, solve } from "@ksp-gonogo/sitrep-client";
import type { CelestialBody } from "../SystemView/useCelestialBodies";

/*
 * Pure bridge between the streamed body model (`CelestialBody`, elements in
 * radians) and the core transfer math. No React, no side effects, the widget
 * calls these; tests exercise them directly.
 */

const toDeg = (rad: number): number => (rad * 180) / Math.PI;
const wrap360 = (deg: number): number => ((deg % 360) + 360) % 360;

/** The parent body's μ for `body` (looked up by `referenceBody` name). */
export function parentMu(
  body: CelestialBody,
  bodies: CelestialBody[],
): number | null {
  const parent = bodies.find((b) => b.name === body.referenceBody);
  return parent?.gravParameter ?? null;
}

/** True longitude (degrees, [0,360)) of a body: (Ω + ω) + ν. */
export function bodyTrueLongitudeDeg(body: CelestialBody): number | null {
  if (
    body.lan == null ||
    body.argumentOfPeriapsis == null ||
    body.trueAnomaly == null
  ) {
    return null;
  }
  return wrap360(toDeg(body.lan + body.argumentOfPeriapsis) + body.trueAnomaly);
}

/**
 * Current phase angle (degrees, wrapped to (−180,180]) of `dest` relative to
 * `origin`: how far the destination leads (+) or trails (−) the origin as
 * seen from their shared parent. Compared against the Hohmann ideal.
 */
export function phaseAngleDeg(
  origin: CelestialBody,
  dest: CelestialBody,
): number | null {
  const lo = bodyTrueLongitudeDeg(origin);
  const ld = bodyTrueLongitudeDeg(dest);
  if (lo == null || ld == null) return null;
  return angleDelta(ld, lo);
}

/** Build a Keplerian `OrbitElements` (for `solve`) from a body + its parent μ. */
export function celestialToOrbitElements(
  body: CelestialBody,
  bodies: CelestialBody[],
): OrbitElements | null {
  const mu = parentMu(body, bodies);
  if (
    mu == null ||
    body.semiMajorAxis == null ||
    body.eccentricity == null ||
    body.inclination == null ||
    body.lan == null ||
    body.argumentOfPeriapsis == null ||
    body.meanAnomalyAtEpoch == null ||
    body.epoch == null
  ) {
    return null;
  }
  return {
    sma: body.semiMajorAxis,
    ecc: body.eccentricity,
    inc: body.inclination,
    lan: body.lan,
    argPe: body.argumentOfPeriapsis,
    meanAnomalyAtEpoch: body.meanAnomalyAtEpoch,
    epoch: body.epoch,
    mu,
  };
}

export interface TransferComputeInput {
  /** The vessel's parent body (transfer origin, e.g. Kerbin/Earth). */
  origin: CelestialBody;
  /** The destination body (must share `origin`'s parent). */
  dest: CelestialBody;
  bodies: CelestialBody[];
  /** Parking-orbit radius around the origin body (m). */
  parkingRadius: number;
  nowUt: number;
}

/**
 * The coplanar MVP transfer solution (phase/window/ejection) via
 * `keplerTransferSolver`. `null` if the required elements aren't streamed yet.
 */
export function computeTransfer(
  input: TransferComputeInput,
): TransferSolution | null {
  const { origin, dest, bodies, parkingRadius, nowUt } = input;
  const muParent = parentMu(origin, bodies);
  if (
    muParent == null ||
    origin.semiMajorAxis == null ||
    dest.semiMajorAxis == null ||
    origin.period == null ||
    dest.period == null ||
    origin.gravParameter == null
  ) {
    return null;
  }
  const currentPhaseDeg = phaseAngleDeg(origin, dest);
  if (currentPhaseDeg == null) return null;
  return keplerTransferSolver.solve({
    muParent,
    originRadius: origin.semiMajorAxis,
    destRadius: dest.semiMajorAxis,
    originPeriod: origin.period,
    destPeriod: dest.period,
    currentPhaseDeg,
    muOriginBody: origin.gravParameter,
    parkingRadius,
    nowUt,
  });
}

export interface PorkchopBuildInput {
  origin: CelestialBody;
  dest: CelestialBody;
  bodies: CelestialBody[];
  nowUt: number;
  /** Departure-axis samples. Default 32. */
  departureSamples?: number;
  /** Arrival-axis samples. Default 32. */
  arrivalSamples?: number;
  /**
   * UT the grid centres its departure axis on, the ideal departure of the
   * window being shown. Default `nowUt`. Set it (from a selected window's
   * `departureUt`) to focus the chart on that window's Δv surface.
   */
  centerDepUt?: number;
}

/**
 * Build the porkchop grid for the origin→dest pair by wiring the streaming
 * Keplerian `solve` into core's `buildPorkchop`.
 *
 * The grid is a tight WINDOW around the transfer optimum, not a broad survey:
 * departure spans `centerDep ± 0.4·T_Hohmann`, arrival is centred on
 * `centerDep + T_Hohmann` and spans `± 0.4·T_Hohmann`. That keeps the time of
 * flight in `[0.2, 1.8]·T_Hohmann` across every cell; always positive, never
 * near-degenerate: so the whole grid solves and the Δv field is a smooth bowl
 * with a single central minimum (it contours to the canonical nested-bullseye
 * porkchop). A broad survey would fold in the arr≤dep triangle and the
 * long-TOF / multi-rev region, punching no-solution holes through the plot.
 *
 * Departures are never sampled before `nowUt` (you can't leave in the past); a
 * window whose ideal departure is "now" therefore shows the right half of the
 * bowl, which is correct rather than lopsided.
 */
export function buildTransferPorkchop(
  input: PorkchopBuildInput,
): PorkchopGrid | null {
  const { origin, dest, bodies, nowUt } = input;
  const departureSamples = input.departureSamples ?? 32;
  const arrivalSamples = input.arrivalSamples ?? 32;

  const originEl = celestialToOrbitElements(origin, bodies);
  const destEl = celestialToOrbitElements(dest, bodies);
  const muParent = parentMu(origin, bodies);
  if (
    !originEl ||
    !destEl ||
    muParent == null ||
    origin.semiMajorAxis == null ||
    dest.semiMajorAxis == null ||
    origin.period == null ||
    dest.period == null
  ) {
    return null;
  }

  const tHohmann = hohmannTransferTime(
    muParent,
    origin.semiMajorAxis,
    dest.semiMajorAxis,
  );
  const depHalf = 0.4 * tHohmann;
  const arrHalf = 0.4 * tHohmann;
  const centerDep = input.centerDepUt ?? nowUt;
  const centerArr = centerDep + tHohmann;

  const depStart = Math.max(nowUt, centerDep - depHalf);
  const depEnd = Math.max(depStart + 1, centerDep + depHalf);
  const arrStart = centerArr - arrHalf;
  const arrEnd = centerArr + arrHalf;

  const linspace = (a: number, b: number, n: number): number[] =>
    Array.from({ length: n }, (_, k) => a + ((b - a) * k) / (n - 1));

  return buildPorkchop({
    muParent,
    propagateOrigin: (ut) => solve(originEl, ut),
    propagateDest: (ut) => solve(destEl, ut),
    departureUts: linspace(depStart, depEnd, departureSamples),
    arrivalUts: linspace(arrStart, arrEnd, arrivalSamples),
  });
}

export interface TransferWindowEntry {
  /** 0 = the next window; higher = successive synodic repeats. */
  index: number;
  /** Departure UT of this window's optimum. */
  departureUt: number;
  /** Seconds from now until departure. */
  waitSeconds: number;
  /** Characteristic transfer Δv (m/s): the porkchop optimum. */
  deltaV: number;
  /** Ejection burn Δv from the parking orbit (m/s). */
  ejectionDeltaV: number;
  /** Ejection angle from the parent's prograde (deg). */
  ejectionAngleDeg: number;
  /** Transfer time (s). */
  transferTimeSec: number;
  /** Arrival UT. */
  arrivalUt: number;
}

function makeWindow(
  index: number,
  departureUt: number,
  deltaV: number,
  transferTimeSec: number,
  solution: TransferSolution,
  nowUt: number,
): TransferWindowEntry {
  return {
    index,
    departureUt,
    waitSeconds: Math.max(0, departureUt - nowUt),
    deltaV,
    ejectionDeltaV: solution.ejectionDeltaV,
    ejectionAngleDeg: solution.ejectionAngleDeg,
    transferTimeSec,
    arrivalUt: departureUt + transferTimeSec,
  };
}

/**
 * The next `count` transfer windows to the destination. Window 0 is the next
 * one; each subsequent window is a synodic period later with the same repeating
 * geometry (Δv / transfer-time stay constant for near-circular orbits, so the
 * useful signal across rows is the date/countdown: "miss this one, the next is
 * in N years"). Empty when no transfer solves.
 *
 * Window TIMING comes from the phase solution (`departureUt` = the synodic
 * countdown to the ideal phase, so window 0 reads "now" when the phase is open),
 * NOT from the porkchop's global-min departure (which can land a synodic away).
 * The Δv MAGNITUDE comes from the porkchop optimum; ejection figures + transfer
 * time from the coplanar solution.
 */
export function upcomingWindows(
  solution: TransferSolution,
  grid: PorkchopGrid,
  nowUt: number,
  count: number,
): TransferWindowEntry[] {
  const best = grid.best;
  if (!best) return [];
  const baseDep = solution.departureUt;
  const tof = solution.transferTimeSec;
  const dv = best.deltaV;
  const synodic = solution.synodicPeriodSec;
  if (!Number.isFinite(synodic) || synodic <= 0) {
    // Co-orbital / degenerate: only the one window is meaningful.
    return [makeWindow(0, baseDep, dv, tof, solution, nowUt)];
  }
  const out: TransferWindowEntry[] = [];
  for (let k = 0; k < count; k++) {
    out.push(makeWindow(k, baseDep + k * synodic, dv, tof, solution, nowUt));
  }
  return out;
}

/**
 * The bodies eligible as transfer destinations from `origin`: every other body
 * sharing `origin`'s parent (siblings), with the elements needed to solve. For
 * an interplanetary transfer `origin` is the vessel's parent (a planet) and the
 * siblings are the other planets; for a lunar transfer it's a moon's siblings.
 */
export function transferDestinations(
  origin: CelestialBody,
  bodies: CelestialBody[],
): CelestialBody[] {
  return bodies.filter(
    (b) =>
      b.index !== origin.index &&
      b.referenceBody != null &&
      b.referenceBody === origin.referenceBody &&
      b.semiMajorAxis != null &&
      b.period != null,
  );
}
