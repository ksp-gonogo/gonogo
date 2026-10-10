/**
 * The scale of the descent-rate trend: the widest the vertical speed has been this descent, with zero always in it.
 * It only widens. A scale taken from the window's own extremes rescaled the whole line the moment the largest sample slid out of the window, which read as the figures jumping.
 */
export function widenTrendDomain(
  previous: readonly [number, number] | null,
  sample: number,
): [number, number] {
  const [lo, hi] = previous ?? [0, 0];
  if (!Number.isFinite(sample)) return [lo, hi];
  return [Math.min(lo, sample, 0), Math.max(hi, sample, 0)];
}
