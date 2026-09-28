/**
 * Forward ground-track prediction over the wire's orbit-patch chain, within a
 * single SOI. No N-body integration; under an n-body physics mod the consumer
 * guards on the trajectory's shape.
 */
import {
  groundTrackSamples,
  type PatchSpan,
  type PredictionRef,
  solveEccentricAnomaly,
  type TrackSample,
} from "@ksp-gonogo/sitrep-client";
import { PerfBudget } from "../perf/PerfBudget";

/**
 * Solve Kepler's equation `E - e·sin E = M` for the eccentric anomaly E.
 *
 * A re-export, not a local implementation, so that exactly one Newton iteration
 * on this equation exists in the repo. A naive one starting at `M + e·sin(M)`
 * with no high-eccentricity branch fails to converge from about `e = 0.994`
 * upward on a minority of mean anomalies just after periapsis, and returns its
 * last iterate: wrong by up to pi radians, silently, on a live path through
 * `maneuver.ts`. "Returns the best value even if the tolerance isn't met" is a
 * true thing to write about such an implementation and is not a warning anybody
 * can act on.
 *
 * <b>It REFUSES `ecc >= 1`</b> rather than answering with a confident number.
 * Both patch-based callers already filter unbound trajectories; `maneuver.ts`'s
 * `stateAtUT` does not.
 *
 * All angles in radians.
 */
export const solveKepler = solveEccentricAnomaly;

/** Wrap a degree value to (-180, 180]. */
export function wrap180(deg: number): number {
  let x = ((((deg + 180) % 360) + 360) % 360) - 180;
  // Avoid returning -180 exactly; prefer +180 for continuity.
  if (x <= -180) x = 180;
  return x;
}

/**
 * Convert an eccentric anomaly (radians) to true anomaly (radians) using
 * the half-angle formula, which is numerically well-behaved across all
 * quadrants.
 */
export function eccentricToTrueAnomaly(E: number, e: number): number {
  // tan(ν/2) = sqrt((1+e)/(1-e)) · tan(E/2)
  //        = (sqrt(1+e)·sin(E/2)) / (sqrt(1-e)·cos(E/2))
  const y = Math.sqrt(1 + e) * Math.sin(E / 2);
  const x = Math.sqrt(1 - e) * Math.cos(E / 2);
  return 2 * Math.atan2(y, x);
}

/** Upper bound on sample count per `predictGroundTrack` call. */
export const MAX_TRACK_SAMPLES = 500;

/**
 * Soft cap on `predictGroundTrack` invocations. MapView re-runs the
 * prediction whenever its inputs change, orbit patches change rarely
 * (SOI changes, maneuvers), but `universalTime` ticks 4×/sec and used
 * to invalidate the memo on every tick. After the throttle that
 * quantises the ut bucket to 1 Hz, normal use should be ~1/sec across
 * one MapView, plus per-maneuver-node samples on top. Budget at 30/sec
 * gives plenty of headroom for several MapView instances + multiple
 * maneuver nodes without hiding a real regression.
 */
const PREDICT_GROUND_TRACK_BUDGET = new PerfBudget({
  name: "predictGroundTrack calls/sec",
  threshold: 30,
  windowMs: 1000,
  unit: "calls",
});

/** Minimum altitude above surface to keep sampling; below this we terminate. */
const MIN_RENDER_ALT_M = -100;

/**
 * Sample a predicted ground track across the patches around `bodyId`, up to the
 * first SOI transition, stopping where the track dips below the surface.
 *
 * @param patches The chain, as `vessel.orbit.patches` or a node's `patches` carries it.
 * @param bodyId  The body to render prediction for.
 * @param bodyRadius Body mean radius in metres (for altitude calculation).
 * @param rotationPeriod Body sidereal rotation period in seconds.
 * @param ref Current vessel state (ut / lat / lon), calibrates body rotation.
 * @param horizonSec Maximum prediction horizon from `ref.ut`.
 * @param stepSec Sample interval in seconds.
 * @param calibrationPatches Patches that calibrate body rotation against `ref`: a future chain that does not contain `ref.ut` (a node's post-burn patches) passes the current orbit's chain.
 */
export function predictGroundTrack(
  patches: readonly PatchSpan[],
  bodyId: string,
  bodyRadius: number,
  rotationPeriod: number,
  ref: PredictionRef,
  horizonSec: number,
  stepSec: number,
  calibrationPatches: readonly PatchSpan[] = patches,
): TrackSample[] {
  PREDICT_GROUND_TRACK_BUDGET.record();
  if (patches.length === 0 || stepSec <= 0 || horizonSec <= 0) return [];

  // Flooring the step at horizon / MAX keeps long-period orbits cheap without starving short ones.
  const effectiveStep = Math.max(stepSec, horizonSec / MAX_TRACK_SAMPLES);

  const samples: TrackSample[] = [];
  for (const sample of groundTrackSamples(
    patches,
    bodyId,
    bodyRadius,
    rotationPeriod,
    ref,
    horizonSec,
    effectiveStep,
    calibrationPatches,
  )) {
    // Below the surface is an impact; its marker is drawn separately.
    if (sample.alt < MIN_RENDER_ALT_M) break;
    samples.push(sample);
  }
  return samples;
}

/**
 * Break a list of lat/lon samples into contiguous polyline segments,
 * inserting a break whenever consecutive longitudes jump by more than
 * `wrapThresholdDeg`: the telltale signature of an equirectangular
 * date-line crossing. Preserves sample order within each segment.
 *
 * `lonOf` is which longitude the seam is measured on, and a caller that draws
 * the track through a rotated projection must say so. The default reads the
 * sample's own, which is only the drawn one when the projection applies no
 * offset; MapView's does, per body.
 */
export function splitOnLongitudeWrap<Point extends { lon: number }>(
  samples: readonly Point[],
  wrapThresholdDeg = 180,
  lonOf: (sample: Point) => number = (sample) => sample.lon,
): Point[][] {
  if (samples.length === 0) return [];
  const segments: Point[][] = [[samples[0]]];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];
    if (Math.abs(lonOf(curr) - lonOf(prev)) > wrapThresholdDeg) {
      segments.push([curr]);
    } else {
      segments[segments.length - 1].push(curr);
    }
  }
  return segments;
}
