import { quantiseUt } from "../MapView/predictionThrottle";

/**
 * A UT bucket that cannot advance faster than wall-clock time, gating the projection solve.
 *
 * A game-seconds bucket changes every frame from 60x warp up, which would produce the placement budget's regression figure from ordinary warp. Callers pass `performance.now()`, not `Date.now()`, which the render harness pins and would freeze the bucket.
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
