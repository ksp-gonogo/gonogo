import { PerfBudget } from "@ksp-gonogo/core";
import {
  type CelestialFacts,
  type FrameInstant,
  frameInstantAt,
  fromFrame,
  type ReadFrameChoice,
  type SystemInstant,
  systemInstantAt,
  TRAJECTORY_SCALE_CONVENTIONS,
  type TrajectoryFrame,
  toFrame,
  trajectoryFrameKindFor,
  type Vector3,
} from "@ksp-gonogo/sitrep-client";

/**
 * Where SystemView's arithmetic lives, in three dimensions, and how the frame it
 * draws in gets chosen.
 *
 * The arithmetic is three-dimensional all the way through, and the projection to
 * two dimensions happens ONCE, at the point a coordinate becomes an SVG
 * attribute. Flattening any earlier is what makes a frame transform impossible
 * rather than merely absent: solving `r(theta)` in the orbit plane and rotating
 * it by `lan + argPe` in two dimensions is the inclination-zero case of the real
 * rotation and nothing else, and a rotation into a pair-rotating frame is a
 * rotation about an arbitrary axis, which there is no way to perform inside a
 * plane the third component has already been dropped from.
 *
 * The dropped component is not discarded. It is the depth the diagram colours
 * with, which is a different fact from inclination: a body at its ascending node
 * has no depth however inclined its orbit is, so a cue encoding inclination is
 * describing the orbit rather than the body.
 */

/**
 * Body placements computed, per second.
 *
 * <b>Sized against the existing frame budget's blind spot, not beside it.</b>
 * `Reference frame states computed/sec` records once per CALL to
 * `systemInstantAt`, so a thirty-four-body solve costs it one; at 60 Hz that
 * reads 60 against a 20,000 threshold, which is 0.3% and cannot see a diagram
 * placing every body on every frame. This one records once per PLACEMENT, which
 * is the quantity that actually grows.
 *
 * Steady state is one diagram placing its bodies, their rings, the craft and its
 * curve once per one-second UT bucket: a full stock system is roughly
 * 34 * (1 + {@link ORBIT_RING_SAMPLES}) placements, about 3,300/sec, and two
 * SystemViews on one dashboard about 6,600. The regression it exists to catch is
 * placement moving out of the UT-bucket memo and onto the render, and SystemView
 * re-renders at requestAnimationFrame rate because `useUtNow` sets state on
 * `clock.onFrame`: that is ~198,000/sec for one diagram. The threshold sits
 * 7x above steady state and 8x below the regression.
 *
 * Those two readings are only distinguishable because the bucket is floored on
 * WALL-CLOCK time, in `createUtBucketThrottle`. Keyed on game seconds alone the
 * bucket changes every frame from 60x warp upward, so ordinary warp produced the
 * regression figure on its own and the budget could not tell warp from a
 * genuine regression. If that throttle is ever removed, this budget stops
 * measuring what it says it measures.
 */
const SYSTEM_PLACEMENT_BUDGET = new PerfBudget({
  name: "SystemView body placements/sec",
  threshold: 25_000,
  windowMs: 1000,
  unit: "placements",
});

/**
 * How many points a drawn orbit ring is sampled into.
 *
 * A ring cannot be an SVG `<ellipse>` any more. An ellipse is the shape a closed
 * orbit has in its own plane; in a rotating frame the same orbit is a rosette,
 * and under an honest projection even a circular inclined orbit is an ellipse
 * with a different centre from the one `cx`/`cy` can express. So every ring is a
 * sampled polyline, including under the identity projection, because a second
 * rendering strategy for one case is a case that stops being exercised.
 *
 * 96 samples is chosen against pixels rather than taste: a polyline through 96
 * points on an ellipse departs from the true curve by about `(pi/96)^2 / 2` of
 * the semi-major axis, which on a 300px orbit is 0.16px.
 */
export const ORBIT_RING_SAMPLES = 96;

/** Degrees to radians. */
const RAD = Math.PI / 180;

function clampEcc(eccentricity: number): number {
  return Math.min(Math.max(eccentricity, 0), 0.999);
}

/**
 * A point on a Keplerian orbit, in the parent's own inertial frame, metres.
 *
 * The full perifocal-to-inertial rotation: argument of periapsis about the orbit
 * normal, then inclination about the line of nodes, then longitude of the
 * ascending node about the reference pole. At zero inclination it reduces
 * exactly to the single `lan + argPe` rotation the flat version performed, which
 * is why the identity projection of a flat system is the picture that was there
 * before.
 */
