import type { SeriesRange } from "@ksp-gonogo/data";

/**
 * Tolerance for pairing a Y sample with the most recent X sample. Telemetry
 * ticks at ~4 Hz and derived samples stamp at call time, so same-tick pairs
 * can drift by a few ms; 1 s also bridges one dropped tick.
 */
export const X_ALIGN_TOL_MS = 1000;

/**
 * Nearest-prior-match pairing of X + Y series by timestamp. For each Y sample
 * at `t_y`, picks the newest X sample with `t_x <= t_y`, emitting the pair if
 * `t_y - t_x <= tolMs`. Assumes both inputs are time-sorted (which
 * `useDataSeries` guarantees).
 *
 * Exact timestamp match isn't viable here because `BufferedDataSource` stamps
 * each `handleSample` call independently: two keys on the same WS tick land
 * microseconds apart, and derived-of-raw pairs call `now()` twice.
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
  tolMs = X_ALIGN_TOL_MS,
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
    if (xi >= 0 && ty - xs.t[xi] <= tolMs) {
      if (pendingBreak && outY.length > 0) outBreaks.push(outY.length);
      pendingBreak = false;
      outX.push(xs.v[xi] as number);
      outY.push(ys.v[yi] as number);
    }
  }
  return { x: outX, y: outY, breaks: outBreaks };
}
