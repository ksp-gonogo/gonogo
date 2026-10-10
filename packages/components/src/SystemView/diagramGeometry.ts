import {
  bodyOrbitCurve,
  type OrbitTrajectory,
  type SystemPoses,
  TrajectoryFrameKindLike,
} from "@ksp-gonogo/sitrep-client";
import { type DepthGradientAxis, depthGradientAxis } from "./depthCues";
import { orbitPointAt, orbitRingOf } from "./orbitGeometry";
import type { Placement } from "./projection";
import type { CelestialBody } from "./useCelestialBodies";

export interface VesselOrbit {
  parentName: string;
  sma: number;
  ecc: number;
  /** Longitude of the ascending node, degrees. */
  lan: number;
  /** Argument of periapsis, degrees. */
  argPe: number;
  /** Inclination in degrees: drives the inclination gradient. */
  inclination: number;
  /** True anomaly, degrees. */
  trueAnomaly: number;
}

/** One drawn thing, in plot units, with the depth the projection dropped. */
export interface PlacedPoint {
  x: number;
  y: number;
  /**
   * Distance out of the projection's reference plane, PLOT units. Multiply by
   * the live zoom for screen pixels, which is what a depth cue is read from.
   */
  depthUnits: number;
}

export interface PlacedBody extends PlacedPoint, PlacedRing {
  body: CelestialBody;
}

/** Where an open arc stops, in plot units, and the way it was heading there. */
export interface PlacedRingEnd {
  x: number;
  y: number;
  headingX: number;
  headingY: number;
}

export interface PlacedRing {
  ring: string | null;
  ringDepth: DepthGradientAxis | null;
  /** Set for an open arc only; a closed ring has no end. */
  ringEnd: PlacedRingEnd | null;
}

const NO_RING: PlacedRing = { ring: null, ringDepth: null, ringEnd: null };

export interface PlacedDiagram {
  /** The frame body. At the origin under the inertial projection, elsewhere otherwise. */
  parent: PlacedPoint;
  bodies: PlacedBody[];
  vessel: (PlacedPoint & PlacedRing) | null;
}

/**
 * Every position the diagram draws, from orbital elements in three dimensions, projected and scaled into plot units.
 *
 * Body positions are the wire's measurement while a rotating frame is a Kepler model at the same instant, so any disagreement shows as a small rotation of the frame rather than moving every body.
 */
export function placeDiagram({
  parent,
  children,
  poses,
  vessel,
  parentName,
  placement,
  plotScale,
}: {
  parent: CelestialBody | null;
  children: readonly CelestialBody[];
  poses: SystemPoses | undefined;
  vessel: VesselOrbit | null | undefined;
  parentName: string;
  placement: Placement;
  plotScale: number;
}): PlacedDiagram {
  const vesselHere =
    vessel && nameMatches(vessel.parentName, parentName) ? vessel : null;
  return {
    ...placeBodies({ parent, children, poses, placement, plotScale }),
    vessel:
      vesselHere === null
        ? null
        : {
            ...placeVesselPoint(vesselHere, placement, plotScale),
            ...placeVesselRing(vesselHere, placement, plotScale),
          },
  };
}

function placedPointOf(
  placement: Placement,
  plotScale: number,
  point: readonly [number, number, number],
): PlacedPoint {
  const p = placement.place([point[0], point[1], point[2]]);
  return {
    x: p[0] * plotScale,
    y: p[1] * plotScale,
    depthUnits: p[2] * plotScale,
  };
}

function placedRingOf(
  placement: Placement,
  plotScale: number,
  sma: number,
  ecc: number,
  lan: number,
  argPe: number,
  inclination: number,
): PlacedRing {
  if (!(sma > 0)) return NO_RING;
  const points = orbitRingOf(sma, ecc, lan, argPe, inclination).map((p) =>
    placement.place(p),
  );
  return {
    ring: closedPath(points, plotScale),
    ringDepth: depthGradientAxis(points, plotScale),
    ringEnd: null,
  };
}

/**
 * A body's path as its provider answered it: the closed ring for a conic, the open arc to its horizon for an integrating provider, nothing for a refusal.
 * An arc is already in the parent's inertial metres, so it goes through the placement like any other point.
 */
