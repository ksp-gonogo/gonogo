/**
 * What a trajectory IS, as a drawable answer, decided from what the elected
 * propagation provider said rather than from the elements alone.
 *
 * ## Why this is not a widget's decision
 *
 * `vessel.orbit` carries orbital elements and, riding with them, a
 * `PropagationHorizon` whose two halves answer two different questions: `kind`
 * answers REACH (how far may these be extrapolated) and `trajectoryKind`
 * answers SHAPE (is a conic the right renderer at all). Neither implies the
 * other, which is the whole reason both are on the wire: an integrating
 * provider in a low-perturbation regime honestly reports an unbounded horizon,
 * and a client reasoning "unbounded, therefore analytic, therefore an ellipse
 * is fine" draws a closed conic for a path the craft will not fly.
 *
 * A widget holding `sma` and `ecc` can produce an ellipse without asking
 * anything, and one that does has answered the shape question for itself. The
 * provider then cannot be swapped, because electing a different one changes
 * nothing the operator sees. This function is the one place the question is
 * answered, so that swapping the provider moves the picture.
 *
 * ## What it hands back
 *
 * Three answers, and the caller renders whichever it gets. A conic answer says
 * a conic renderer is exactly right, so the caller draws one from the elements
 * it already holds: that is the provider's business, not a bypass, because the
 * provider is what said so. An arc answer is a sampled polyline the caller
 * draws as given. A withheld answer is a refusal with a reason the caller can
 * put on screen; it is never an empty path, because "here is a trajectory with
 * no points in it" and "there is no trajectory to draw" read identically on a
 * diagram and mean opposite things.
 */

import { PerfBudget } from "../perf/PerfBudget";
import { finite } from "./catalogue-elements";
import type { CelestialBody, CelestialFacts } from "./celestial-facts";
import {
  canPropagate,
  horizonUtOf,
  type OrbitElements,
  type PropagationHorizonLike,
  rotatePerifocalToInertial,
  solveAnomalies,
  TrajectoryKindLike,
  type Vec3Tuple,
} from "./kepler";
import { buildElements, type WireOrbitElements } from "./kepler-reckoning";
import { orbitalPeriod } from "./propagation";
import {
  frameInstantAt,
  frameSides,
  type ReadFrameChoice,
  systemInstantAt,
  TRAJECTORY_SCALE_CONVENTIONS,
  type TrajectoryScaleConvention,
  toFrame,
} from "./reference-frame";

/**
 * A point on a drawable trajectory: where, and when.
 *
 * **Three dimensions and an instant, never a flat `{x, y}`.** A point in the
 * orbit's own plane with periapsis on +x is what a sampled conic has, and a
 * curve re-expressed in a read frame leaves that plane: in a rotating frame it
 * has no central body to be measured from at all. `z` is the out-of-plane
 * component and is zero exactly while the curve is still in its own plane.
 * `ut` is on the point because a reader interpolating between two of them needs
 * to know which side of a burn it is on.
 *
 * `x`/`y` stay first and stay in the same units and orientation, so a diagram
 * that only knows how to draw a plane keeps working against it unedited.
 */
export interface TrajectoryPoint {
  x: number;
  y: number;
  z: number;
  ut: number;
}

/**
 * Which frame a set of points is expressed in. A client-side vocabulary: the
 * points are sampled and re-expressed here, never read off the wire.
 *
 * @category Frames of reference
 */
export const TrajectoryFrameKindLike = {
  Unspecified: 0,
  Perifocal: 1,
  BodyCentredInertial: 2,
  BodyCentredRotating: 3,
  BodyCentredParentDirection: 4,
  RotatingPulsating: 5,
} as const;
export type TrajectoryFrameKindLike =
  (typeof TrajectoryFrameKindLike)[keyof typeof TrajectoryFrameKindLike];

/**
 * The frame a drawn curve is in, carried on an arc so a widget names it rather
 * than assuming it. Build one yourself for a frame your own drawing sets, and
 * name it with {@link trajectoryFrameLabel}.
 *
 * @category Frames of reference
 */
