import {
  angleDelta,
  buildPorkchop,
  hohmannTransferTime,
  keplerTransferSolver,
  type PorkchopGrid,
  synodicPeriod,
  type TransferSolution,
} from "@ksp-gonogo/core";
import { type OrbitElements, solve } from "@ksp-gonogo/sitrep-client";
import type { CelestialBody } from "../SystemView/useCelestialBodies";

/*
 * Pure bridge between the streamed body model (`CelestialBody`, elements in
 * radians) and the core transfer math. No React, no side effects — the widget
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
 * `origin` — how far the destination leads (+) or trails (−) the origin as
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
  /** Departure-axis samples. Default 24. */
  departureSamples?: number;
  /** Arrival-axis samples. Default 24. */
  arrivalSamples?: number;
}

/**
 * Build the porkchop grid for the origin→dest pair by wiring the streaming
 * Keplerian `solve` into core's `buildPorkchop`. Departure spans one synodic
 * period from now; arrival spans 0.5×–2.0× the Hohmann transfer time after
 * each departure — the band that brackets the useful single-rev transfers.
 */
export function buildTransferPorkchop(
  input: PorkchopBuildInput,
): PorkchopGrid | null {
  const { origin, dest, bodies, nowUt } = input;
  const departureSamples = input.departureSamples ?? 24;
  const arrivalSamples = input.arrivalSamples ?? 24;

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

  const synodic = synodicPeriod(origin.period, dest.period);
  const tHohmann = hohmannTransferTime(
    muParent,
    origin.semiMajorAxis,
    dest.semiMajorAxis,
  );
  const depSpan = Number.isFinite(synodic) ? synodic : 2 * tHohmann;
  const tofMin = 0.5 * tHohmann;
  const tofMax = 2.0 * tHohmann;

  const departureUts = Array.from(
    { length: departureSamples },
    (_, i) => nowUt + (depSpan * i) / (departureSamples - 1),
  );
  // Arrival axis is absolute UT spanning [now + tofMin, now + depSpan + tofMax]
  // so every departure's usable transfer band is covered.
  const arrStart = nowUt + tofMin;
  const arrEnd = nowUt + depSpan + tofMax;
  const arrivalUts = Array.from(
    { length: arrivalSamples },
    (_, j) => arrStart + ((arrEnd - arrStart) * j) / (arrivalSamples - 1),
  );

  return buildPorkchop({
    muParent,
    propagateOrigin: (ut) => solve(originEl, ut),
    propagateDest: (ut) => solve(destEl, ut),
    departureUts,
    arrivalUts,
    // A Hohmann sits at ~180°; skip the near-degenerate cells right at it.
    minTofSec: 0.1 * tHohmann,
  });
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
