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
import {
  canPropagate,
  horizonUtOf,
  type OrbitElements,
  type PropagationHorizonLike,
  rotateInertialToPerifocal,
  solveAnomalies,
  TrajectoryKindLike,
} from "./kepler";
import { orbitalPeriod } from "./propagation";
import { buildElements, type WireOrbitElements } from "./vessel-state";

/**
 * A point on a drawable trajectory: where, and when.
 *
 * <b>Three dimensions and an instant, where this was once a flat `{x, y}`.</b>
 * The old shape was a point in the orbit's own plane with periapsis on +x, which
 * an osculating conic always has and an integrated path never does: an n-body
 * curve leaves the plane, and in a rotating frame it has no central body to be
 * measured from at all. `z` is the out-of-plane component and is zero exactly
 * when the curve came from a conic. `ut` is on the point because a reader
 * interpolating between two of them needs to know which side of a burn it is on.
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

/** Which frame a set of points is expressed in. Mirrors `TrajectoryFrameKind` by value. */
export const TrajectoryFrameKindLike = {
  Unspecified: 0,
  Perifocal: 1,
  BodyCentredInertial: 2,
  BodyCentredRotating: 3,
} as const;
export type TrajectoryFrameKindLike =
  (typeof TrajectoryFrameKindLike)[keyof typeof TrajectoryFrameKindLike];

/** Where a curve came from. Mirrors `TrajectoryDerivation` by value. */
export const TrajectoryDerivationLike = {
  Unspecified: 0,
  Foreign: 1,
  OwnNBody: 2,
  OwnNBodyDegraded: 3,
  OwnClosedForm: 4,
} as const;
export type TrajectoryDerivationLike =
  (typeof TrajectoryDerivationLike)[keyof typeof TrajectoryDerivationLike];

/** Why a producer that CAN integrate published no arc. Mirrors `TrajectoryRefusal` by value. */
export const TrajectoryRefusalLike = {
  Unspecified: 0,
  BeyondBudget: 1,
  NoForceModel: 2,
} as const;
export type TrajectoryRefusalLike =
  (typeof TrajectoryRefusalLike)[keyof typeof TrajectoryRefusalLike];

/** The frame identity that travels with a drawn curve. */
export interface TrajectoryFrame {
  kind: TrajectoryFrameKindLike;
  /** Index into `system.bodies` of the frame's centre, when it has one. */
  centreBodyIndex?: number;
  /** True when the frame's lengths are not lengths, so a readout says so rather than showing a number. */
  lengthsPulsate: boolean;
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
  /** The provider integrates and these osculating elements cannot be sampled into an arc. */
  | "no-arc-available"
  /**
   * The integration hit its step budget before reaching the instant asked for.
   * Distinct from `past-horizon`, which is a bound the provider NAMED and can
   * be waited out at that vessel's own pace: this one the operator can act on
   * by shortening the window, and it may also resolve on its own.
   */
  | "beyond-budget"
  /**
   * The force model's configuration was not found or could not be parsed, so
   * there was nothing to integrate against. The only refusal here with no
   * operator remedy at all: it is an install problem, and saying "past horizon"
   * for it would have someone waiting for a curve that is never coming.
   */
  | "no-force-model";

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
      /**
       * Where the curve came from, travelling ON the curve rather than beside
       * the widget. A substituted answer that only says so in a panel elsewhere
       * is a substituted answer nobody reads as one.
       */
      derivation: TrajectoryDerivationLike;
      /**
       * How many points the propagation produced before decimation. Larger than
       * `points.length` for a decimated curve, which resolves less than the
       * propagation knew: a reader may not treat one of its points as an event
       * instant.
       */
      sourcePointCount: number;
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

/** The arc as it arrives on the wire, in whatever frame the producer computed it in. */
export interface WireTrajectoryArc {
  frame?: {
    kind?: TrajectoryFrameKindLike;
    centreBodyIndex?: number | null;
    lengthsPulsate?: boolean;
  };
  points?: readonly {
    ut: { magnitude: number } | number;
    x: { magnitude: number } | number;
    y: { magnitude: number } | number;
    z: { magnitude: number } | number;
  }[];
  fromUt?: { magnitude: number } | number;
  toUt?: { magnitude: number } | number;
  sourcePointCount?: { magnitude: number } | number;
  derivation?: TrajectoryDerivationLike;
}

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
    /** The provider's own integrated points, when it computed some. */
    arc?: WireTrajectoryArc | null;
    /** Why there is no arc, when a provider tried to build one and stopped. */
    arcRefusal?: TrajectoryRefusalLike;
  };
  /** The instant on screen, which is the instant the operator's question is about. */
  viewUt: number;
  /** Points along a sampled arc. Default 128, the same density `buildOrbitPatches` uses. */
  samples?: number;
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

  // The arc refusals come FIRST, ahead of the horizon gate. A producer that
  // could not build a force model has not got as far as having a horizon
  // opinion, and letting `no-horizon-stated` answer for it would name a
  // producer bug where the truth is a missing install.
  const refused = withheldFor(orbit.arcRefusal);
  if (refused !== null) {
    return { shape: "withheld", reason: refused, trajectoryKind };
  }

  const refusal = canPropagate(horizon, viewUt, viewUt);
  if (!refusal.propagatable) {
    return { shape: "withheld", reason: refusal.reason, trajectoryKind };
  }

  if (trajectoryKind === TrajectoryKindLike.Analytic) {
    return { shape: "conic" };
  }
  if (trajectoryKind !== TrajectoryKindLike.Integrated) {
    // `Unspecified`, or absent entirely. Both are what a producer that never
    // stated a shape sends, and reading either as "conic" would restore the
    // permissive default the enum's zero-value ordering exists to remove.
    return { shape: "withheld", reason: "shape-not-stated", trajectoryKind };
  }

  const elements = buildElements(orbit);

  // Real integrated points win over a sampled conic wherever they exist. This
  // is the whole point of the arc riding on the wire: what `sampleArc` produces
  // for an integrating provider is the ellipse the craft is tangent to, drawn
  // under a label that says integrated.
  const carried = arcFromReading(orbit.arc, elements, viewUt);
  if (carried !== null) return carried;

  const arc = sampleArc(elements, horizon, viewUt, input.samples);
  return (
    arc ?? { shape: "withheld", reason: "no-arc-available", trajectoryKind }
  );
}

