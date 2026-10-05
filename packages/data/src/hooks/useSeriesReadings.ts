import {
  type BandKind,
  type HeldGrade,
  type Reading,
  type ReadingSeriesRange,
  type ReckoningBasis,
  type SeriesRange,
  type SeriesReckonedSpan,
  type SeriesStatusSpan,
  seriesKeyOf,
  type TopicFieldHandle,
  type UncertaintyBand,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";
import { windowSourceOf } from "./seriesWindowSource";
import { bandEnds, plotValue, useDataSeries } from "./useDataSeries";

const NO_MODEL = Object.freeze({ status: "none" }) satisfies {
  status: "none";
};

const EMPTY: ReadingSeriesRange = { t: [], readings: [] };

/** The grades a stored sample can carry: it was measured, and it arrived late. */
function lateGrade(status: string | undefined): HeldGrade | undefined {
  return status === "recorded" || status === "last-before-blackout"
    ? status
    : undefined;
}

function isQuantity(payload: unknown): payload is Value {
  return (
    payload !== null && typeof payload === "object" && "magnitude" in payload
  );
}

/** A band as a reading carries it. A bare-number payload takes the unit its band's ends arrived in. */
function bandOf(
  modelled: unknown,
  band: { lo: Value; hi: Value; kind: BandKind },
): UncertaintyBand | undefined {
  if (isQuantity(modelled)) return { value: modelled, ...band };
  if (typeof modelled !== "number") return undefined;
  return { value: value(band.lo.unit, modelled), ...band };
}

/** A window `useDataSeries` built, with each sample handed back as the reading it was. */
function readingSeriesOf(range: SeriesRange): ReadingSeriesRange {
  const source = windowSourceOf(range);
  if (source === undefined) return EMPTY;
  const gradeAt = new Map<number, HeldGrade>();
  for (const span of range.spans ?? []) {
    const grade = lateGrade(span.status);
    if (grade === undefined) continue;
    for (let i = span.from; i <= span.to; i++) gradeAt.set(i, grade);
  }
  let lastObserved: { payload: unknown; at: Value<"ut"> } | undefined;
  const readings = range.t.map((t, i): Reading<unknown> => {
    const at = value("ut", t);
    const payload = source.payloads[i];
    const model = source.modelled.get(i);
    if (model !== undefined) {
      const reckoning = {
        status: "available" as const,
        modelled: payload,
        atUt: at,
        beyondReceived: true,
        basis: model.basis,
        band: model.band ? bandOf(payload, model.band) : undefined,
      };
      // The last observation can sit off the window's left edge, and then there is nothing held to show beside the model's figure.
      if (lastObserved === undefined) return { state: "pending", reckoning };
      return {
        state: "held",
        value: lastObserved.payload,
        asOfUt: lastObserved.at,
        grade: "held",
        reckoning,
      };
    }
    lastObserved = { payload, at };
    const grade = gradeAt.get(i);
    if (grade !== undefined) {
      return {
        state: "held",
        value: payload,
        asOfUt: at,
        grade,
        reckoning: NO_MODEL,
      };
    }
    return { state: "observed", value: payload, atUt: at, reckoning: NO_MODEL };
  });
  return {
    t: range.t,
    readings,
    basis: range.basis,
    breaks: range.breaks,
    bridges: range.bridges,
    windowEndAt: range.windowEndAt,
  };
}

/**
 * Windowed time-series of one field, each sample a `Reading`: its value with
 * the unit still on it, and whether the craft measured it, sent it late, or a
 * model supplied it. Empty when no `TelemetryProvider` is mounted.
 *
 * The same window `useDataSeries` reads, so the two never disagree about what
 * is in it.
 */
export function useSeriesReadings(
  handle: TopicFieldHandle,
  windowSec: number,
): ReadingSeriesRange {
  const range = useDataSeries(seriesKeyOf(handle), windowSec);
  return useMemo(() => readingSeriesOf(range), [range]);
}

/** Extends an open status span onto `out`, or starts a new one; closes it when `status` is absent. */
function advanceStatusSpan(
  spans: SeriesStatusSpan[],
  open: SeriesStatusSpan | null,
  out: number,
  status: HeldGrade | undefined,
): SeriesStatusSpan | null {
  if (status === undefined) return null;
  if (open !== null && open.status === status) {
    open.to = out;
    return open;
  }
  const next: SeriesStatusSpan = { from: out, to: out, status };
  spans.push(next);
  return next;
}

/** Extends an open reckoned run onto `out`, carrying its band, or starts a new one; closes it when `basis` is absent. */
function advanceReckonedRun(
  runs: SeriesReckonedSpan[],
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
  runs.push(next);
  return next;
}

/** A figure as the number a chart plots: a quantity's magnitude, a bare number as it is, and `NaN` for anything else. */
export function plottedFigure(figure: unknown): number {
  return Number(plotValue(figure));
}

function plottedBand(
  band: UncertaintyBand | undefined,
): { lo: number; hi: number; kind: BandKind } | undefined {
  const [lo, hi] = bandEnds(band?.lo, band?.hi);
  if (band === undefined || lo === undefined || hi === undefined)
    return undefined;
  return { lo, hi, kind: band.kind };
}

/**
 * What a chart draws of a reading series: the numeric samples, with the
 * modelled runs and their bands, the late-arriving runs, the breaks and the
 * bridges all read off the samples themselves and indexed against the samples
 * that survive.
 *
 * A sample plots at its model's figure where a model supplied it and at its
 * observation otherwise. One with no finite number is dropped: a break on it
 * moves to the next survivor, since the hole is still to its left, a run that
 * loses every sample disappears, and a bridge survives only where both of its
 * samples are kept, adjacent, with no break between.
 */
export function plotColumnsOf(series: ReadingSeriesRange): SeriesRange<number> {
  const spans: SeriesStatusSpan[] = [];
  const reckoned: SeriesReckonedSpan[] = [];
  const numeric: SeriesRange<number> & {
    breaks: number[];
    bridges: NonNullable<SeriesRange["bridges"]>;
  } = {
    t: [],
    v: [],
    basis: series.basis,
    breaks: [],
    spans,
    reckoned,
    bridges: [],
    // An instant on the same clock as `t`, not an index, so it is carried rather than reindexed.
    windowEndAt: series.windowEndAt,
  };
  const inBreaks = new Set(series.breaks ?? []);
  const bridgeAt = new Map((series.bridges ?? []).map((b) => [b.to, b]));
  const outAt = new Map<number, number>();
  let open: SeriesStatusSpan | null = null;
  let openReckoned: SeriesReckonedSpan | null = null;
  let pendingBreak = false;
  for (let i = 0; i < series.t.length; i++) {
    if (inBreaks.has(i)) pendingBreak = true;
    const reading = series.readings[i];
    const model =
      reading.reckoning.status === "available" ? reading.reckoning : undefined;
    const n = plottedFigure(model ? model.modelled : reading.value);
    if (Number.isNaN(n)) continue;
    const out = numeric.t.length;
    const broken = pendingBreak && out > 0;
    if (broken) numeric.breaks.push(out);
    pendingBreak = false;
    outAt.set(i, out);
    const bridge = bridgeAt.get(i);
    if (
      bridge !== undefined &&
      !broken &&
      outAt.get(i - 1) === out - 1 &&
      bridge.v.every(Number.isFinite)
    ) {
      numeric.bridges.push({ ...bridge, to: out });
    }
    numeric.t.push(series.t[i]);
    numeric.v.push(n);
    const late =
      model === undefined && reading.state === "held"
        ? lateGrade(reading.grade)
        : undefined;
    open = advanceStatusSpan(spans, open, out, late);
    openReckoned = advanceReckonedRun(
      reckoned,
      openReckoned,
      out,
      model?.basis,
      plottedBand(model?.band),
    );
  }
  return numeric;
}
