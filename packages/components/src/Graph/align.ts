import type { SeriesRange } from "@ksp-gonogo/data";

/**
 * Tolerance for pairing a Y sample with the most recent X sample. Telemachus
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
 * each `handleSample` call independently — two keys on the same WS tick land
 * microseconds apart, and derived-of-raw pairs call `now()` twice.
 */
export function alignXY(
  ys: SeriesRange<number>,
  xs: SeriesRange<number>,
  tolMs = X_ALIGN_TOL_MS,
): { x: number[]; y: number[] } {
  const outX: number[] = [];
  const outY: number[] = [];
  let xi = -1;
  for (let yi = 0; yi < ys.t.length; yi++) {
    const ty = ys.t[yi];
    while (xi + 1 < xs.t.length && xs.t[xi + 1] <= ty) xi++;
    if (xi >= 0 && ty - xs.t[xi] <= tolMs) {
      outX.push(xs.v[xi] as number);
      outY.push(ys.v[yi] as number);
    }
  }
  return { x: outX, y: outY };
}
