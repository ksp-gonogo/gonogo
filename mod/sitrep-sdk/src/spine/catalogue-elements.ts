import { PropagationHorizonKind } from "../__generated__/contract";
import type { CelestialBody, CelestialFacts } from "./celestial-facts";
import type { OrbitElements } from "./kepler";

/** How far up a parent chain a walk goes before giving up. Star, planet, moon, submoon is four. */
export const MAX_PARENT_DEPTH = 8;

export function finite(x: number | null | undefined): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * A body's elements against its parent, in the radians-and-metres shape the
 * solver wants, or null when the catalogue has not filled them.
 *
 * The root star has no elements and is not a failure: it is the origin of
 * everything here, and null is how it says so.
 */
export function elementsOf(
  body: CelestialBody,
  parent: CelestialBody | null,
): OrbitElements | null {
  if (parent === null) return null;
  if (
    !finite(body.semiMajorAxis) ||
    !finite(body.eccentricity) ||
    !finite(body.meanAnomalyAtEpoch) ||
    !finite(body.epoch) ||
    !finite(parent.gravParameter)
  ) {
    return null;
  }
  return {
    sma: body.semiMajorAxis,
    ecc: body.eccentricity,
    inc: degToRad(body.inclination ?? 0),
    lan: degToRad(body.lan ?? 0),
    argPe: degToRad(body.argumentOfPeriapsis ?? 0),
    meanAnomalyAtEpoch: body.meanAnomalyAtEpoch,
    epoch: body.epoch,
    mu: parent.gravParameter,
  };
}

export function parentOf(
  facts: CelestialFacts,
  body: CelestialBody,
): CelestialBody | null {
  if (body.referenceBody === null) return null;
  const parent = facts.bodies.find((b) => b.name === body.referenceBody);
  // A body listed as its own parent is the root saying so, not a cycle.
  return parent === undefined || parent.index === body.index ? null : parent;
}

/**
 * The last UT a body's elements answer for, or null when its provider claimed
 * no limit.
 *
 * Only a stated `Until` bounds anything. `Unspecified` does NOT withdraw the
 * body, and that is a deliberate reading of a genuinely awkward arm: it is what
 * a host sends when its horizon resolver FAULTED, and refusing every body on a
 * fault empties the system diagram rather than making it honest. A caller that
 * wants to know the shape has `body.horizon.trajectoryKind` beside this and can
 * refuse a conic renderer on it; what this function will not do is invent a
 * number nobody stated, in either direction.
 */
export function horizonUt(body: CelestialBody): number | null {
  const horizon = body.horizon;
  if (horizon.kind !== PropagationHorizonKind.Until) return null;
  return finite(horizon.untilUt) ? horizon.untilUt : null;
}
