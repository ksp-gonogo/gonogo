import type { SeriesRange, SeriesTimeBasis } from "@ksp-gonogo/data";

/** Tolerance for pairing a Y sample with the most recent X sample: one second, in whichever unit the series stamps its instants. */
export function xAlignTolerance(basis: SeriesTimeBasis | undefined): number {
  return basis === "ut-seconds" ? 1 : 1000;
}

/**
 * Nearest-prior-match pairing of X and Y series by timestamp: each Y sample pairs with the newest X sample at or before it, within `tolerance`. Both inputs must be time-sorted.
 *
 * Exact timestamp matching fails because each key is stamped on its own. `ys.breaks` is reindexed onto the output because unpaired Y samples are dropped; a break whose own sample is dropped moves to the next surviving one.
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
