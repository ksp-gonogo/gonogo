import type { GapModel } from "@ksp-gonogo/sitrep-client";
import {
  subscribeTopicRead,
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "@ksp-gonogo/sitrep-client";
import type { StreamStatusValue } from "@ksp-gonogo/sitrep-sdk";
import { Staleness } from "@ksp-gonogo/sitrep-sdk";
import { useCallback, useRef, useSyncExternalStore } from "react";
import type {
  SeriesBridge,
  SeriesRange,
  SeriesReckonedSpan,
  SeriesStatusSpan,
} from "../types";

/**
 * Deliberately carries no `basis`: an empty series has no `t` to be stamped
 * in either clock, and the chart's own
 * no-samples fallback domain is a wall-clock window. Declaring UT here would
 * mislabel that fallback in the one case where there is nothing plotted to
 * check the ladder against.
 */
const EMPTY: SeriesRange = { t: [], v: [] };

/**
 * A sample's own STAMPED grade, or `null` when it carries none.
 *
 * Deliberately not `TimelineStore.sampleStatus`: that answers for a topic at
 * the view frame, folding in transport state and the heartbeat tracker, which
 * is the right read for "how current is this widget" and the wrong one to ask
 * once per sample. A series needs what the server said about THIS point. The
 * precedence between the stamped grades is `sampleRawStatus`'s own.
 */
function stalenessToStreamStatus(
  staleness: Staleness | undefined,
): StreamStatusValue | null {
  switch (staleness) {
    case Staleness.LastBeforeBlackout:
      return "last-before-blackout";
    case Staleness.Recorded:
      return "recorded";
    default:
      return null;
  }
}

/**
 * Contiguous runs of stamped, non-live samples, as inclusive index ranges.
 *
 * `Staleness.HeldStale` is deliberately not among them: it is a claim about
 * the newest reading's currency, not about the provenance of a span of
 * history, so a run named with it would state something the wire never did.
 * `recorded` and `last-before-blackout` are per-sample facts about where the
 * sample came from.
 *
 * A consumer NAMES these runs, it does not grade them: every sample here is
 * one the craft measured, so `LineChart` draws them exactly as it draws live
 * ones. See `SeriesStatusSpan`, which carries the reasoning.
 */
function buildSpans(
  points: readonly { meta: { staleness?: Staleness } }[],
): SeriesStatusSpan[] {
  const spans: SeriesStatusSpan[] = [];
  let open: SeriesStatusSpan | null = null;
  for (let i = 0; i < points.length; i++) {
    const status = stalenessToStreamStatus(points[i].meta.staleness);
    if (status === null) {
      open = null;
      continue;
    }
    if (open !== null && open.status === status) {
      open.to = i;
      continue;
    }
    open = { from: i, to: i, status };
    spans.push(open);
  }
  return spans;
}

/**
 * The plotted form of one carried gap, made once per judgement. The store hands
 * back the same judgement until something it was judged from moves, so keying
 * on it keeps a bridge's arrays stable across frames and lets the snapshot
 * compare them by identity.
 */
const plottedGaps = new WeakMap<
  Extract<GapModel, { carried: true }>,
  Omit<SeriesBridge, "to">
>();

function plottedGap(
  gap: Extract<GapModel, { carried: true }>,
): Omit<SeriesBridge, "to"> {
  const known = plottedGaps.get(gap);
  if (known) return known;
  const plotted = {
    t: gap.t,
    v: gap.v.map((answer) => {
      const n = plotValue(answer);
      return typeof n === "number" ? n : Number.NaN;
    }),
    basis: gap.basis,
  };
  plottedGaps.set(gap, plotted);
  return plotted;
}

function bridgesEqual(
  a: readonly SeriesBridge[],
  b: readonly SeriesBridge[],
): boolean {
  return (
    a.length === b.length &&
    a.every((bridge, i) => bridge.to === b[i].to && bridge.v === b[i].v)
  );
}

function spansEqual(
  a: readonly SeriesStatusSpan[],
  b: readonly SeriesStatusSpan[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (span, i) =>
        span.from === b[i].from &&
        span.to === b[i].to &&
        span.status === b[i].status,
    )
  );
}

function numbersEqual(
  a: readonly number[] | undefined,
  b: readonly number[] | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((n, i) => Object.is(n, b[i]));
}