function placedBodyRing(
  placement: Placement,
  plotScale: number,
  body: CelestialBody,
  parent: CelestialBody | null,
  viewUt: number,
): PlacedRing {
  const curve = bodyOrbitCurve(body, parent, viewUt);
  if (curve === null || curve.shape === "withheld") return NO_RING;
  if (curve.shape === "conic") {
    return placedRingOf(
      placement,
      plotScale,
      body.semiMajorAxis ?? 0,
      body.eccentricity ?? 0,
      body.lan ?? 0,
      body.argumentOfPeriapsis ?? 0,
      body.inclination ?? 0,
    );
  }
  const metres = arcMetres(curve);
  if (metres === null) return NO_RING;
  const points = metres.map((p) => placement.place(p));
  return {
    ring: openPath(points, plotScale),
    ringDepth: depthGradientAxis(points, plotScale),
    ringEnd: ringEndOf(points, plotScale),
  };
}

function ringEndOf(
  points: readonly (readonly [number, number, number])[],
  plotScale: number,
): PlacedRingEnd | null {
  if (points.length < 2) return null;
  const end = points[points.length - 1];
  const before = points[points.length - 2];
  const dx = (end[0] - before[0]) * plotScale;
  const dy = (end[1] - before[1]) * plotScale;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return null;
  return {
    x: end[0] * plotScale,
    y: end[1] * plotScale,
    headingX: dx / length,
    headingY: dy / length,
  };
}

/**
 * Each drawn child's ring, in `children` order.
 *
 * A ring is a path, not a place: it depends on the catalogue, the projection and, for an integrated body's open arc, the instant the arc is read from. It does not move with each frame's pose, so a caller holds it across them and asks again only when `viewUt` is allowed to have moved.
 */
export function placeBodyRings({
  parent,
  children,
  placement,
  plotScale,
  viewUt,
}: {
  parent: CelestialBody | null;
  children: readonly CelestialBody[];
  placement: Placement;
  plotScale: number;
  viewUt: number;
}): PlacedRing[] {
  return children.map((c) =>
    placedBodyRing(placement, plotScale, c, parent, viewUt),
  );
}

/** The frame body and every drawn child with its ring: independent of the vessel, so a vessel tick does not re-place them. */
export function placeBodies({
  parent: parentBody,
  children,
  poses,
  placement,
  plotScale,
  rings = placeBodyRings({
    parent: parentBody,
    children,
    placement,
    plotScale,
    viewUt: poses?.ut ?? 0,
  }),
}: {
  parent: CelestialBody | null;
  children: readonly CelestialBody[];
  poses: SystemPoses | undefined;
  placement: Placement;
  plotScale: number;
  /** Rings placed earlier, which a caller that re-places on every pose passes so only the points move. */
  rings?: readonly PlacedRing[];
}): { parent: PlacedPoint; bodies: PlacedBody[] } {
  return {
    parent: placedPointOf(placement, plotScale, [0, 0, 0]),
    bodies: children.map((c, i) => {
      const sma = c.semiMajorAxis ?? 0;
      const ecc = c.eccentricity ?? 0;
      const lan = c.lan ?? 0;
      const argPe = c.argumentOfPeriapsis ?? 0;
      const inclination = c.inclination ?? 0;
      return {
        body: c,
        ...placedPointOf(
          placement,
          plotScale,
          orbitPointAt(
            sma,
            ecc,
            lan,
            argPe,
            inclination,
            poses?.poseByIndex[c.index]?.trueAnomaly ?? 0,
          ),
        ),
        ...rings[i],
      };
    }),
  };
}

/** The vessel's ring, which depends on its elements and not on where it is along them. */
export function placeVesselRing(
  vessel: Pick<VesselOrbit, "sma" | "ecc" | "lan" | "argPe" | "inclination">,
  placement: Placement,
  plotScale: number,
): PlacedRing {
  return placedRingOf(
    placement,
    plotScale,
    vessel.sma,
    vessel.ecc,
    vessel.lan,
    vessel.argPe,
    vessel.inclination,
  );
}

