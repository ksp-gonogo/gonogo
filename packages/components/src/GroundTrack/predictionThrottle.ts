import { useTelemetryStoreOptional } from "@ksp-gonogo/sitrep-client";
import { useRef } from "react";

/**
 * Quantise universal time into buckets (default 1 s) so memoised trajectory
 * predictions invalidate once per bucket rather than every telemetry tick.
 */
export function quantiseUt(ut: number | undefined, bucketSec = 1): number {
  if (ut === undefined || !Number.isFinite(ut)) return 0;
  return Math.floor(ut / bucketSec) * bucketSec;
}

/** The shortest real time between two solves of the same prediction: five a second each. */
export const MIN_SOLVE_INTERVAL_MS = 200;

/**
 * `quantiseUt` of several instants together, held for at least
 * `MIN_SOLVE_INTERVAL_MS` of the view clock's wall time once any of them has
 * moved forward. At time warp a universal-time bucket turns over many times a
 * second, and a prediction keyed on it would be solved at that rate; the held
 * buckets advance together on the first frame after the interval, so the track
 * trails the clock by at most that interval and never stops following it. A
 * first reading is taken at once, and so is a bucket that moves backward (a
 * revert or a scrub).
 */
export function useThrottledBuckets(
  uts: readonly (number | undefined)[],
  bucketSec = 1,
  nowMs?: () => number,
): number[] {
  const store = useTelemetryStoreOptional();
  const buckets = uts.map((ut) => quantiseUt(ut, bucketSec));
  const absent = uts.some((ut) => ut === undefined || !Number.isFinite(ut));
  const held = useRef<{ buckets: number[]; at: number } | null>(null);
  const now = nowMs
    ? nowMs()
    : store
      ? store.clock.wallNow() * 1000
      : undefined;
  if (absent || now === undefined) {
    held.current = null;
    return buckets;
  }
  const current = held.current;
  const moved =
    current === null || buckets.some((b, i) => b !== current.buckets[i]);
  const backward =
    current !== null && buckets.some((b, i) => b < current.buckets[i]);
  if (
    current === null ||
    backward ||
    (moved && now - current.at >= MIN_SOLVE_INTERVAL_MS)
  ) {
    held.current = { buckets, at: now };
    return buckets;
  }
  return current.buckets;
}

/** One instant's `useThrottledBuckets`. */
export function useThrottledBucket(
  ut: number | undefined,
  bucketSec = 1,
  nowMs?: () => number,
): number {
  return useThrottledBuckets([ut], bucketSec, nowMs)[0];
}