/*
 * The BAND is compared point by point, and it is the one part of a run that
 * can move while every index stays put. A model whose uncertainty widens as
 * the view time runs away from the last contact re-answers the same instants
 * with a wider interval every frame: `from`, `to` and `basis` all hold, so a
 * run-shape comparison would call the snapshot unchanged and the shading would
 * freeze at whatever width it had when the tail first appeared. Exactly the
 * failure `windowEndAt` is in this check for.
 */
function reckonedEqual(
  a: readonly SeriesReckonedSpan[],
  b: readonly SeriesReckonedSpan[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (run, i) =>
        run.from === b[i].from &&
        run.to === b[i].to &&
        run.basis === b[i].basis &&
        run.bandKind === b[i].bandKind &&
        numbersEqual(run.bandLo, b[i].bandLo) &&
        numbersEqual(run.bandHi, b[i].bandHi),
    )
  );
}

/** A sample as a plottable value: a quantity's magnitude, anything else as-is. */
function plotValue(payload: unknown): unknown {
  return payload !== null &&
    typeof payload === "object" &&
    "magnitude" in payload
    ? (payload as { magnitude: unknown }).magnitude
    : payload;
}

/**
 * Windowed time-series of one Topic or field path, read off the stream's
 * `TimelineStore`. Empty when no `TelemetryProvider` is mounted.
 *
 * A raw Topic or field path reads its window through `sampleRange`. A DERIVED
 * Topic stores no history of its own, so `sampleDerivedRange` replays the
 * channel's `derive()` at every UT its raw inputs changed within the window.
 *
 * `t` is UT seconds. The window closes at `currentFrame().viewUt`, the same
 * frozen view time every other read in the frame uses, which is the confirmed
 * edge while live, so a sample past it does not appear in the history early.
 */