/** The withheld reason a stated arc refusal maps to, or null when nothing was refused. */
function withheldFor(
  refusal: TrajectoryRefusalLike | undefined,
): TrajectoryWithheldReason | null {
  switch (refusal) {
    case TrajectoryRefusalLike.BeyondBudget:
      return "beyond-budget";
    case TrajectoryRefusalLike.NoForceModel:
      return "no-force-model";
    default:
      // `Unspecified`, or absent entirely: nothing was refused, which is every
      // sample from a provider that does not integrate.
      return null;
  }
}

/**
 * The provider's own points as a drawable arc, or null when the reading carries
 * none worth drawing.
 *
 * Points arriving in a body-centred inertial frame are rotated into the
 * perifocal one, because that is the frame the body-centric diagrams draw in and
 * somewhere the two have to meet. It happens HERE, once, rather than in each
 * widget: the transform is about fifty flops a point and negligible per point,
 * and the regression that matters is a widget re-transforming on every render
 * rather than on new data.
 */
function arcFromReading(
  wire: WireTrajectoryArc | null | undefined,
  elements: OrbitElements,
  viewUt: number,
): OrbitTrajectory | null {
  if (wire == null) return null;
  const raw = wire.points;
  if (raw === undefined || raw.length < 2) {
    // Fewer than two points is not a path. A producer with nothing to say
    // publishes no arc and a refusal beside it, so this is a malformed reading
    // rather than a state, and falling through to the conic sample is the
    // conservative read.
    return null;
  }

  const frameKind = wire.frame?.kind ?? TrajectoryFrameKindLike.Unspecified;
  if (frameKind === TrajectoryFrameKindLike.Unspecified) {
    // An unnamed frame cannot be drawn: the same points are a different curve
    // per frame, so guessing one would produce a plausible wrong shape rather
    // than a visible failure.
    return null;
  }

  const rotate = frameKind === TrajectoryFrameKindLike.BodyCentredInertial;
  const points: TrajectoryPoint[] = [];
  for (const p of raw) {
    const x = mag(p.x);
    const y = mag(p.y);
    const z = mag(p.z);
    const ut = mag(p.ut);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }
    TRAJECTORY_TRANSFORM_BUDGET.record();
    if (rotate) {
      const [px, py, pz] = rotateInertialToPerifocal(
        [x, y, z],
        elements.inc,
        elements.lan,
        elements.argPe,
      );
      points.push({ x: px, y: py, z: pz, ut });
    } else {
      points.push({ x, y, z, ut });
    }
  }
  if (points.length < 2) return null;

  const fromUt = wire.fromUt === undefined ? viewUt : mag(wire.fromUt);
  const toUt =
    wire.toUt === undefined ? points[points.length - 1].ut : mag(wire.toUt);
  if (!Number.isFinite(fromUt) || !Number.isFinite(toUt)) return null;

  return {
    shape: "arc",
    points,
    fromUt,
    toUt,
    frame: {
      // The rotation lands the points in the perifocal frame, so that is what
      // the arc names. Reporting the wire's frame after transforming out of it
      // would put the wrong caption on the right curve.
      kind: rotate ? TrajectoryFrameKindLike.Perifocal : frameKind,
      centreBodyIndex: wire.frame?.centreBodyIndex ?? undefined,
      lengthsPulsate: wire.frame?.lengthsPulsate ?? false,
    },
    // A provider's own arc ends where its authority does. It has no revolution
    // convention to stop at, because an integrated path does not retrace.
    farEnd: "horizon",
    derivation: wire.derivation ?? TrajectoryDerivationLike.Unspecified,
    sourcePointCount:
      wire.sourcePointCount === undefined
        ? points.length
        : mag(wire.sourcePointCount),
  };
}

function mag(v: { magnitude: number } | number): number {
  return typeof v === "number" ? v : v.magnitude;
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
 * This is the fallback, not the answer. A provider that integrates and carries
 * its real points has them drawn instead; what this produces for such a provider
 * is the ellipse the craft is tangent to right now, which is worth drawing only
 * while nothing better has arrived.
 */
function sampleArc(
  elements: OrbitElements,
  horizon: PropagationHorizonLike | undefined,
  viewUt: number,
  samples: number | undefined,
): OrbitTrajectory | null {
  // `solveAnomalies` refuses outside `[0, 1)`, so an unbound osculating set has
  // no arc rather than a thrown render.
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
    points.push({
      x: radius * Math.cos(trueAnomaly),
      y: radius * Math.sin(trueAnomaly),
      // A conic is flat in its own plane by construction, so the out-of-plane
      // component is a real zero rather than an unfilled field.
      z: 0,
      ut,
    });
  }
  return {
    shape: "arc",
    points,
    fromUt: viewUt,
    toUt,
    frame: { kind: TrajectoryFrameKindLike.Perifocal, lengthsPulsate: false },
    farEnd: toUt < revolutionUt ? "horizon" : "revolution",
    derivation: TrajectoryDerivationLike.OwnClosedForm,
    sourcePointCount: points.length,
  };
}