export function orbitPointAt(
  sma: number,
  eccentricity: number,
  lanDeg: number,
  argPeDeg: number,
  inclinationDeg: number,
  trueAnomalyDeg: number,
): Vector3 {
  const e = clampEcc(eccentricity);
  const theta = trueAnomalyDeg * RAD;
  const r = (sma * (1 - e * e)) / (1 + e * Math.cos(theta));
  return perifocalToParent(
    r * Math.cos(theta),
    r * Math.sin(theta),
    lanDeg,
    argPeDeg,
    inclinationDeg,
  );
}

/**
 * A perifocal offset (periapsis on `+x`, motion toward `+y`, the orbit normal on
 * `+z`) in the parent's inertial frame, metres.
 *
 * The third component is not always zero. An integrated arc leaves the
 * osculating plane, and that is exactly the departure a reader wants to see:
 * dropping it would flatten an n-body curve into the ellipse it is tangent to
 * and say nothing about having done so.
 */
export function perifocalToParent(
  xPerifocal: number,
  yPerifocal: number,
  lanDeg: number,
  argPeDeg: number,
  inclinationDeg: number,
  zPerifocal = 0,
): Vector3 {
  const lan = lanDeg * RAD;
  const argPe = argPeDeg * RAD;
  const inc = inclinationDeg * RAD;
  const cosW = Math.cos(argPe);
  const sinW = Math.sin(argPe);
  const cosO = Math.cos(lan);
  const sinO = Math.sin(lan);
  const cosI = Math.cos(inc);
  const sinI = Math.sin(inc);
  // Rotate by argPe in the orbit plane first, so what follows is the standard
  // node-line tilt applied to a point measured from the ascending node.
  const xn = xPerifocal * cosW - yPerifocal * sinW;
  const yn = xPerifocal * sinW + yPerifocal * cosW;
  return [
    xn * cosO - yn * sinO * cosI + zPerifocal * sinO * sinI,
    xn * sinO + yn * cosO * cosI - zPerifocal * cosO * sinI,
    yn * sinI + zPerifocal * cosI,
  ];
}

/**
 * The whole ring of an orbit, in the parent's inertial frame, metres.
 *
 * Sampled uniformly in eccentric anomaly rather than in true anomaly, so an
 * eccentric orbit gets its points spread along the arc instead of piling them up
 * at apoapsis where the curve is straightest and needs them least.
 */
export function orbitRingPoints(
  sma: number,
  eccentricity: number,
  lanDeg: number,
  argPeDeg: number,
  inclinationDeg: number,
  samples: number = ORBIT_RING_SAMPLES,
): Vector3[] {
  const e = clampEcc(eccentricity);
  const b = sma * Math.sqrt(1 - e * e);
  const points: Vector3[] = [];
  for (let i = 0; i <= samples; i++) {
    const anomaly = (2 * Math.PI * i) / samples;
    points.push(
      perifocalToParent(
        sma * (Math.cos(anomaly) - e),
        b * Math.sin(anomaly),
        lanDeg,
        argPeDeg,
        inclinationDeg,
      ),
    );
  }
  return points;
}

// ── The projection contribution ───────────────────────────────────────────

/**
 * How the diagram sizes itself in a projection's own coordinates.
 *
 * A total union rather than an optional field, because the alternative is the
 * host branching on whether an extent was supplied, and a host branching on
 * presence is the defect this slot exists to remove wearing different clothes.
 * The stock projection states `auto-fit-metres` out loud; it is not the absence
 * of a statement.
 */
export type SystemProjectionExtent =
  /**
   * Fit the drawn orbits, measured in metres about the diagram's own frame body.
   * Valid for any projection whose origin is that body and whose lengths are
   * metres.
   */
  | { kind: "auto-fit-metres" }
  /**
   * A fixed half-extent in the projection's own units, for a projection whose
   * coordinates are not metres (a pulsating frame's are ratios) or whose origin
   * is somewhere other than the diagram's frame body.
   */
  | { kind: "fixed-units"; units: number };

/**
 * One frame SystemView will draw its whole picture in.
 *
 * <b>Plain data, and a `ReadFrameChoice` rather than a transform.</b> A
 * `(position, ut) => position` closure was the obvious shape and it is the wrong
 * one: it loses invertibility, so hit-testing and pan have no inverse; it loses
 * the linear part, so an offset cannot be composed once for a whole arc; it
 * cannot hoist the frame state out of the per-point loop, which is the entire
 * cost; and a fresh closure per telemetry frame defeats the reference-equality
 * comparison that decides whether the contribution changed. A choice the host
 * resolves through `frameInstantAt` has none of those properties, and every
 * frame that arithmetic builds is a similarity, so `fromFrame` is already the
 * inverse.
 */
