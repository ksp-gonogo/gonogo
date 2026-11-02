import type {
  BodyEntry,
  OrbitPatch,
  VesselOrbit,
  VesselTarget,
} from "@ksp-gonogo/sitrep-sdk";
import type { Approach } from "./craft";
import type { PatchNumbers } from "./encounter";
import type { Elements } from "./kepler";

/** A unit-carrying wire number as a plain finite number; undefined where it is absent or not finite. */
function num(v: { magnitude: number } | null | undefined): number | undefined {
  return v !== null && v !== undefined && Number.isFinite(v.magnitude)
    ? v.magnitude
    : undefined;
}

/** The elements of the craft's current conic, or null where one is missing. A missing node or periapsis is zero. */
export function elementsOf(
  o: Pick<
    VesselOrbit,
    | "sma"
    | "ecc"
    | "inc"
    | "lan"
    | "argPe"
    | "meanAnomalyAtEpoch"
    | "epoch"
    | "mu"
  >,
): Elements | null {
  const sma = num(o.sma);
  const ecc = num(o.ecc);
  const inc = num(o.inc);
  const m0 = num(o.meanAnomalyAtEpoch);
  const epoch = num(o.epoch);
  const mu = num(o.mu);
  if (
    sma === undefined ||
    ecc === undefined ||
    inc === undefined ||
    m0 === undefined ||
    epoch === undefined ||
    mu === undefined
  ) {
    return null;
  }
  return {
    sma,
    ecc,
    inc,
    lan: num(o.lan) ?? 0,
    argPe: num(o.argPe) ?? 0,
    meanAnomalyAtEpoch: m0,
    epoch,
    mu,
  };
}

/** The numbers of one trajectory patch, or null where any it needs is missing. */
export function patchNumbers(p: OrbitPatch): PatchNumbers | null {
  const sma = num(p.sma);
  const ecc = num(p.ecc);
  const semiLatusRectum = num(p.semiLatusRectum);
  const periapsisAltitude = num(p.peA);
  const epoch = num(p.epoch);
  const mu = num(p.mu);
  if (
    sma === undefined ||
    ecc === undefined ||
    semiLatusRectum === undefined ||
    periapsisAltitude === undefined ||
    epoch === undefined ||
    mu === undefined
  ) {
    return null;
  }
  return {
    sma,
    ecc,
    semiLatusRectum,
    periapsisAltitude,
    meanAnomalyAtEpoch: num(p.meanAnomalyAtEpoch) ?? 0,
    epoch,
    mu,
  };
}

/** The first patch of the trajectory that lies around the body, if any. */
export function patchAround(
  orbit: Pick<VesselOrbit, "patches">,
  bodyIndex: number,
): OrbitPatch | undefined {
  return orbit.patches.find((p) => p.referenceBodyIndex === bodyIndex);
}

/** A body's radius and sphere of influence, or null where either is not reported. */
export function bodyNumbers(
  body: Pick<BodyEntry, "radius" | "sphereOfInfluence"> | undefined,
): { radius: number; soi: number } | null {
  const radius = num(body?.radius);
  const soi = num(body?.sphereOfInfluence);
  return radius !== undefined && soi !== undefined ? { radius, soi } : null;
}

/** The closest approach the provider reports for the target, or null where there is none. */
export function approachOf(
  target: Pick<VesselTarget, "closestApproach">,
): Approach | null {
  const time = num(target.closestApproach?.time);
  const distance = num(target.closestApproach?.distance);
  return time !== undefined && distance !== undefined
    ? { time, distance }
    : null;
}