export interface TrajectoryFrame {
  kind: TrajectoryFrameKindLike;
  /** Index into `system.bodies` of the frame's centre, when it has one. */
  centreBodyIndex?: number;
  /** True when the frame's lengths are not lengths, so a readout says so rather than showing a number. */
  lengthsPulsate: boolean;
  /**
   * The two bodies the frame is named for, when it is named for a pair. The
   * first is the one held at the far end of the first axis.
   */
  primaryBodyIndex?: number;
  secondaryBodyIndex?: number;
  /**
   * How to read a coordinate in this frame. Absent means metres; only a
   * pulsating read frame says otherwise, and it says so rather than leaving a
   * reader to infer it from `lengthsPulsate`.
   */
  scaleConvention?: TrajectoryScaleConvention;
  /**
   * What a pulsating frame divided by at the view instant, metres. A caller
   * wanting a length in metres-as-of-now multiplies by this; a caller quoting a
   * coordinate as a distance without it is quoting a ratio.
   */
  unitLength?: number;
}

/**
 * Why a curve stops where it stops.
 *
 * Never absent, because the failure it prevents is that a prediction which stops
 * short and a trajectory which ends look identical on a diagram. A renderer puts
 * a visible MARK at the far end either way; this says which sentence goes with
 * it, and the two are different: one is where our authority ran out, the other
 * is a drawing convention that refuses to retrace a lap it cannot promise.
 */
export type ArcFarEnd =
  /** The last instant the provider vouched for. */
  | "horizon"
  /** One full revolution, past which a second lap would assert a closure osculating elements cannot promise. */
  | "revolution";

/** Why nothing may be drawn. Each is a distinct sentence a readout can say; collapsing them would hide which one happened. */
export type TrajectoryWithheldReason =
  /** No provider stated a horizon. Silence must not render as health. */
  | "no-horizon-stated"
  /** The view instant is past the bound the provider named. */
  | "past-horizon"
  /** The provider stated reach but not shape, so a conic is not known to be right. */
  | "shape-not-stated"
  /** These osculating elements cannot be sampled into an arc. */
  | "no-arc-available"
  /**
   * There is a curve, and the frame asked for could not be formed from the
   * bodies the catalogue carries: a body it has not sent yet, a rotating frame
   * asked for on the root star, or a pair whose separation is degenerate.
   *
   * Distinct from every reason above because the propagation is FINE. Drawing
   * the curve in whatever frame it arrived in would answer a question nobody
   * asked, and in a rotating frame the difference is the whole shape of the
   * path rather than an offset.
   */
  | "frame-unavailable";

/**
 * How a craft's path may be drawn at the instant on screen, from
 * {@link useOrbitTrajectory}: as a conic from its elements, as the sampled arc
 * the provider vouched for, or not at all.
 *
 * A `withheld` answer carries its reason. Show it where the curve would be: it
 * is a statement about what the provider vouched for, not a missing value.
 *
 * @category Frames of reference
 */
export type OrbitTrajectory =
  | {
      /**
       * A closed-form conic. Draw one from the elements: they ARE the curve,
       * for as long as the horizon allows.
       */
      shape: "conic";
    }
  | {
      /**
       * A sampled path. Draw the points and nothing beyond them: this is the
       * span the provider vouched for, and extending it is inventing.
       */
      shape: "arc";
      points: readonly TrajectoryPoint[];
      /** The window the arc spans, so a caller can say how far ahead it reaches. */
      fromUt: number;
      toUt: number;
      /** Which frame `points` are in, so a widget can name it rather than assume it. */
      frame: TrajectoryFrame;
      /** What `toUt` is: see `ArcFarEnd`. */
      farEnd: ArcFarEnd;
    }
  | {
      shape: "withheld";
      reason: TrajectoryWithheldReason;
      /**
       * What kind of answer was refused, when the provider said. Present so a
       * readout can distinguish an integrator that has not computed this far yet
       * (which resolves on its own) from an analytic provider claiming a bound
       * (which is a producer bug that does not).
       */
      trajectoryKind?: TrajectoryKindLike;
    };

/** The arc arm of {@link OrbitTrajectory}, named so the functions that only ever produce one can say so. */
export type TrajectoryArcAnswer = Extract<OrbitTrajectory, { shape: "arc" }>;

