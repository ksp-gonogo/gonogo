import { quantiseUt } from "../MapView/predictionThrottle";

/**
 * A UT bucket that cannot advance faster than wall-clock time, used to gate the
 * projection solve.
 *
 * The bare game-time bucket throttles nothing under time warp. It exists so the
 * expensive solve runs about once a second, and it is keyed on GAME seconds
 * while this widget re-renders every animation frame, so once UT advances a
 * whole second inside one frame the bucket changes on every frame instead. That
 * happens at 60x, and the warp ladder goes to 100,000x.
 *
 * The cost is not hypothetical: a 34-body solve places 34 x (1 + ring samples)
 * points, so rebuilding it per frame is about 198,000 placements a second. That
 * is the figure `SystemView body placements/sec` was written to treat as a
 * regression, which ordinary warp would otherwise produce on its own, leaving
 * the budget unable to tell the two apart.
 *
 * `realMs` is injected rather than read from a clock here so the throttle can be
 * driven directly by a test. Callers pass `performance.now()`, not `Date.now()`:
 * the render harness pins `Date.now()` to keep snapshots deterministic, and a
 * throttle measuring elapsed time against a frozen clock would adopt its first
 * bucket and then never advance.
 */
export function createUtBucketThrottle({
  bucketSec = 1,
  minRealMs = 1000,
}: {
  bucketSec?: number;
  minRealMs?: number;
} = {}): (ut: number | undefined, realMs: number) => number {
  let adopted: number | null = null;
  let adoptedAtRealMs = 0;
  return (ut, realMs) => {
    const candidate = quantiseUt(ut, bucketSec);
    if (adopted === null) {
      adopted = candidate;
      adoptedAtRealMs = realMs;
      return adopted;
    }
    if (candidate !== adopted && realMs - adoptedAtRealMs >= minRealMs) {
      adopted = candidate;
      adoptedAtRealMs = realMs;
    }
    return adopted;
  };
}