export interface SystemViewProjection {
  /** Stable id. The operator's pinned choice is stored as this. */
  id: string;
  /** What an operator calls it. A picture, not a taxonomy. */
  label: string;
  /** The frame, for the host to resolve at the instant it is drawing. */
  choice: ReadFrameChoice;
  extent: SystemProjectionExtent;
  /**
   * The body the diagram must be CENTRED on for this projection to be one of the
   * pictures it can draw.
   *
   * Stated by the contributor rather than inferred by the host from `choice`,
   * because the inference is different for every frame kind: a body-centred frame
   * applies to its own body, and a pulsating frame applies to the diagram centred
   * on either half of its pair. A host working that out from the frame kind is a
   * host branching on frame kind, which is the thing this slot exists so that
   * nobody has to do.
   */
  frameBodyIndex: number;
}

declare module "@ksp-gonogo/core" {
  interface ContributionRegistry {
    "system-view.projection": {
      entry: SystemViewProjection;
      topics: "system.bodies";
    };
  }
}

// ── Resolving one ─────────────────────────────────────────────────────────

/** The id of the frame every representation of a system was always in, now named. */
export function inertialProjectionId(frameBodyIndex: number): string {
  return `system-view.inertial.${frameBodyIndex}`;
}

/** The id of the frame that holds the diagram's frame body and its parent still. */
export function parentDirectionProjectionId(frameBodyIndex: number): string {
  return `system-view.parent-direction.${frameBodyIndex}`;
}

/**
 * The projections the host offers for one body it might be centred on.
 *
 * <b>Stock registers its own frame, so there is no "no frame" to branch on.</b>
 * Parent-centred inertial always WAS a frame; it was simply never named, and
 * leaving it unnamed is what forced every downstream question to be asked as
 * "is there a projection" rather than "which one". Naming it means the seam is
 * travelled on a bare install with no Uplinks at all, and a mechanism only
 * exercised when a third party shows up is a mechanism that rots.
 *
 * Contributed per BODY rather than per widget, because a contribution's
 * `compute` is a pure function of Topics and which body the diagram is centred on
 * is a widget config value, not a Topic. The host filters to the entries whose
 * `frameBodyIndex` matches the picture it is drawing, which is the same filter it
 * applies to a third party's entries.
 */
export function projectionsForBody(
  frameBodyIndex: number,
  hasParent: boolean,
): SystemViewProjection[] {
  const entries: SystemViewProjection[] = [
    {
      id: inertialProjectionId(frameBodyIndex),
      label: "Hold the sky still (the ordinary view)",
      choice: { kind: "body-centred-inertial", bodyIndex: frameBodyIndex },
      extent: { kind: "auto-fit-metres" },
      frameBodyIndex,
    },
  ];
  // The root star has no parent to hold still, and offering the option would put
  // a frame in the picker that cannot be formed.
  if (hasParent) {
    entries.push({
      id: parentDirectionProjectionId(frameBodyIndex),
      label: "Hold the parent still (transfer windows)",
      choice: { kind: "parent-direction", bodyIndex: frameBodyIndex },
      extent: { kind: "auto-fit-metres" },
      frameBodyIndex,
    });
  }
  return entries;
}

/**
 * A projection resolved at one instant: the transform both ways, and what the
 * diagram needs to know about the coordinates it is about to draw in.
 *
 * The two `FrameInstant`s are held rather than closed over so the frame work is
 * paid once for a whole picture. `place` is the composition of "back to
 * root-centred inertial from the diagram's own body-centred frame" with "into
 * the chosen frame", which under the identity projection is the same frame
 * twice: the origin is added and subtracted, and the picture is the one that was
 * there before to within the last bit of a double.
 */
export interface ResolvedProjection extends Placement {
  id: string;
  /** What the caption says the picture is drawn in. */
  frame: TrajectoryFrame;
  /** Whether a coordinate in this projection is a length at all. */
  lengthsPulsate: boolean;
}

/**
 * What the diagram actually draws through: the transform both ways, and how to
 * size the picture.
 *
 * The diagram takes one of these rather than a nullable projection, so no draw
 * site asks whether a projection exists. There is exactly ONE coalesce, at the
 * top of the diagram, and what it coalesces to is a NAMED frame rather than an
 * absence: {@link INERTIAL_PLACEMENT} is the parent-centred inertial frame the
 * stock entry registers, which is the frame the diagram's own coordinates are
 * already in.
 */