export function useDataSeries(key: string, windowSec: number): SeriesRange {
  /*
   * The last `SeriesRange` built, so an unchanged read reuses the same object
   * identity instead of handing `useSyncExternalStore` a fresh one every call.
   */
  const lastSnapshotRef = useRef<SeriesRange>(EMPTY);

  const client = useTelemetryClientOptional();
  const store = useTelemetryStoreOptional();
  const topic = key;

  const subscribeStream = useCallback(
    (onStoreChange: () => void) => {
      if (!client || !store) {
        return () => {};
      }
      // The seam resolves a DERIVED topic to its raw `inputs` (recursively):
      // the exact same raw topics `sampleDerivedRange` below reads via
      // `sampleRange`, so subscribing here is what keeps those raw timelines
      // populated for the replay. It holds the plotted topic's elected
      // reckoner's declared deps up too, which is what the RECKONED tail below
      // needs, and which every point read needs for the same reason.
      const releaseInputs = subscribeTopicRead(client, store, topic);
      const unsubscribeFrame = store.subscribeFrame(onStoreChange);
      return () => {
        unsubscribeFrame();
        releaseInputs();
      };
    },
    [client, store, topic],
  );

  const getStreamSnapshot = useCallback((): SeriesRange => {
    if (!store) {
      return EMPTY;
    }
    const toUt = store.currentFrame().viewUt;
    const fromUt = toUt - windowSec;
    // A DERIVED topic (`system.state.*` and friends) has no stored range of
    // its own: `sampleRange` always returns `undefined` for it by design
    // (see that method's own doc). `sampleDerivedRange` is the derived-topic
    // counterpart: it replays the channel's `derive()` off its raw inputs'
    // own buffered ranges instead. Every other (raw / raw-field-subtopic)
    // topic keeps reading straight off `sampleRange`, unchanged.
    const points = store.isDerivedTopic(topic)
      ? store.sampleDerivedRange<unknown>(topic, fromUt, toUt)
      : store.sampleRange<unknown>(topic, fromUt, toUt);
    /*
     * The part of the window nobody measured, off the topic's own forward
     * model. Both halves are read here, at the boundary that draws them, and
     * joined below: a reckoned instant is a presentation-time projection, so it
     * exists nowhere a later read could take it for an observation. See
     * `TimelineStore.sampleReckonedTail`, which is the only thing that mints
     * one and which nothing else in the tree calls.
     */
    const tail = store.sampleReckonedTail<unknown>(topic, fromUt, toUt);
    const observed = points ?? [];
    /*
     * A tail with no observed run in front of it is a real window and worth
     * drawing: the last observation can sit off the left edge while the model
     * still answers for everything since. Only a window with neither half is
     * empty.
     */
    if (observed.length === 0 && tail.length === 0) return EMPTY;

    const nextT = observed.map((p) => p.validAt);
    // Known holes, carried out of the store instead of discarded at this
    // boundary. `meta.gapSinceUt` is the server saying "there is no data
    // between that UT and this sample's own", and until this line it reached
    // the store and stopped: `SeriesRange` was `{t, v}`, so every chart in the
    // tree joined across an outage it had no readings for. Index rather than UT
    // because a chart splits its path by position, not by time.
    // Magnitudes: a series feeds a sparkline and a graph axis, which plot
    // numbers. A declared quantity arrives wrapped from the decode, so
    // without this every stream-backed chart drew nothing.
    const nextV = observed.map((p) => plotValue(p.payload));
    const nextBreaks: number[] = [];
    const nextBridges: SeriesBridge[] = [];
    for (let i = 0; i < observed.length; i++) {
      // The FIRST point cannot open a break in the drawn series: there is no
      // segment before it to break. The hole is real, and it is off the left
      // edge of the window, where a chart already draws nothing.
      if (i === 0) continue;
      if (observed[i].meta.gapSinceUt != null) {
        nextBreaks.push(i);
        continue;
      }
      /*
       * A value that did not move is left joined: the emitter only withholds a
       * sample that compares equal, so a flat segment is what every unsent
       * observation between the two said. One that moved across a span the
       * sampling missed is a line nothing measured: a break where the topic's
       * own model will not carry the span, or where no model claims one that
       * warp thinned, and the model's path beside the chord where it will, for
       * the chart to hold one against the other.
       */
      if (Object.is(nextV[i], nextV[i - 1])) continue;
      const gap = store.gapModel(topic, observed[i - 1], observed[i]);
      if (gap?.carried === false) {
        nextBreaks.push(i);
        continue;
      }
      if (gap?.carried) nextBridges.push({ to: i, ...plottedGap(gap) });
    }
    /*
     * Which runs of the window came off the craft's own recorder rather than
     * off a live link. `breaks` above says what is GONE; this says what is
     * merely LATE, and without it a replayed span and a live span leave the
     * store looking identical, which is the one distinction the blackout model
     * exists to make.
     */
    const nextSpans = buildSpans(observed);
    /*
     * The tail lands AFTER every observation and never among them: it starts at
     * the newest one and runs to the frame's view time, so appending is what
     * keeps `t` ascending. Its runs are named by index, the same currency
     * `breaks` and `spans` use, so a chart splits its path once for all three.
     */
    const nextReckoned: SeriesReckonedSpan[] = [];
    for (const sample of tail) {
      const i = nextT.length;
      nextT.push(sample.atUt);
      /*
       * Through the SAME unwrap the observed half takes, because a modelled
       * instant of a `Value`-typed quantity arrives wrapped exactly as an
       * observed one does.
       */
      nextV.push(plotValue(sample.value));
      /*
       * A banded instant and an unbanded one do not share a run even under one
       * basis, and neither do two kinds. A run carries ONE `bandKind` over a
       * DENSE `bandLo`/`bandHi`, so folding a bandless instant into a banded
       * run would leave the arrays shorter than the indices they answer for.
       *
       * `kind` is read through the two numbers rather than off `bandKind`
       * alone, so a sample carrying half a band joins the unbanded runs
       * instead of opening a banded one it cannot fill.
       */
      const { bandLo, bandHi } = sample;
      /*
       * The ends cross the same boundary `plotValue` just took the value
       * across, and in the same file on purpose: a tail's band arrives as two
       * quantities in the value's own unit and `SeriesReckonedSpan` holds
       * magnitudes, so this is where the shading stops being a quantity. It
       * used to be unwrapped back in the store, which put the band a layer
       * ahead of the number it describes and left nothing in between able to
       * notice a unit.
       */
      const lo = bandLo?.toWire();
      const hi = bandHi?.toWire();
      const kind =
        lo !== undefined && hi !== undefined ? sample.bandKind : undefined;
      const open = nextReckoned[nextReckoned.length - 1];
      const continues =
        open !== undefined &&
        open.basis === sample.basis &&
        open.to === i - 1 &&
        open.bandKind === kind;
      if (open !== undefined && continues) {
        open.to = i;
        if (lo !== undefined && hi !== undefined && kind !== undefined) {
          open.bandLo?.push(lo);
          open.bandHi?.push(hi);
        }
        continue;
      }
      if (lo !== undefined && hi !== undefined && kind !== undefined) {
        nextReckoned.push({
          from: i,
          to: i,
          basis: sample.basis,
          bandLo: [lo],
          bandHi: [hi],
          bandKind: kind,
        });
        continue;
      }
      nextReckoned.push({ from: i, to: i, basis: sample.basis });
    }

    // `sampleRange` builds a fresh filtered array (and, for a raw
    // field-subtopic, fresh wrapper `TimelinePoint`s: see its own doc
    // comment) on EVERY call; it is deliberately not frame-memoized like
    // `sample()` is. A naive `{ t: nextT, v: nextV }` here would hand
    // `useSyncExternalStore` a new object identity on every single
    // getSnapshot call even when nothing actually changed, which trips
    // React's "should be cached to avoid an infinite loop" guard (object
    // identity flip-flopping between render-time and effect-time forces an
    // endless re-render). Comparing by VALUE rather than the underlying
    // points' object identity is what actually detects "truly nothing
    // changed" here, cheap at sparkline/window sizes, and reuses the last
    // built `SeriesRange`.
    // `breaks` joins the equality check for the same reason `t` and `v` are in
    // it: a window can slide so that a hole's opening sample changes index
    // while every t and v stays put, and returning the memoised range there
    // would leave a chart drawing across a hole it had already been told about.
    // `spans` joins it for the same reason again: a reacquisition can restamp a
    // run without moving a single t or v.
    //
    // `reckoned` is in it for a reason the other three do not have: the tail is
    // recomputed against a view time that moves every frame, so it is the one
    // annotation that can change while nothing has arrived at all. Its runs
    // move with `t`, so the length check catches most of it, but a model
    // withdrawing at its horizon shortens the runs without shortening `t`.
    const prev = lastSnapshotRef.current;
    const prevBreaks = prev.breaks ?? [];
    const unchanged =
      prev.t.length === nextT.length &&
      prev.t.every((t, i) => t === nextT[i]) &&
      prev.v.every((v, i) => Object.is(v, nextV[i])) &&
      prevBreaks.length === nextBreaks.length &&
      prevBreaks.every((b, i) => b === nextBreaks[i]) &&
      bridgesEqual(prev.bridges ?? [], nextBridges) &&
      spansEqual(prev.spans ?? [], nextSpans) &&
      reckonedEqual(prev.reckoned ?? [], nextReckoned) &&
      /*
       * Only ever set alongside a tail (see below), and there it MUST be
       * compared: a model that has already declined leaves `t` and every run
       * fixed while the view time keeps advancing, and the growing blank
       * between the two is the only thing that changes.
       */
      prev.windowEndAt === (nextReckoned.length > 0 ? toUt : undefined);
    if (unchanged) return prev;

    lastSnapshotRef.current = {
      t: nextT,
      v: nextV,
      // UT seconds, which is what `sampleRange` stamps `validAt` in. Stated
      // rather than left for the consumer to guess: see `SeriesTimeBasis`.
      basis: "ut-seconds",
      breaks: nextBreaks,
      bridges: nextBridges,
      spans: nextSpans,
      reckoned: nextReckoned,
      /*
       * Only where a model actually answered for part of the window. Stating
       * it always would put the frame's view time into the snapshot of every
       * live chart, and a live chart's view time advances every frame, so a
       * window with nothing new in it would stop returning `prev` and start
       * re-rendering at frame rate for no change. A chart WITH a tail already
       * re-renders per frame by construction, so confining it there costs
       * nothing that was not already being spent.
       */
      windowEndAt: nextReckoned.length > 0 ? toUt : undefined,
    };
    return lastSnapshotRef.current;
  }, [store, topic, windowSec]);

  return useSyncExternalStore(subscribeStream, getStreamSnapshot);
}