export interface OrbitTrajectoryInput {
  /**
   * The `vessel.orbit` reading, in wire units. Deliberately the whole sample
   * rather than pre-normalized elements: the horizon and the elements it bounds
   * share one `validAt`, and a caller that could pass them separately could
   * pass one sample's elements with another's horizon and draw a curve
   * authorised by the wrong sample, silently.
   */
  orbit: WireOrbitElements & {
    /** `undefined` only for a producer that dropped the field, which the gate refuses. */
    horizon?: PropagationHorizonLike;
    /**
     * The `system.bodies` index the elements are measured against. Needed only
     * to re-express the curve into a read frame, because that is the one thing
     * here that has to know where the curve sits in the system rather than only
     * its shape.
     */
    referenceBodyIndex?: number;
  };
  /** The instant on screen, which is the instant the operator's question is about. */
  viewUt: number;
  /** Points along a sampled arc. Default 128, the same density the orbit patches use. */
  samples?: number;
  /**
   * The frame the CALLER wants the curve in, and the catalogue to build it
   * from. Absent leaves the curve in whatever frame it was computed in, which
   * is what every caller did before read frames existed.
   *
   * A read frame is a coordinate change and nothing else: it cannot move
   * anything in the game, so two widgets may pick different ones with no
   * arbitration between them, and a station screen picking one changes nothing
   * on the main screen.
   */
  readFrame?: {
    choice: ReadFrameChoice;
    facts: CelestialFacts;
  };
}

const DEFAULT_ARC_SAMPLES = 128;

/**
 * Points put through the frame transform, per second.
 *
 * Steady state is four widgets reading a 256-point curve at 1 Hz, about 1,000/s.
 * The regression this catches is a widget transforming on every render instead
 * of on new data, which at 60 Hz is ~61,000/s. The threshold sits above steady
 * state by the usual 3-5x and an order of magnitude below the regression, so it
 * cannot read green through the thing it exists to see.
 */
const TRAJECTORY_TRANSFORM_BUDGET = new PerfBudget({
  name: "Trajectory points transformed/sec",
  threshold: 5_000,
  windowMs: 1000,
  unit: "points",
});

/**
 * The provider's answer to "what is this trajectory", in a form that can be
 * drawn.
 *
 * The window put to `canPropagate` is the view instant on both ends, matching
 * the gate's other callers: the horizon is an absolute UT bound, so "can these
 * elements answer for the moment I am looking at" is the whole question, and
 * building one from `elements.epoch` would ask a different question in the same
 * units (`epoch` is the mean-anomaly reference, not when the sample was taken).
 */
export function orbitTrajectory(input: OrbitTrajectoryInput): OrbitTrajectory {
  const { orbit, viewUt } = input;
  const horizon = orbit.horizon;
  const trajectoryKind = horizon?.trajectoryKind;

  const refusal = canPropagate(horizon, viewUt, viewUt);
  if (!refusal.propagatable) {
    return { shape: "withheld", reason: refusal.reason, trajectoryKind };
  }

  const reframing = wantsReframing(input.readFrame);

  if (trajectoryKind === TrajectoryKindLike.Analytic) {
    // A conic answer says "the elements ARE the curve", and in a rotating frame
    // they are not: the ellipse is a shape in one frame and a rosette in
    // another. So a caller that asked for a different frame gets the conic
    // sampled and re-expressed, and never the instruction to draw an ellipse.
    if (reframing === null) return { shape: "conic" };
    const sampled = sampleArc(
      buildElements(orbit),
      horizon,
      viewUt,
      input.samples,
      orbit.referenceBodyIndex,
    );
    if (sampled === null) {
      return { shape: "withheld", reason: "no-arc-available", trajectoryKind };
    }
    return reframeArc(sampled, orbit, reframing, viewUt);
  }
  if (trajectoryKind !== TrajectoryKindLike.Integrated) {
    // `Unspecified`, or absent entirely. Both are what a producer that never
    // stated a shape sends, and reading either as "conic" would restore the
    // permissive default the enum's zero-value ordering exists to remove.
    return { shape: "withheld", reason: "shape-not-stated", trajectoryKind };
  }

  // An integrating provider's elements are the conic the craft is tangent to
  // at the sample instant, so what is drawn is that conic sampled forward and
  // stopped at the provider's horizon: never a closed ellipse, which would
  // claim a path the craft will not fly.
  const elements = buildElements(orbit);
  const arc = sampleArc(
    elements,
    horizon,
    viewUt,
    input.samples,
    orbit.referenceBodyIndex,
  );
  if (arc === null) {
    return { shape: "withheld", reason: "no-arc-available", trajectoryKind };
  }
  if (reframing === null) return arc;
  return reframeArc(arc, orbit, reframing, viewUt);
}