export interface Placement {
  place(parentCentred: Vector3): Vector3;
  unplace(projected: Vector3): Vector3;
  extent: SystemProjectionExtent;
}

/**
 * The frame the diagram's own coordinates arrive in, as a placement.
 *
 * Used when the catalogue cannot form the frame that was asked for: a body it
 * has not carried yet, or a chain it cannot solve. Drawing in the coordinates
 * the positions are already expressed in is the only reading that is not a
 * guess, and the widget says which frame it drew in beside the picture, so a
 * refusal is visible rather than silent.
 */
export const INERTIAL_PLACEMENT: Placement = {
  place: (p) => p,
  unplace: (p) => p,
  extent: { kind: "auto-fit-metres" },
};

/**
 * The frame {@link INERTIAL_PLACEMENT} draws in, so the caption can name it.
 *
 * Beside the placement rather than inferred at the caption, because the two have
 * to agree: a picture drawn in a fallback frame with no name on it is exactly the
 * silence this whole change is about, one layer down.
 */
export function inertialFrameFor(frameBodyIndex: number): TrajectoryFrame {
  return {
    kind: trajectoryFrameKindFor("body-centred-inertial"),
    centreBodyIndex: frameBodyIndex,
    lengthsPulsate: false,
    scaleConvention: TRAJECTORY_SCALE_CONVENTIONS.metres,
  };
}

/**
 * The projection in force, at `ut`, or null when the catalogue cannot form it.
 *
 * Null is a refusal to draw in the asked-for frame, not a licence to draw in
 * another one: the caller says so on screen. It happens for a frame body the
 * catalogue has not carried yet, for the root star asked for a frame that needs
 * a parent, and for a pair whose separation is degenerate.
 */
export function resolveProjection(
  facts: CelestialFacts | undefined,
  frameBodyIndex: number | undefined,
  entry: SystemViewProjection | null,
  ut: number | null,
): ResolvedProjection | null {
  if (
    facts === undefined ||
    frameBodyIndex === undefined ||
    entry === null ||
    ut === null ||
    !Number.isFinite(ut)
  ) {
    return null;
  }
  const system: SystemInstant = systemInstantAt(facts, ut);
  // The diagram's own frame, as a frame. Every position the diagram holds is
  // measured from its frame body, so this is the one that turns those into
  // root-centred inertial coordinates the chosen frame can accept.
  const diagram = frameInstantAt(
    facts,
    { kind: "body-centred-inertial", bodyIndex: frameBodyIndex },
    ut,
    system,
  );
  const chosen = frameInstantAt(facts, entry.choice, ut, system);
  if (diagram === null || chosen === null) return null;
  const sides = frameSidesOf(facts, entry.choice);
  return {
    id: entry.id,
    place: (parentCentred) => placeThrough(diagram, chosen, parentCentred),
    unplace: (projected) => placeThrough(chosen, diagram, projected),
    extent: entry.extent,
    lengthsPulsate:
      chosen.scaleConvention !== TRAJECTORY_SCALE_CONVENTIONS.metres,
    frame: {
      kind: trajectoryFrameKindFor(entry.choice.kind),
      centreBodyIndex: entry.choice.bodyIndex ?? frameBodyIndex,
      lengthsPulsate:
        chosen.scaleConvention !== TRAJECTORY_SCALE_CONVENTIONS.metres,
      primaryBodyIndex: sides?.primary,
      secondaryBodyIndex: sides?.secondary,
      scaleConvention: chosen.scaleConvention,
      unitLength: chosen.unitLength,
    },
  };
}

/**
 * A position expressed in `from`'s coordinates, re-expressed in `to`'s.
 *
 * One helper for both directions, because the inverse of a similarity composed
 * with a similarity is the same composition with the arguments swapped, and
 * writing the inverse out again is how the two drift apart.
 */
function placeThrough(
  from: FrameInstant,
  to: FrameInstant,
  position: Vector3,
): Vector3 {
  SYSTEM_PLACEMENT_BUDGET.record();
  return toFrame(to, fromFrame(from, position)).position;
}

/**
 * The pair a frame is named for, as single indices, for the caption.
 *
 * `frameSides` answers with the SETS a pulsating frame really turns about, and
 * the caption names the head of each: a Kerbol-Kerbin frame is called that even
 * though its primary side is Kerbol with Moho and Eve on it.
 */
