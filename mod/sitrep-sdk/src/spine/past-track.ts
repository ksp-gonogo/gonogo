import { solve } from "./kepler";
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
 */
export function pastTrack(
  samples: readonly OrbitSample[],
  options: { centreBodyIndex?: number } = {},
): TrajectoryPoint[] {
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

    const [x, y, z] = solve(elements, sample.validAt).position;
    points.push({ x, y, z, ut: sample.validAt });
  }
  return points;
}