/** The vessel's own position, the only vessel placement that moves with the true anomaly. */
export function placeVesselPoint(
  vessel: VesselOrbit,
  placement: Placement,
  plotScale: number,
): PlacedPoint {
  return placedPointOf(
    placement,
    plotScale,
    orbitPointAt(
      vessel.sma,
      vessel.ecc,
      vessel.lan,
      vessel.argPe,
      vessel.inclination,
      vessel.trueAnomaly,
    ),
  );
}

/** A closed polyline through placed points, in plot units. */
export function closedPath(
  points: readonly (readonly [number, number, number])[],
  plotScale: number,
): string | null {
  if (points.length < 2) return null;
  let d = "";
  for (let i = 0; i < points.length; i++) {
    d += `${i === 0 ? "M" : "L"}${points[i][0] * plotScale},${points[i][1] * plotScale}`;
    if (i < points.length - 1) d += " ";
  }
  return `${d} Z`;
}

/** An open polyline through placed points, in plot units: a bounded arc is never closed. */
export function openPath(
  points: readonly (readonly [number, number, number])[],
  plotScale: number,
): string {
  return points
    .map(
      (p, i) => `${i === 0 ? "M" : "L"}${p[0] * plotScale},${p[1] * plotScale}`,
    )
    .join(" ");
}

/**
 * A sampled arc's points as parent-centred inertial metres, or null when it arrived in any other frame: this diagram places metres, and an arc already moved into a read frame is not.
 */
export function arcMetres(
  trajectory: Extract<OrbitTrajectory, { shape: "arc" }>,
): (readonly [number, number, number])[] | null {
  if (trajectory.frame.kind !== TrajectoryFrameKindLike.BodyCentredInertial) {
    return null;
  }
  return trajectory.points.map((p) => [p.x, p.y, p.z]);
}

export function organise(
  bodies: readonly CelestialBody[],
  parentName: string,
): {
  parent: CelestialBody | null;
  children: CelestialBody[];
  maxRadius: number;
} {
  // Case- and whitespace-insensitive: body names arrive with inconsistent casing and padding.
  const target = parentName.trim().toLowerCase();
  const norm = (s: string | null) => (s ? s.trim().toLowerCase() : null);
  const parent = bodies.find((b) => norm(b.name) === target) ?? null;
  const children = bodies.filter((b) => norm(b.referenceBody) === target);
  return { parent, children, maxRadius: maxApoapsis(children) };
}

/** The furthest any of `children` swings from the parent, metres, with eccentricity capped short of an open orbit. */
export function maxApoapsis(children: readonly CelestialBody[]): number {
  let maxRadius = 0;
  for (const c of children) {
    const ecc = Math.min(Math.max(c.eccentricity ?? 0, 0), 0.999);
    const apo = (c.semiMajorAxis ?? 0) * (1 + ecc);
    if (apo > maxRadius) maxRadius = apo;
  }
  return maxRadius;
}

/** Room the auto-fit view keeps between the outermost orbit and the viewBox edge, px. */
const DIAGRAM_PAD = 20;

/**
 * Metres to SVG user units at zoom 1: the projection's fixed half-extent when
 * it states one, otherwise the outermost body orbit or the vessel's own apoapsis
 * in the frame, whichever reaches further.
 */
export function diagramPlotScale({
  width,
  height,
  extent,
  maxRadius,
  vessel,
  parentName,
}: {
  width: number;
  height: number;
  extent: Placement["extent"];
  maxRadius: number;
  vessel: { parentName: string; sma: number; ecc: number } | null | undefined;
  parentName: string;
}): number {
  const baseRadius = Math.min(width, height) / 2 - DIAGRAM_PAD;
  if (extent.kind === "fixed-units") {
    return extent.units > 0 ? baseRadius / extent.units : 1;
  }
  const effectiveMax = Math.max(
    maxRadius,
    vessel && nameMatches(vessel.parentName, parentName)
      ? vessel.sma * (1 + Math.min(vessel.ecc, 0.999))
      : 0,
  );
  return effectiveMax > 0 ? baseRadius / effectiveMax : 1;
}

export function nameMatches(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