function frameSidesOf(
  facts: CelestialFacts,
  choice: ReadFrameChoice,
): { primary: number; secondary: number } | null {
  if (choice.kind === "body-centred-inertial") return null;
  const bodyIndex = choice.bodyIndex;
  if (bodyIndex == null) return null;
  const body = facts.bodies.find((b) => b.index === bodyIndex);
  const parentName = body?.referenceBody;
  if (parentName == null) return null;
  const parentIndex = facts.indexByName[parentName];
  if (parentIndex === undefined) return null;
  // `parent-direction` is centred on the selected body with its parent held out
  // in front, so the selected body is the primary; a pulsating frame is named
  // for the pair the other way about. Faithful to the producer's own naming
  // rather than made to agree, because a frame nobody can switch to is worse
  // than two names that read in opposite orders.
  return choice.kind === "parent-direction"
    ? { primary: bodyIndex, secondary: parentIndex }
    : { primary: parentIndex, secondary: bodyIndex };
}

// ── Depth ─────────────────────────────────────────────────────────────────

/**
 * How far out of the reference plane something has to be, in SCREEN pixels,
 * before its depth cue reads at full strength.
 *
 * Screen pixels rather than plot units, so the cue tracks what is actually
 * visible: an orbit whose tilt amounts to one pixel on a whole-system view reads
 * flat there, and reads tilted once the operator has zoomed in far enough for
 * the pixel to become thirty. That is the honest answer in both pictures, and a
 * cue read off the inclination ANGLE cannot give it: that paints Moho's seven
 * degrees at full colour on a diagram where the tilt is under a pixel.
 */
const DEPTH_FULL_SCALE_PX = 40;

/** Above the reference plane. */
export const DEPTH_ABOVE_COLOUR = "rgb(230, 90, 90)";
/** In it. */
export const DEPTH_LEVEL_COLOUR = "rgb(160, 160, 170)";
/** Below it. */
export const DEPTH_BELOW_COLOUR = "rgb(80, 130, 230)";

/** How strongly a depth of `depthPx` screen pixels should read, 0 to 1. */
export function depthStrength(depthPx: number): number {
  return Math.min(Math.abs(depthPx) / DEPTH_FULL_SCALE_PX, 1);
}

/** Which side of the reference plane `depthPx` is, as a colour. */
export function depthColour(depthPx: number): string {
  if (depthPx > 0) return DEPTH_ABOVE_COLOUR;
  if (depthPx < 0) return DEPTH_BELOW_COLOUR;
  return DEPTH_LEVEL_COLOUR;
}

export interface DepthGradientAxis {
  /** Gradient start, in plot units: where the curve is deepest below the plane. */
  x1: number;
  y1: number;
  /** Gradient end: where it is highest above it. */
  x2: number;
  y2: number;
  /**
   * Half the depth spread along the curve, in PLOT units. The caller multiplies
   * by the live zoom to get screen pixels, which is what the strength is read
   * from: keeping zoom out of here is what lets a whole picture's placement be
   * memoised across a wheel gesture.
   */
  depthUnits: number;
}

/**
 * The axis a curve's depth varies along, taken from the curve itself.
 *
 * <b>This is where the change from inclination to depth actually happens.</b> The
 * old gradient ran perpendicular to the line of nodes with a strength read off
 * the inclination angle, which describes the ORBIT. This runs between the
 * projected positions of the curve's own deepest and highest samples with a
 * strength read off how far apart they are on screen, which describes the CURVE:
 * a path that dives below the plane and comes back reads that way, and a path
 * that is nowhere near the plane's crossing reads uniformly.
 *
 * Derived from the samples rather than from elements, so it holds for a rosette
 * in a rotating frame exactly as it holds for an ellipse. For a Keplerian ring
 * under the identity projection it recovers the node-perpendicular axis,
 * because that is where a Keplerian ring's depth extremes are.
 */
export function depthGradientAxis(
  points: readonly Vector3[],
  plotScale: number,
): DepthGradientAxis | null {
  if (points.length === 0) return null;
  let lowest = points[0];
  let highest = points[0];
  for (const p of points) {
    if (p[2] < lowest[2]) lowest = p;
    if (p[2] > highest[2]) highest = p;
  }
  const spread = highest[2] - lowest[2];
  if (!(spread > 0)) return null;
  return {
    x1: lowest[0] * plotScale,
    y1: lowest[1] * plotScale,
    x2: highest[0] * plotScale,
    y2: highest[1] * plotScale,
    depthUnits: (spread / 2) * plotScale,
  };
}