/**
 * The concrete frame a caller asked for, or null when it asked for nothing and
 * the curve stays where it was computed.
 *
 * `follow-control-frame` arriving here unresolved is null rather than a
 * refusal: it means no control frame was observed, which is every stream with
 * no n-body mod on it, and that is the ordinary case rather than a fault.
 */
function wantsReframing(
  readFrame: OrbitTrajectoryInput["readFrame"],
): { choice: ReadFrameChoice; facts: CelestialFacts } | null {
  if (readFrame === undefined) return null;
  if (readFrame.choice.kind === "follow-control-frame") return null;
  return readFrame;
}

/**
 * A curve moved into the frame the caller asked for.
 *
 * The two steps are separate on purpose. First the points are lifted out of
 * the body-centred inertial frame they were sampled in and into the system: the
 * centre body's own position at each point's OWN instant is added.
 * Only then does the frame transform run. A curve lifted at one instant and
 * transformed at another is a curve that never existed.
 *
 * Refuses rather than approximates when the source frame is one it cannot lift
 * from. A curve already in somebody's rotating frame would need that frame's
 * own state to undo, and we do not have it.
 */
function reframeArc(
  arc: TrajectoryArcAnswer,
  orbit: OrbitTrajectoryInput["orbit"],
  readFrame: { choice: ReadFrameChoice; facts: CelestialFacts },
  viewUt: number,
): OrbitTrajectory {
  const unavailable: OrbitTrajectory = {
    shape: "withheld",
    reason: "frame-unavailable",
  };
  const centreIndex = orbit.referenceBodyIndex ?? arc.frame.centreBodyIndex;
  if (centreIndex === undefined) return unavailable;
  if (arc.frame.kind !== TrajectoryFrameKindLike.BodyCentredInertial) {
    return unavailable;
  }
  const sides = frameSides(readFrame.facts, readFrame.choice);
  if (sides === null) return unavailable;
  const kind = trajectoryFrameKindFor(readFrame.choice.kind);
  if (kind === TrajectoryFrameKindLike.Unspecified) return unavailable;

  const points: TrajectoryPoint[] = [];
  let unitLengthAtView: number | undefined;
  let scaleConvention: TrajectoryScaleConvention =
    TRAJECTORY_SCALE_CONVENTIONS.metres;
  for (const p of arc.points) {
    const system = systemInstantAt(readFrame.facts, p.ut);
    const centre = system.positionByIndex.get(centreIndex);
    if (centre === undefined) return unavailable;
    const instant = frameInstantAt(
      readFrame.facts,
      readFrame.choice,
      p.ut,
      system,
    );
    if (instant === null) return unavailable;
    scaleConvention = instant.scaleConvention;
    if (unitLengthAtView === undefined || p.ut <= viewUt) {
      unitLengthAtView = instant.unitLength;
    }
    TRAJECTORY_TRANSFORM_BUDGET.record();
    const moved = toFrame(instant, [
      p.x + centre[0],
      p.y + centre[1],
      p.z + centre[2],
    ]);
    points.push({
      x: moved.position[0],
      y: moved.position[1],
      z: moved.position[2],
      ut: p.ut,
    });
  }
  if (points.length < 2) return unavailable;

  const pulsating = readFrame.choice.kind === "rotating-pulsating";
  return {
    ...arc,
    points,
    frame: {
      kind,
      centreBodyIndex: pulsating ? undefined : sides.primary[0],
      primaryBodyIndex: sides.primary[0],
      secondaryBodyIndex: sides.secondary[0],
      lengthsPulsate: pulsating,
      scaleConvention,
      unitLength: unitLengthAtView,
    },
  };
}

