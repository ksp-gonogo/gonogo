import type { SeriesRange, SeriesTimeBasis } from "@ksp-gonogo/data";

/**
 * Tolerance for pairing a Y sample with the most recent X sample: one second,
 * in whichever unit the series stamps its instants. Telemetry ticks at ~4 Hz,
 * so a second bridges one dropped tick; read in the wrong unit it pairs
 * samples a thousand times further apart.
 */
export function xAlignTolerance(basis: SeriesTimeBasis | undefined): number {
  return basis === "ut-seconds" ? 1 : 1000;
}

/**
 * Nearest-prior-match pairing of X + Y series by timestamp. For each Y sample
 * at `t_y`, picks the newest X sample with `t_x <= t_y`, emitting the pair if
 * `t_y - t_x <= tolerance`. Assumes both inputs are time-sorted (which
 * `useDataSeries` guarantees).
 *
 * Exact timestamp match isn't viable because each key is stamped on its own,
 * so two keys from the same tick can land a fraction of a tick apart.
 *
 * `ys.breaks` is REINDEXED onto the output rather than passed through, because
 * this drops any Y sample it cannot pair: an index that named a hole in the
 * input names a different sample in the output, or none. Passed through
 * unchanged it would break the trace in the wrong place, which is worse than
 * not breaking it at all. A break whose own sample is dropped is carried onto
 * the next surviving one, since the hole is still there and still to the left
 * of whatever draws next.
 */
export function alignXY(
  ys: SeriesRange<number>,
  xs: SeriesRange<number>,
  tolerance = xAlignTolerance(ys.basis),
): { x: number[]; y: number[]; breaks: number[] } {
  const outX: number[] = [];
  const outY: number[] = [];
  const outBreaks: number[] = [];
  const inBreaks = new Set(ys.breaks ?? []);
  let pendingBreak = false;
  let xi = -1;
  for (let yi = 0; yi < ys.t.length; yi++) {
    const ty = ys.t[yi];
    if (inBreaks.has(yi)) pendingBreak = true;
    while (xi + 1 < xs.t.length && xs.t[xi + 1] <= ty) xi++;
    if (xi >= 0 && ty - xs.t[xi] <= tolerance) {
      if (pendingBreak && outY.length > 0) outBreaks.push(outY.length);
      pendingBreak = false;
      outX.push(xs.v[xi] as number);
      outY.push(ys.v[yi] as number);
    }
  }
  return { x: outX, y: outY, breaks: outBreaks };
}
