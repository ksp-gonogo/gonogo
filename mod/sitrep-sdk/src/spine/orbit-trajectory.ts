/**
 * What a trajectory is, as a drawable answer, decided from what the elected
 * propagation provider said rather than from the elements alone.
 *
 * ## Why this is not a widget's decision
 *
 * `vessel.orbit` carries orbital elements and, riding with them, a
 * `PropagationHorizon` whose two halves answer two different questions: `kind`
 * answers reach (how far may these be extrapolated) and `trajectoryKind`
 * answers shape (is a conic the right renderer at all). Neither implies the
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
import type { ReckoningDecline } from "../reading";
import { finite } from "./catalogue-elements";
import type { CelestialBody, CelestialFacts } from "./celestial-facts";
import {
  canPropagate,
  horizonUtOf,
  type OrbitElements,
  type PropagationHorizonLike,
  type PropagationRefusal,
  rotatePerifocalToInertial,
  solve,
  solveAnomalies,
  solveEccentricAnomaly,
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
 * One point on a drawable trajectory: a position in three dimensions and the
 * universal time the vessel or body is there. Useful for drawing a predicted or
 * past path and for telling the operator when along it a point falls. Used by the
 * map's past-track and trajectory painting and by the system diagram.
 *
 * A point is never a flat {x, y}: a curve re-expressed in a read frame leaves
 * the orbit's own plane, and in a rotating frame it has no central body to be
 * measured from at all. `z` is the out-of-plane component and is zero exactly
 * while the curve is still in its own plane. `ut` is on the point because a
 * reader interpolating between two of them needs to know which side of a burn it
 * is on.
 *
 * `x` and `y` come first and keep the same units and orientation, so a diagram
 * that only draws a plane works against it unedited.
 */
export interface TrajectoryPoint {
  x: number;
  y: number;
  z: number;
  ut: number;
}

/**
 * Which frame a set of trajectory points is expressed in. Useful for naming that
 * frame next to a drawn path. Used by the system diagram's geometry. A
 * client-side vocabulary: the points are sampled and re-expressed here, never
 * read off the wire.
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
 * than assuming it. Useful for captioning a drawn path with the frame it is in.
 * Used by the system diagram's projection and the trajectory frame caption. Build
 * one yourself for a frame your own drawing sets, and name it with
 * {@link trajectoryFrameLabel}.
 *
 * @category Frames of reference
 */
