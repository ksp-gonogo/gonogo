import { rotateInertialToPerifocal, solve } from "./kepler";
import type { TrajectoryPoint } from "./orbit-trajectory";
import { buildElements, type WireOrbitElements } from "./vessel-state";

/** One `vessel.orbit` sample and the instant it was true. */
export interface OrbitSample {
  payload: WireOrbitElements & { referenceBodyIndex?: number };
  validAt: number;
}

/**
 * Where the craft HAS BEEN, from the samples that were true at the time.
 *
 * <p><b>Observed, not propagated backwards.</b> Each point is solved from the
 * elements that arrived for that instant, so the trail is a record of what was
 * reported rather than a model of what must have happened. Running the current
 * elements backwards would be a different claim and a wrong one under an n-body
 * force model, where the path does not retrace: the craft's real past is only
 * recoverable from what was measured, and that is exactly what the store
 * holds.</p>
 *
 * <p>This is why the forward arc and the trail must be drawn differently. One
 * is a prediction and one is a record, and a single unbroken curve through the
 * craft would assert the same confidence in both.</p>
 *
 * <p><b>Expressed in `frame`'s perifocal frame, and that argument is required
 * for a reason.</b> Each point is SOLVED from its own sample, which is what
 * makes the trail a record, and a solve hands back a body-centred inertial
 * position. The arc it is drawn beside is in the perifocal frame of the elements
 * the diagram was drawn from, so a trail left inertial is a curve of the right
 * shape and the right size sitting rotated away from the path the craft is on by
 * that orbit's own three angles, and out of its plane entirely once the orbit is
 * tilted. Nothing about it looks wrong. Defaulting the frame would let the next
 * caller inherit that silently, so there is no default: naming the elements the
 * points are to be read against is part of asking for them.</p>
 */
export function pastTrack(
  samples: readonly OrbitSample[],
  options: {
    /**
     * The elements whose perifocal frame the points come back in. The same ones
     * the diagram was drawn from, never the sample's own: osculating elements
     * drift, and a point placed in the frame belonging to its own instant would
     * put every point in a slightly different frame from its neighbour.
     */
    frame: WireOrbitElements;
    centreBodyIndex?: number;
  },
): TrajectoryPoint[] {
  const into = buildElements(options.frame);
  const points: TrajectoryPoint[] = [];
  for (const sample of samples) {
    // A sample taken about a DIFFERENT body is a different frame, and joining
    // the two would draw a line across the gap between them. A craft that
    // changed sphere of influence has a trail that starts at the transition,
    // which is the truth about what this frame can show.
    if (
      options.centreBodyIndex !== undefined &&
      sample.payload.referenceBodyIndex !== undefined &&
      sample.payload.referenceBodyIndex !== options.centreBodyIndex
    ) {
      points.length = 0;
      continue;
    }

    const elements = buildElements(sample.payload);
    if (
      !(elements.ecc < 1) ||
      !(elements.sma > 0) ||
      !Number.isFinite(elements.mu)
    ) {
      // An escape trajectory has no closed solution here, and a sample that
      // arrived incomplete cannot be placed. Dropping the point keeps the trail
      // honest about which instants it can speak for.
      continue;
    }

    const [x, y, z] = rotateInertialToPerifocal(
      solve(elements, sample.validAt).position,
      into.inc,
      into.lan,
      into.argPe,
    );
    points.push({ x, y, z, ut: sample.validAt });
  }
  return points;
}
