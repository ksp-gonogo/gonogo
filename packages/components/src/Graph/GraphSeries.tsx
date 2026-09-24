import type {
  SeriesRange,
  SeriesReckonedSpan,
  SeriesStatusSpan,
} from "@ksp-gonogo/data";
import { useDataSeries } from "@ksp-gonogo/data";
import type {
  BandKind,
  ReckoningBasis,
  StreamStatusValue,
} from "@ksp-gonogo/sitrep-sdk";
import { useEffect } from "react";

interface Props {
  dataKey: string;
  windowSec: number;
  onData: (key: string, data: SeriesRange<number>) => void;
}

/**
 * Invisible data-fetcher component. One per series in the graph config.
 * Calls useDataSeries (a hook) in a stable component so hooks aren't
 * called conditionally inside a map.
 */
export function GraphSeries({ dataKey, windowSec, onData }: Readonly<Props>) {
  const raw = useDataSeries("data", dataKey, windowSec);

  useEffect(() => {
    onData(dataKey, toNumericSeries(raw));
  }, [raw, dataKey, onData]);

  return null;
}

/**
 * A fetched series reduced to its numeric samples, with every index-bearing
 * annotation (breaks, status spans, reckoned runs and their bands) moved onto
 * the samples that survive.
 *
 * Shared by the fetcher and by any series a widget computes itself, so a
 * computed series is cleaned exactly as a fetched one is.
 */
export function toNumericSeries(
  raw: SeriesRange<unknown>,
): SeriesRange<number> {
  const numeric: SeriesRange<number> = {
    t: [],
    v: [],
    basis: raw.basis,
    breaks: [],
    spans: [],
    reckoned: [],
    bridges: [],
    // Carried rather than reindexed: it is an instant on the same clock as
    // `t`, not a position in it, so the numeric filter below cannot move it.
    windowEndAt: raw.windowEndAt,
  };
  // `breaks` is REINDEXED, not copied: this filter drops non-numeric samples,
  // so an input index naming a hole names a different sample on the way out.
  // A break whose own sample is dropped moves onto the next one that
  // survives, because the hole is still there and still to its left.
  const inBreaks = new Set(raw.breaks ?? []);
  /*
   * `spans` is reindexed the same way and for the same reason, through a
   * per-input-sample status lookup rather than by arithmetic on the bounds: a
   * dropped sample in the middle of a recorded run has to shrink the run
   * rather than shift it, and a run that loses every sample it named has to
   * disappear rather than land on somebody else's.
   */
  const statusAt = new Map<number, StreamStatusValue>();
  for (const span of raw.spans ?? []) {
    for (let i = span.from; i <= span.to; i++) statusAt.set(i, span.status);
  }
  /*
   * `reckoned` is reindexed the same way, and the numeric filter is exactly
   * why it has to be: a model can answer for a field a chart cannot draw, and
   * a run that loses every point it named must disappear rather than land on
   * a measured one and mark it as never observed.
   */
  const basisAt = new Map<number, ReckoningBasis>();
  /*
   * The band is reindexed POINT BY POINT for the same reason: it is dense
   * over its run, so a dropped sample has to take its own two numbers with
   * it. Rebuilding the runs from a per-input-index lookup does that without
   * anything here knowing where a run starts.
   */
  const bandAt = new Map<number, { lo: number; hi: number; kind: BandKind }>();
  for (const run of raw.reckoned ?? []) {
    for (let i = run.from; i <= run.to; i++) basisAt.set(i, run.basis);
    const { bandLo, bandHi, bandKind } = run;
    if (bandLo === undefined || bandHi === undefined || bandKind === undefined)
      continue;
    for (let i = run.from; i <= run.to; i++) {
      const at = i - run.from;
      if (at >= bandLo.length || at >= bandHi.length) break;
      bandAt.set(i, { lo: bandLo[at], hi: bandHi[at], kind: bandKind });
    }
  }
  /*
   * A bridge names the chord ending at its sample, so it survives only where
   * that chord does: both samples kept, next to each other, with no break
   * between. Anything else and the chord the chart draws is a different one.
   */
  const bridgeAt = new Map((raw.bridges ?? []).map((b) => [b.to, b]));
  const outAt = new Map<number, number>();
  let open: SeriesStatusSpan | null = null;
  let openReckoned: SeriesReckonedSpan | null = null;
  let pendingBreak = false;
  for (let i = 0; i < raw.t.length; i++) {
    if (inBreaks.has(i)) pendingBreak = true;
    const n = Number(raw.v[i]);
    if (Number.isNaN(n)) continue;
    const out = numeric.t.length;
    const broken = pendingBreak && out > 0;
    if (broken) numeric.breaks?.push(out);
    pendingBreak = false;
    outAt.set(i, out);
    const bridge = bridgeAt.get(i);
    if (
      bridge !== undefined &&
      !broken &&
      outAt.get(i - 1) === out - 1 &&
      bridge.v.every(Number.isFinite)
    ) {
      numeric.bridges?.push({ ...bridge, to: out });
    }
    numeric.t.push(raw.t[i]);
    numeric.v.push(n);
    const status = statusAt.get(i);
    if (status === undefined) {
      open = null;
    } else if (open !== null && open.status === status) {
      open.to = out;
    } else {
      open = { from: out, to: out, status };
      numeric.spans?.push(open);
    }
    const basis = basisAt.get(i);
    const band = bandAt.get(i);
    if (basis === undefined) {
      openReckoned = null;
    } else if (
      openReckoned !== null &&
      openReckoned.basis === basis &&
      openReckoned.bandKind === band?.kind
    ) {
      openReckoned.to = out;
      if (band !== undefined) {
        openReckoned.bandLo?.push(band.lo);
        openReckoned.bandHi?.push(band.hi);
      }
    } else if (band !== undefined) {
      openReckoned = {
        from: out,
        to: out,
        basis,
        bandLo: [band.lo],
        bandHi: [band.hi],
        bandKind: band.kind,
      };
      numeric.reckoned?.push(openReckoned);
    } else {
      openReckoned = { from: out, to: out, basis };
      numeric.reckoned?.push(openReckoned);
    }
  }
  return numeric;
}
