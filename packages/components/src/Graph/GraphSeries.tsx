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

/** Invisible per-series fetcher, so `useDataSeries` is never called conditionally inside a map. */
export function GraphSeries({ dataKey, windowSec, onData }: Readonly<Props>) {
  const raw = useDataSeries(dataKey, windowSec);

  useEffect(() => {
    onData(dataKey, toNumericSeries(raw));
  }, [raw, dataKey, onData]);

  return null;
}

/** Extends an open status span onto `out`, or starts a new one; closes it when `status` is absent. */
function advanceStatusSpan(
  spans: SeriesStatusSpan[] | undefined,
  open: SeriesStatusSpan | null,
  out: number,
  status: StreamStatusValue | undefined,
): SeriesStatusSpan | null {
  if (status === undefined) return null;
  if (open !== null && open.status === status) {
    open.to = out;
    return open;
  }
  const next: SeriesStatusSpan = { from: out, to: out, status };
  spans?.push(next);
  return next;
}

/** Extends an open reckoned run onto `out`, carrying its band, or starts a new one; closes it when `basis` is absent. */
function advanceReckonedRun(
  runs: SeriesReckonedSpan[] | undefined,
  open: SeriesReckonedSpan | null,
  out: number,
  basis: ReckoningBasis | undefined,
  band: { lo: number; hi: number; kind: BandKind } | undefined,
): SeriesReckonedSpan | null {
  if (basis === undefined) return null;
  if (open !== null && open.basis === basis && open.bandKind === band?.kind) {
    open.to = out;
    if (band !== undefined) {
      open.bandLo?.push(band.lo);
      open.bandHi?.push(band.hi);
    }
    return open;
  }
  const next: SeriesReckonedSpan =
    band !== undefined
      ? {
          from: out,
          to: out,
          basis,
          bandLo: [band.lo],
          bandHi: [band.hi],
          bandKind: band.kind,
        }
      : { from: out, to: out, basis };
  runs?.push(next);
  return next;
}

/** A series reduced to its numeric samples, with every index-bearing annotation (breaks, status spans, reckoned runs and their bands, bridges) moved onto the samples that survive. */
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
    // An instant on the same clock as `t`, not an index, so it is carried rather than reindexed.
    windowEndAt: raw.windowEndAt,
  };
  // A break whose own sample is dropped moves onto the next surviving sample, since the hole is still to its left.
  const inBreaks = new Set(raw.breaks ?? []);
  // Spans, reckoned runs and bands are rebuilt from per-input-index lookups so a dropped sample shrinks its run, and a run that loses every sample disappears rather than landing on another.
  const statusAt = new Map<number, StreamStatusValue>();
  for (const span of raw.spans ?? []) {
    for (let i = span.from; i <= span.to; i++) statusAt.set(i, span.status);
  }
  const basisAt = new Map<number, ReckoningBasis>();
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
  // A bridge names the chord ending at its sample, so it survives only where both samples are kept, adjacent, with no break between.
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
    open = advanceStatusSpan(numeric.spans, open, out, status);
    const basis = basisAt.get(i);
    const band = bandAt.get(i);
    openReckoned = advanceReckonedRun(
      numeric.reckoned,
      openReckoned,
      out,
      basis,
      band,
    );
  }
  return numeric;
}
