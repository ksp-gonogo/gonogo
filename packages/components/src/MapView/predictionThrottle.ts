/**
 * Quantise universal-time into integer-second buckets so memoised
 * trajectory predictions only invalidate once per second instead of on
 * every Telemachus tick (~4 Hz). The visible difference at 1 Hz vs
 * 4 Hz is below user-perceptible — orbits drawn for 5+ minutes of
 * horizon don't change shape between two adjacent ticks 250 ms apart.
 *
 * `bucketSec` defaults to 1; tighten it for high-precision near-impact
 * tracking if needed.
 */
export function quantiseUt(ut: number | undefined, bucketSec = 1): number {
  if (ut === undefined || !Number.isFinite(ut)) return 0;
  return Math.floor(ut / bucketSec) * bucketSec;
}
