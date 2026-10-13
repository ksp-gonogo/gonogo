/**
 * Quantise universal time into buckets (default 1 s) so memoised trajectory
 * predictions invalidate once per bucket rather than every telemetry tick.
 */
export function quantiseUt(ut: number | undefined, bucketSec = 1): number {
  if (ut === undefined || !Number.isFinite(ut)) return 0;
  return Math.floor(ut / bucketSec) * bucketSec;
}