export interface TrajectoryFrame {
  /** What kind of frame it is. */
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
  /** Index into `system.bodies` of the second body the frame is named for. */
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
 * The reason a drawn trajectory arc ends where it does: at the last instant the
 * propagation provider vouched for, or after one full revolution. Useful for
 * labelling the mark a renderer draws at the end of the arc, since an arc cut
 * short at the provider's horizon and one that completes its revolution look the
 * same on a diagram. Used by the orbit diagram. Always present on an arc.
 */
export type ArcFarEnd =
  /** The last instant the provider vouched for. */
  | "horizon"
  /** One full revolution, past which a second lap would assert a closure osculating elements cannot promise. */
  | "revolution";

/**
 * How a vessel's path may be drawn at the instant on screen, returned by
 * {@link useOrbitTrajectory}: as a conic from its elements, as the sampled arc
 * the provider vouched for, or not at all. Useful for deciding what to draw for
 * the vessel's orbit. Used by the maneuver planner's preview and conformance
 * plot and the orbit view widget.
 *
 * A `withheld` answer carries a {@link ReckoningDecline}, the same shape a
 * declined model gives, so show it the way any declined figure is shown: a short
 * label from `reason` where the curve would be and `note` as its explanation.
 * It is a statement about what the provider vouched for, not a missing value.
 *
 * The `reason` is `input-absent` when the provider stated no horizon or no
 * shape, `beyond-horizon` when the instant on screen is past the bound it named,
 * `model-inapplicable` when the elements cannot be sampled into an arc, and
 * `frame-unavailable` when the frame asked for cannot be built from the bodies
 * known. Past an integrating provider's horizon the `note` says the path is not
 * computed that far yet, which resolves by itself; past an analytic provider's
 * it says the elements cannot be trusted that far, which does not.
 *
 * @category Frames of reference
 */
export type OrbitTrajectory =
  | {
      /**
       * A closed-form conic. Draw one from the elements: they are the curve,
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
      /** The sampled points of the path. */
      points: readonly TrajectoryPoint[];
      /** The window the arc spans, so a caller can say how far ahead it reaches. */
      fromUt: number;
      /** The UT the arc ends at. */
      toUt: number;
      /** Which frame `points` are in, so a widget can name it rather than assume it. */
      frame: TrajectoryFrame;
      /** What `toUt` is: see `ArcFarEnd`. */
      farEnd: ArcFarEnd;
    }
  | {
      /** The path may not be drawn. */
      shape: "withheld";
      /** Why it may not, and the sentence to show the operator. */
      declined: ReckoningDecline;
    };

/**
 * The arc arm of {@link OrbitTrajectory}: an answer that carries sampled points.
 * Useful for typing the result of a function that only ever produces an arc. Used
 * by the impact-point prediction.
 */
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
   * The frame the caller wants the curve in, and the catalogue to build it
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
 * The withheld answer for a refusal: the standard decline carrying the sentence
 * the operator reads. An integrating provider and an analytic one are worded
 * apart past their horizon, since only the first resolves on its own.
 */
function withheld(
  declined: ReckoningDecline,
): Extract<OrbitTrajectory, { shape: "withheld" }> {
  return { shape: "withheld", declined };
}

function refused(
  refusal: Exclude<PropagationRefusal, { propagatable: true }>,
): OrbitTrajectory {
  if (refusal.reason === "no-horizon-stated") {
    return withheld({
      reason: "input-absent",
      note: "Nothing says how far ahead these orbital elements can be trusted.",
    });
  }
  return withheld({
    reason: "beyond-horizon",
    note:
      refusal.trajectoryKind === TrajectoryKindLike.Integrated
        ? "The trajectory is not computed this far ahead yet."
        : "These orbital elements cannot be trusted this far ahead.",
  });
}

const SHAPE_NOT_STATED: ReckoningDecline = {
  reason: "input-absent",
  note: "Nothing has said whether this trajectory is a conic.",
};

const NO_ARC_AVAILABLE: ReckoningDecline = {
  reason: "model-inapplicable",
  note: "The integrated trajectory could not be sampled.",
};

const FRAME_UNAVAILABLE: ReckoningDecline = {
  reason: "frame-unavailable",
  note: "The trajectory is fine; the frame it was asked for cannot be built from the bodies known here. Pick another frame.",
};

/**
 * The trajectory the propagation provider vouches for, in a form that can be
 * drawn. Useful for choosing between drawing a conic, drawing a sampled arc and
 * telling the operator nothing can be drawn. Called by {@link useOrbitTrajectory}.
 *
 * The window put to `canPropagate` is the view instant on both ends, matching
 * the gate's other callers. The horizon is an absolute UT bound, so the check is
 * whether these elements can answer for the view instant. `elements.epoch` is the
 * mean-anomaly reference and is never when the sample was taken, so it is not
 * used to build the window.
 */
export function orbitTrajectory(input: OrbitTrajectoryInput): OrbitTrajectory {
  const { orbit, viewUt } = input;
  const horizon = orbit.horizon;
  const trajectoryKind = horizon?.trajectoryKind;

  const refusal = canPropagate(horizon, viewUt, viewUt);
  if (!refusal.propagatable) {
    return refused(refusal);
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
      return withheld(NO_ARC_AVAILABLE);
    }
    return reframeArc(sampled, orbit, reframing, viewUt);
  }
  if (trajectoryKind !== TrajectoryKindLike.Integrated) {
    // `Unspecified`, or absent entirely. Both are what a producer that never
    // stated a shape sends, and reading either as "conic" would restore the
    // permissive default the enum's zero-value ordering exists to remove.
    return withheld(SHAPE_NOT_STATED);
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
    return withheld(NO_ARC_AVAILABLE);
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
 * centre body's own position at each point's own instant is added.
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
  const unavailable = withheld(FRAME_UNAVAILABLE);
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
 * The `TrajectoryFrame` kind a read-frame choice draws in. Useful for captioning
 * the frame a widget drew in when it does its own framing, so the caption and the
 * drawing agree. Used by the system diagram's projection.
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
 * `count` instants from `fromUt` to `toUt` spaced evenly in eccentric anomaly,
 * which spaces the points evenly along a closed orbit's length. Even steps in
 * time would leave a high-eccentricity ellipse a few points across its whole
 * periapsis pass and draw it as a corner.
 */
function instantsEvenInEccentricAnomaly(
  elements: OrbitElements,
  fromUt: number,
  toUt: number,
  count: number,
): number[] {
  const { ecc } = elements;
  const meanMotion = Math.sqrt(elements.mu / elements.sma ** 3);
  const start = solveAnomalies(elements, fromUt).eccentricAnomaly;
  const startMean = start - ecc * Math.sin(start);
  const endMean = startMean + meanMotion * (toUt - fromUt);
  const laps = Math.floor(endMean / (2 * Math.PI));
  const end = solveEccentricAnomaly(endMean, ecc) + 2 * Math.PI * laps;
  const instants: number[] = [];
  for (let i = 0; i < count; i++) {
    if (i === count - 1) {
      instants.push(toUt);
      break;
    }
    const e = start + ((end - start) * i) / (count - 1);
    instants.push(fromUt + (e - ecc * Math.sin(e) - startMean) / meanMotion);
  }
  return instants;
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
 * For a provider that integrates, this is the conic the craft is tangent to
 * right now, bounded by the horizon that provider named.
 *
 * An open orbit never comes back round, so only a horizon ends its arc: with
 * none stated there is no arc.
 */
function sampleArc(
  elements: OrbitElements,
  horizon: PropagationHorizonLike | undefined,
  viewUt: number,
  samples: number | undefined,
  centreBodyIndex: number | undefined,
): TrajectoryArcAnswer | null {
  // `solve` refuses a parabolic or negative eccentricity, so such a set has no arc rather than a thrown render.
  const closed = elements.ecc >= 0 && elements.ecc < 1;
  if (!closed && !(elements.ecc > 1)) return null;
  const period = orbitalPeriod(elements);
  if (closed && period === null) return null;

  const horizonUt = horizon === undefined ? undefined : horizonUtOf(horizon);
  const revolutionUt =
    period === null ? Number.POSITIVE_INFINITY : viewUt + period;
  const toUt = Math.min(revolutionUt, horizonUt ?? Number.POSITIVE_INFINITY);
  if (!(toUt > viewUt) || !Number.isFinite(toUt)) return null;

  const count = Math.max(2, Math.floor(samples ?? DEFAULT_ARC_SAMPLES));
  const points: TrajectoryPoint[] = [];
  const instants = closed
    ? instantsEvenInEccentricAnomaly(elements, viewUt, toUt, count)
    : Array.from(
        { length: count },
        (_, i) => viewUt + ((toUt - viewUt) * i) / (count - 1),
      );
  for (const ut of instants) {
    const [x, y, z] = solve(elements, ut).position;
    if (!Number.isFinite(x + y + z)) return null;
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
 * What frame a curve was drawn in, as a phrase to put beside it, in the words the
 * game uses for its own frames. Useful for telling the operator which frame a
 * path is drawn in, since the same points are a different path in every frame.
 * Used by the system diagram and the trajectory frame caption.
 *
 * Name the frame on every drawing of a path, and use this rather than wording your
 * own, so every widget names one frame the same way. Pass the catalogue for the
 * body names; a body it has not named shows as its index.
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
 * Whether a coordinate in this frame must not be quoted as a distance. Useful for
 * deciding whether a readout may print a length for a point.
 *
 * A pulsating frame's length unit is the pair's own separation, so a coordinate
 * in it is a ratio. `unitLength` on the frame is what turns one back into
 * metres, and a readout that has neither says so rather than printing the ratio
 * with a metre sign after it.
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
 * The frame a widget actually drew in, which is not always a field on the answer.
 * Useful for captioning a drawing of the vessel's orbit with the frame it is in.
 * Used by the trajectory frame caption.
 *
 * A conic answer carries no frame because it carries no points: the caller builds
 * the ellipse itself from the elements, and the frame that lands in is the
 * orbit's own plane about the body the elements are measured against. The result
 * is null for a refusal, because nothing was drawn to caption.
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
 * An arc re-expressed in the plane of the orbit it was sampled from, periapsis on
 * `+x` and motion toward `+y`. Useful for a diagram that draws that plane flat.
 * Used by the orbit plane trajectory hook.
 *
 * `z` is the part along the orbit normal: zero for a conic, nonzero where an
 * integrated path leaves the plane. The frame on the answer is named the orbit
 * plane, so the picture and its caption agree. The result is null when the arc is
 * not in a body-centred inertial frame, because the plane of an orbit is only
 * defined against the axes it was measured in.
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
 * How many points a closed orbit ring is sampled into. Useful for drawing a
 * body's orbit as a smooth closed curve.
 *
 * @category Frames of reference
 */
export const ORBIT_RING_SAMPLES = 96;

/**
 * The whole closed ring of an orbit about its parent, in the parent's inertial
 * axes, metres: `samples + 1` points, the last equal to the first. Useful for
 * drawing a body's orbit around its parent. Used by the system diagram's orbit
 * geometry.
 *
 * Sampled uniformly in eccentric anomaly so points spread along the curve
 * instead of piling up at apoapsis. An open orbit (`ecc` of 1 or more) has no
 * ring and answers with no points; {@link openOrbitArc} draws one.
 *
 * @category Frames of reference
 */
export function orbitRing(
  orbit: Pick<OrbitElements, "sma" | "ecc" | "inc" | "lan" | "argPe">,
  samples: number = ORBIT_RING_SAMPLES,
): Vec3Tuple[] {
  if (orbit.ecc >= 1) return [];
  const ecc = Math.max(orbit.ecc, 0);
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
 * The part of an open orbit (`ecc` above 1) that lies within `maxRadius` metres
 * of its parent's centre, in the parent's inertial axes, metres: `samples + 1`
 * points from the inbound end, through periapsis, to the outbound end, both ends
 * at `maxRadius`. Useful for showing the operator a flyby or an escape inside the
 * sphere of influence it happens in, which is where the orbit holds. Used by the
 * system diagram for a vessel on an open orbit.
 *
 * Sampled uniformly in hyperbolic anomaly, so points gather near periapsis where
 * the path bends. Only the size of `sma` is read. No points when the orbit is
 * not open, or when `maxRadius` is not a finite distance beyond its periapsis.
 *
 * @category Frames of reference
 */
export function openOrbitArc(
  orbit: Pick<OrbitElements, "sma" | "ecc" | "inc" | "lan" | "argPe">,
  maxRadius: number,
  samples: number = ORBIT_RING_SAMPLES,
): Vec3Tuple[] {
  if (!(orbit.ecc > 1) || !Number.isFinite(maxRadius)) return [];
  const size = Math.abs(orbit.sma);
  if (!(size > 0) || !Number.isFinite(size)) return [];
  // r = |a|·(e·cosh H − 1), so the anomaly at `maxRadius` is where cosh H reaches this.
  const coshAtEdge = (1 + maxRadius / size) / orbit.ecc;
  if (!(coshAtEdge > 1)) return [];
  const edge = Math.acosh(coshAtEdge);
  const semiMinor = size * Math.sqrt(orbit.ecc * orbit.ecc - 1);
  const points: Vec3Tuple[] = [];
  for (let i = 0; i <= samples; i++) {
    const anomaly = edge * ((2 * i) / samples - 1);
    points.push(
      rotatePerifocalToInertial(
        size * (orbit.ecc - Math.cosh(anomaly)),
        semiMinor * Math.sinh(anomaly),
        orbit.inc,
        orbit.lan,
        orbit.argPe,
      ),
    );
  }
  return points;
}

/**
 * A catalogue body's orbit about `parent` as an `OrbitTrajectoryInput` `orbit`,
 * carrying the horizon its own provider stated. Useful for drawing a moon or
 * planet's path with the same trajectory code as the vessel's. Used by
 * {@link bodyOrbitCurve}. The result is null for a body with no orbit about
 * anything: the root star, or one whose size and shape the catalogue has not
 * filled.
 *
 * The anchor of the orbit in time (mean anomaly, epoch) and the parent's pull
 * are filled with `NaN` when the catalogue lacks them. That is enough to answer
 * the shape question and to draw a closed conic, which needs neither, and an arc
 * that has to place the body in time refuses instead of guessing.
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
 * How a catalogue body's path may be drawn at `viewUt`, as `orbitTrajectory`
 * answers it for a vessel: a conic where its provider says the elements are the
 * curve, the arc to its horizon where it integrates, a refusal where it vouches
 * for nothing. Useful for drawing the orbits of the bodies around a parent. Used
 * by the system diagram's geometry.
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
