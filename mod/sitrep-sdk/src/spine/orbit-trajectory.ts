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

import {
  canPropagate,
  horizonUtOf,
  type OrbitElements,
  type PropagationHorizonLike,
  solveAnomalies,
  TrajectoryKindLike,
} from "./kepler";
import { orbitalPeriod } from "./propagation";
import { buildElements, type WireOrbitElements } from "./vessel-state";

/** A point in the orbit's own plane, metres, periapsis on +x. The frame a body-centric orbit diagram already draws in. */
export interface PerifocalPoint {
  x: number;
  y: number;
}

/** Why nothing may be drawn. Each is a distinct sentence a readout can say; collapsing them would hide which one happened. */
export type TrajectoryWithheldReason =
  /** No provider stated a horizon. Silence must not render as health. */
  | "no-horizon-stated"
  /** The view instant is past the bound the provider named. */
  | "past-horizon"
  /** The provider stated reach but not shape, so a conic is not known to be right. */
  | "shape-not-stated"
  /** The provider integrates and these osculating elements cannot be sampled into an arc. */
  | "no-arc-available";

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
      points: readonly PerifocalPoint[];
      /** The window the arc spans, so a caller can say how far ahead it reaches. */
      fromUt: number;
      toUt: number;
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
  };
  /** The instant on screen, which is the instant the operator's question is about. */
  viewUt: number;
  /** Points along a sampled arc. Default 128, the same density `buildOrbitPatches` uses. */
  samples?: number;
}

const DEFAULT_ARC_SAMPLES = 128;

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

  if (trajectoryKind === TrajectoryKindLike.Analytic) {
    return { shape: "conic" };
  }
  if (trajectoryKind !== TrajectoryKindLike.Integrated) {
    // `Unspecified`, or absent entirely. Both are what a producer that never
    // stated a shape sends, and reading either as "conic" would restore the
    // permissive default the enum's zero-value ordering exists to remove.
    return { shape: "withheld", reason: "shape-not-stated", trajectoryKind };
  }

  const arc = sampleArc(buildElements(orbit), horizon, viewUt, input.samples);
  return (
    arc ?? { shape: "withheld", reason: "no-arc-available", trajectoryKind }
  );
}

/**
 * The osculating conic sampled forward from the view instant, stopping at
 * whichever comes first: the horizon the provider named, or one full revolution.
 *
 * Capped at a revolution because a second lap would retrace the first, and an
 * integrated path does not retrace: drawing the overlap would assert a closure
 * that is exactly what the osculating elements cannot promise. Where the
 * provider's horizon is shorter, the horizon wins, which is the point of it.
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
  const toUt = Math.min(viewUt + period, horizonUt ?? Number.POSITIVE_INFINITY);
  if (!(toUt > viewUt)) return null;

  const count = Math.max(2, Math.floor(samples ?? DEFAULT_ARC_SAMPLES));
  const points: PerifocalPoint[] = [];
  for (let i = 0; i < count; i++) {
    const ut = viewUt + ((toUt - viewUt) * i) / (count - 1);
    const { eccentricAnomaly, trueAnomaly } = solveAnomalies(elements, ut);
    const radius =
      elements.sma * (1 - elements.ecc * Math.cos(eccentricAnomaly));
    if (!Number.isFinite(radius)) return null;
    points.push({
      x: radius * Math.cos(trueAnomaly),
      y: radius * Math.sin(trueAnomaly),
    });
  }
  return { shape: "arc", points, fromUt: viewUt, toUt };
}
