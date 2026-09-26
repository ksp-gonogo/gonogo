import type { OrbitTrajectory } from "@ksp-gonogo/sitrep-client";
import { TrajectoryFrameKindLike } from "@ksp-gonogo/sitrep-client";
import {
  type DepthGradientAxis,
  depthGradientAxis,
  orbitPointAt,
  orbitRingPoints,
  type Placement,
  perifocalToParent,
} from "./projection";
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

export interface PlacedBody extends PlacedPoint {
  body: CelestialBody;
  /** The whole ring as an SVG path in plot units, or null when there is none. */
  ring: string | null;
  ringDepth: DepthGradientAxis | null;
}

export interface PlacedRing {
  ring: string | null;
  ringDepth: DepthGradientAxis | null;
}

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
  children,
  vessel,
  parentName,
  placement,
  plotScale,
}: {
  children: readonly CelestialBody[];
  vessel: VesselOrbit | null | undefined;
  parentName: string;
  placement: Placement;
  plotScale: number;
}): PlacedDiagram {
  const at = (point: readonly [number, number, number]): PlacedPoint => {
    const p = placement.place([point[0], point[1], point[2]]);
    return {
      x: p[0] * plotScale,
      y: p[1] * plotScale,
      depthUnits: p[2] * plotScale,
    };
  };
  const ringOf = (
    sma: number,
    ecc: number,
    lan: number,
    argPe: number,
    inclination: number,
  ): PlacedRing => {
    if (!(sma > 0)) return { ring: null, ringDepth: null };
    const points = orbitRingPoints(sma, ecc, lan, argPe, inclination).map((p) =>
      placement.place(p),
    );
    return {
      ring: closedPath(points, plotScale),
      ringDepth: depthGradientAxis(points, plotScale),
    };
  };
  return {
    parent: at([0, 0, 0]),
    bodies: children.map((c) => {
      const sma = c.semiMajorAxis ?? 0;
      const ecc = c.eccentricity ?? 0;
      const lan = c.lan ?? 0;
      const argPe = c.argumentOfPeriapsis ?? 0;
      const inclination = c.inclination ?? 0;
      return {
        body: c,
        ...at(
          orbitPointAt(sma, ecc, lan, argPe, inclination, c.trueAnomaly ?? 0),
        ),
        ...ringOf(sma, ecc, lan, argPe, inclination),
      };
    }),
    vessel:
      vessel && nameMatches(vessel.parentName, parentName)
        ? {
            ...at(
              orbitPointAt(
                vessel.sma,
                vessel.ecc,
                vessel.lan,
                vessel.argPe,
                vessel.inclination,
                vessel.trueAnomaly,
              ),
            ),
            ...ringOf(
              vessel.sma,
              vessel.ecc,
              vessel.lan,
              vessel.argPe,
              vessel.inclination,
            ),
          }
        : null,
  };
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
 * A sampled arc in the frame it arrived in, put into parent-centred inertial
 * metres, or null when the frame it arrived in is not one this diagram can lift
 * from.
 */
export function liftArc(
  trajectory: Extract<OrbitTrajectory, { shape: "arc" }>,
  vessel: VesselOrbit,
): (readonly [number, number, number])[] | null {
  switch (trajectory.frame.kind) {
    case TrajectoryFrameKindLike.Perifocal:
      return trajectory.points.map((p) =>
        perifocalToParent(
          p.x,
          p.y,
          vessel.lan,
          vessel.argPe,
          vessel.inclination,
          p.z,
        ),
      );
    case TrajectoryFrameKindLike.BodyCentredInertial:
      return trajectory.points.map((p) => [p.x, p.y, p.z]);
    default:
      return null;
  }
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