/**
 * The `TrajectoryFrame` kind a read-frame choice draws in.
 *
 * Exported because a widget that does its OWN framing still has to caption the
 * frame it drew in, and building the same switch beside the caption is how two
 * mappings of one enum drift apart.
 */
export function trajectoryFrameKindFor(
  kind: ReadFrameChoice["kind"],
): TrajectoryFrameKindLike {
  switch (kind) {
    case "body-centred-inertial":
      return TrajectoryFrameKindLike.BodyCentredInertial;
    case "parent-direction":
      return TrajectoryFrameKindLike.BodyCentredParentDirection;
    case "rotating-pulsating":
      return TrajectoryFrameKindLike.RotatingPulsating;
    default:
      // `follow-control-frame`, which never reaches here, and anything added
      // later. Unspecified is refused by the caller rather than drawn, so a new
      // member shows up as a frame that cannot be formed instead of as a curve
      // in a frame nobody named.
      return TrajectoryFrameKindLike.Unspecified;
  }
}

/**
 * The osculating conic sampled forward from the view instant, stopping at
 * whichever comes first: the horizon the provider named, or one full revolution.
 *
 * Capped at a revolution because a second lap would retrace the first, and an
 * integrated path does not retrace: drawing the overlap would assert a closure
 * that is exactly what the osculating elements cannot promise. Where the
 * provider's horizon is shorter, the horizon wins, which is the point of it.
 *
 * For a provider that integrates, this is the ellipse the craft is tangent to
 * right now, bounded by the horizon that provider named.
 */
function sampleArc(
  elements: OrbitElements,
  horizon: PropagationHorizonLike | undefined,
  viewUt: number,
  samples: number | undefined,
  centreBodyIndex: number | undefined,
): TrajectoryArcAnswer | null {
  // `solveAnomalies` refuses outside `[0, 1)`, so an unbound osculating set has no arc rather than a thrown render.
  if (!(elements.ecc >= 0 && elements.ecc < 1)) return null;
  const period = orbitalPeriod(elements);
  if (period === null) return null;

  const horizonUt = horizon === undefined ? undefined : horizonUtOf(horizon);
  const revolutionUt = viewUt + period;
  const toUt = Math.min(revolutionUt, horizonUt ?? Number.POSITIVE_INFINITY);
  if (!(toUt > viewUt)) return null;

  const count = Math.max(2, Math.floor(samples ?? DEFAULT_ARC_SAMPLES));
  const points: TrajectoryPoint[] = [];
  for (let i = 0; i < count; i++) {
    const ut = viewUt + ((toUt - viewUt) * i) / (count - 1);
    const { eccentricAnomaly, trueAnomaly } = solveAnomalies(elements, ut);
    const radius =
      elements.sma * (1 - elements.ecc * Math.cos(eccentricAnomaly));
    if (!Number.isFinite(radius)) return null;
    // A conic is flat in its own plane by construction, so the plane's normal component is a real zero rather than an unfilled field.
    const [x, y, z] = rotatePerifocalToInertial(
      radius * Math.cos(trueAnomaly),
      radius * Math.sin(trueAnomaly),
      elements.inc,
      elements.lan,
      elements.argPe,
    );
    points.push({ x, y, z, ut });
  }
  return {
    shape: "arc",
    points,
    fromUt: viewUt,
    toUt,
    frame: {
      kind: TrajectoryFrameKindLike.BodyCentredInertial,
      centreBodyIndex,
      lengthsPulsate: false,
    },
    farEnd: toUt < revolutionUt ? "horizon" : "revolution",
  };
}

/**
 * What frame a curve was drawn in, as a phrase to put beside it, in the words
 * the game uses for its own frames.
 *
 * Name the frame on every drawing of a path: the same points are a different
 * path in every frame. Use this rather than wording your own, so every widget
 * names one frame the same way. Pass the catalogue for the body names; a body it
 * has not named shows as its index.
 *
 * @category Frames of reference
 */
export function trajectoryFrameLabel(
  frame: TrajectoryFrame | null | undefined,
  names: Pick<CelestialFacts, "nameByIndex"> | undefined,
): string {
  if (frame == null) return "frame not stated";
  const named = (index: number | undefined): string =>
    index === undefined
      ? "unnamed body"
      : (names?.nameByIndex[index] ?? `body ${index}`);
  // The producer's own wording. These are the names an operator selects the
  // frame BY in the game's own interface, so renaming them here would make a
  // reader hold two vocabularies for one thing.
  switch (frame.kind) {
    case TrajectoryFrameKindLike.Perifocal:
      // Ours: the producer has no name for it, because it never draws in it.
      return "orbit plane";
    case TrajectoryFrameKindLike.BodyCentredInertial:
      return `${named(frame.centreBodyIndex)}-Centred Inertial`;
    case TrajectoryFrameKindLike.BodyCentredRotating: {
      const centre = named(frame.centreBodyIndex);
      return `${centre}-Centred ${centre}-Fixed`;
    }
    case TrajectoryFrameKindLike.BodyCentredParentDirection:
      return `${named(frame.secondaryBodyIndex)}-${named(frame.primaryBodyIndex)}-Orbit`;
    case TrajectoryFrameKindLike.RotatingPulsating:
      return `${named(frame.primaryBodyIndex)}-${named(frame.secondaryBodyIndex)} Lagrange`;
    default:
      // A producer that named no frame, or one this build does not know. Both
      // are states a reader must be able to see, because a curve drawn under a
      // guessed frame reads exactly like a curve drawn under a known one.
      return "frame not stated";
  }
}

/**
 * True when a coordinate in this frame must not be quoted as a distance.
 *
 * A pulsating frame's length unit is the pair's own separation, so a coordinate
 * in it is a ratio. `unitLength` on the frame is what turns one back into
 * metres, and a readout that has neither says so rather than printing the
 * ratio with a metre sign after it.
 */
export function frameCoordinatesArePulsating(
  frame: TrajectoryFrame | null | undefined,
): boolean {
  return (
    frame?.lengthsPulsate === true ||
    frame?.scaleConvention ===
      TRAJECTORY_SCALE_CONVENTIONS.separationAtPointInstant
  );
}

/**
 * The frame a widget actually DREW in, which is not always a field on the
 * answer.
 *
 * A conic answer carries no frame because it carries no points: the caller
 * builds the ellipse itself from the elements, and the frame that lands in is
 * the orbit's own plane about the body the elements are measured against. That
 * is a real frame and it has to be nameable, or the widgets that draw a conic
 * would be the only ones unable to say what they drew.
 *
 * Null for a refusal, because nothing was drawn and a frame named for an absent
 * curve is a caption with no picture.
 */
export function drawnFrame(
  trajectory: OrbitTrajectory | null | undefined,
  centreBodyIndex?: number,
): TrajectoryFrame | null {
  if (trajectory == null) return null;
  if (trajectory.shape === "arc") return trajectory.frame;
  if (trajectory.shape === "conic") {
    return {
      kind: TrajectoryFrameKindLike.Perifocal,
      centreBodyIndex,
      lengthsPulsate: false,
    };
  }
  return null;
}

/**
 * An arc re-expressed in the plane of the orbit it was sampled from, periapsis
 * on `+x` and motion toward `+y`, for a diagram that draws that plane flat.
 *
 * `z` is the part along the orbit normal: zero for a conic, nonzero where an
 * integrated path leaves the plane. The frame on the answer is named the orbit
 * plane, so the picture and its caption agree.
 *
 * Null when the arc is not in a body-centred inertial frame, because the plane
 * of an orbit is only defined against the axes it was measured in.
 *
 * @category Frames of reference
 */
export function arcInOrbitPlane(
  arc: TrajectoryArcAnswer,
  orbit: WireOrbitElements,
): TrajectoryArcAnswer | null {
  if (arc.frame.kind !== TrajectoryFrameKindLike.BodyCentredInertial) {
    return null;
  }
  const { inc, lan, argPe } = buildElements(orbit);
  const pHat = rotatePerifocalToInertial(1, 0, inc, lan, argPe);
  const qHat = rotatePerifocalToInertial(0, 1, inc, lan, argPe);
  const wHat: Vec3Tuple = [
    pHat[1] * qHat[2] - pHat[2] * qHat[1],
    pHat[2] * qHat[0] - pHat[0] * qHat[2],
    pHat[0] * qHat[1] - pHat[1] * qHat[0],
  ];
  return {
    ...arc,
    points: arc.points.map((p) => ({
      x: p.x * pHat[0] + p.y * pHat[1] + p.z * pHat[2],
      y: p.x * qHat[0] + p.y * qHat[1] + p.z * qHat[2],
      z: p.x * wHat[0] + p.y * wHat[1] + p.z * wHat[2],
      ut: p.ut,
    })),
    frame: {
      kind: TrajectoryFrameKindLike.Perifocal,
      centreBodyIndex: arc.frame.centreBodyIndex,
      lengthsPulsate: false,
    },
  };
}

/**
 * How many points a closed orbit ring is sampled into.
 *
 * @category Orbits and trajectories
 */
export const ORBIT_RING_SAMPLES = 96;

/**
 * The whole closed ring of an orbit about its parent, in the parent's inertial
 * axes, metres: `samples + 1` points, the last equal to the first.
 *
 * Sampled uniformly in eccentric anomaly so points spread along the curve
 * instead of piling up at apoapsis. Eccentricity is held below 1, so an
 * unbound set draws its widest ellipse rather than failing.
 *
 * @category Orbits and trajectories
 */
export function orbitRing(
  orbit: Pick<OrbitElements, "sma" | "ecc" | "inc" | "lan" | "argPe">,
  samples: number = ORBIT_RING_SAMPLES,
): Vec3Tuple[] {
  const ecc = Math.min(Math.max(orbit.ecc, 0), 0.999);
  const semiMinor = orbit.sma * Math.sqrt(1 - ecc * ecc);
  const points: Vec3Tuple[] = [];
  for (let i = 0; i <= samples; i++) {
    const anomaly = (2 * Math.PI * i) / samples;
    points.push(
      rotatePerifocalToInertial(
        orbit.sma * (Math.cos(anomaly) - ecc),
        semiMinor * Math.sin(anomaly),
        orbit.inc,
        orbit.lan,
        orbit.argPe,
      ),
    );
  }
  return points;
}

/**
 * A catalogue body's orbit about `parent` as an `OrbitTrajectoryInput`
 * `orbit`, carrying the horizon its own provider stated, or null for a body with
 * no orbit about anything: the root star, or one whose size and shape the
 * catalogue has not filled.
 *
 * The anchor of the orbit in time (mean anomaly, epoch) and the parent's pull
 * are filled with `NaN` when the catalogue lacks them. That is enough to answer
 * the shape question and to draw a closed conic, which needs neither, and an
 * arc that has to place the body in time refuses instead of guessing.
 *
 * @category Frames of reference
 */
export function bodyOrbitInput(
  body: CelestialBody,
  parent: CelestialBody | null,
): OrbitTrajectoryInput["orbit"] | null {
  if (!finite(body.semiMajorAxis) || !finite(body.eccentricity)) return null;
  return {
    sma: body.semiMajorAxis,
    ecc: body.eccentricity,
    inc: body.inclination ?? 0,
    lan: body.lan ?? 0,
    argPe: body.argumentOfPeriapsis ?? 0,
    meanAnomalyAtEpoch: body.meanAnomalyAtEpoch ?? Number.NaN,
    epoch: body.epoch ?? Number.NaN,
    mu: parent?.gravParameter ?? Number.NaN,
    horizon: body.horizon,
    referenceBodyIndex: parent?.index,
  };
}

/**
 * How a catalogue body's path may be drawn at `viewUt`, as
 * `orbitTrajectory` answers it for a craft: a conic where its provider
 * says the elements are the curve, the arc to its horizon where it integrates,
 * a refusal where it vouches for nothing.
 *
 * Null where {@link bodyOrbitInput} is. Not a hook, so a diagram can ask for
 * every child body in one pass.
 *
 * @category Frames of reference
 */
export function bodyOrbitCurve(
  body: CelestialBody,
  parent: CelestialBody | null,
  viewUt: number,
  options?: Pick<OrbitTrajectoryInput, "samples" | "readFrame">,
): OrbitTrajectory | null {
  const orbit = bodyOrbitInput(body, parent);
  if (orbit === null) return null;
  return orbitTrajectory({ orbit, viewUt, ...options });
}
