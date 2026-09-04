import {
  type DataSource,
  getDataSource,
  useDataSourceSubscription,
} from "@ksp-gonogo/core";
import {
  isTopicCarried,
  mapTopic,
  useCarriedChannelsOptional,
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
  warnGatedRead,
} from "@ksp-gonogo/sitrep-client";
import type {
  BufferedDataSource,
  StreamStatusValue,
} from "@ksp-gonogo/sitrep-sdk";
import { Staleness } from "@ksp-gonogo/sitrep-sdk";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type {
  SeriesRange,
  SeriesReckonedSpan,
  SeriesStatusSpan,
} from "../types";

/**
 * Shared by both branches, and deliberately carries no `basis`: an empty
 * series has no `t` to be stamped in either clock, and the chart's own
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
        run.basis === b[i].basis,
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
 * Windowed time-series of a single key from the buffered data layer.
 *
 * On mount (or when `key`/`windowSec` changes): backfills from
 * `queryRange` so the graph renders with history immediately.
 *
 * Live: appends every timestamped sample, trimming samples older than
 * `now - windowSec * 1000`.
 *
 * Returns a fresh `SeriesRange` object per update so React's snapshot
 * comparison triggers a re-render, the internal arrays are mutated in
 * place for cheap appends, then a shallow `{ t, v }` wrapper is built at
 * snapshot time.
 *
 * **The M3 stream shim (last M3 read-side unlock).** Mirrors `@ksp-gonogo/core`'s
 * `useDataValue` shim exactly one level up, for the plotted/sparkline series
 * `GraphView`-based widgets read (`GraphSeries`, `SemiMajorAxis`, `Twr`,
 * `PowerSystems`, `KeplerPeriod`, `OrbitalAscent`, `EscapeProfile`). Same
 * `mapTopic(sourceId, key)` migration table, same carried-channels allowlist
 * gate (`isTopicCarried`): see `use-telemetry.ts`'s doc comment for the full
 * "why" on both; not reproduced here.
 *
 * The one thing genuinely different from `useDataValue`: a DERIVED topic
 * (`vessel.state.*`) has a live per-frame VALUE (`sample()`) but no stored
 * HISTORY: nothing ever buffers a range of computed values, only the raw
 * inputs it's computed from. `TimelineStore.sampleRange` returns `undefined`
 * for exactly this case (as opposed to `[]`, "genuinely nothing landed
 * yet"). Rather than falling back to legacy for every derived topic
 * (the pre-M4 behavior: dead weight once the legacy `BufferedDataSource`
 * is deleted), this hook calls `TimelineStore.sampleDerivedRange` instead:
 * it replays the derived channel's own `derive()` function at every UT its
 * raw inputs changed within the window, off `sampleRange` reads of those
 * raw inputs: a REAL series built off real buffered stream history, no
 * legacy DataSource involved. See `sampleDerivedRange`'s own doc comment
 * for the replay mechanics.
 *
 * A MAPPED + CARRIED raw topic, or a raw record field-subtopic, reads its
 * window straight off
 * `TimelineStore.sampleRange`, mapping each `TimelinePoint`'s
 * `validAt`/`payload` into this hook's existing `{ t, v }` shape, the exact
 * same shape a consumer already gets from the legacy path, so no
 * `GraphSeries`/widget code needs to change. `t` here is UT (game universal
 * time, seconds) rather than the legacy path's wall-clock `Date.now()`
 * milliseconds: an internal-only distinction; every current consumer only
 * ever reads `v` for a sparkline, or treats `t` as an opaque monotonic
 * x-axis for its own `windowSec`-scoped chart, never compares it against
 * wall time directly.
 *
 * The window's upper bound is `store.currentFrame().viewUt`, the SAME
 * frozen view-time every other read in the frame uses (`useStream`'s
 * `getSnapshot`, `useDataValue`'s streamed branch). In the default confirmed
 * `ViewClockMode`, `viewUt() === confirmedEdgeUt()` while live (`ViewClock`'s
 * own doc), so this naturally reads only CONFIRMED data, consistent with the
 * SDK's delay handling: a value at a `validAt` beyond the confirmed edge
 * hasn't been "shown" yet by any other read either, so it doesn't
 * retroactively appear in the plotted history.
 *
 * Both the legacy subscription and the streamed subscription are always
 * wired up (stable hook order, same reasoning as `useDataValue`); only one
 * of the two snapshots is actually returned. Deleted at M4 alongside
 * `useDataValue`'s shim.
 */
export function useDataSeries(
  sourceId: "data",
  key: string,
  windowSec: number,
): SeriesRange {
  // Mutable internal storage. Kept outside React state so live appends
  // don't allocate new arrays per sample.
  const dataRef = useRef<{ t: number[]; v: unknown[] }>({ t: [], v: [] });

  // Stream-branch memoization (see `getStreamSnapshot` below): the last
  // `SeriesRange` built from `sampleRange`, so an unchanged read reuses the
  // same object identity instead of handing `useSyncExternalStore` a fresh
  // one every call.
  const lastSnapshotRef = useRef<SeriesRange>(EMPTY);

  const setup = useCallback(
    (
      rawSource: DataSource,
      notify: () => void,
      snapshotRef: { current: SeriesRange },
    ) => {
      const source = rawSource as BufferedDataSource;
      const windowMs = windowSec * 1000;
      dataRef.current = { t: [], v: [] };
      snapshotRef.current = EMPTY;

      let cancelled = false;

      // Backfill from the store. Errors (e.g. peer closed mid-query, host
      // has no queryRange) are swallowed, the hook stays in its empty state
      // until a live sample arrives, rather than crashing the graph.
      const now = Date.now();
      void source
        .queryRange(key, now - windowMs, now)
        .then((range) => {
          if (cancelled) return;
          // The query's window closed at `now`, so a sample that arrived while
          // it was in flight is newer than its upper bound and cannot be in the
          // answer. Splice the history in FRONT of whatever is already buffered
          // rather than replacing it: replacing made the series depend on which
          // of the two landed second, so a slow store silently erased live
          // samples and an empty answer emptied the whole plot.
          const live = dataRef.current;
          const oldestLive = live.t.length > 0 ? (live.t[0] as number) : null;
          const head =
            oldestLive === null
              ? range.t.length
              : range.t.findIndex((t) => t >= oldestLive);
          const kept = head === -1 ? range.t.length : head;
          dataRef.current = {
            t: [...range.t.slice(0, kept), ...live.t],
            v: [...range.v.slice(0, kept), ...live.v],
          };
          snapshotRef.current = {
            t: dataRef.current.t,
            v: dataRef.current.v,
            basis: "wall-ms",
          };
          notify();
        })
        .catch(() => {
          // Intentionally silent: treat as "no backfill available".
        });

      const unsubSamples = source.subscribeSamples(key, ({ t, v }) => {
        const buf = dataRef.current;
        buf.t.push(t);
        buf.v.push(v);
        const cutoff = t - windowMs;
        let i = 0;
        while (i < buf.t.length && buf.t[i] < cutoff) i++;
        if (i > 0) {
          buf.t.splice(0, i);
          buf.v.splice(0, i);
        }
        // Fresh wrapper per update: useSyncExternalStore's identity check
        // sees the new reference and triggers a render.
        snapshotRef.current = { t: buf.t, v: buf.v, basis: "wall-ms" };
        notify();
      });

      const unsubStatus = source.onStatusChange((status) => {
        if (status !== "connected") {
          dataRef.current = { t: [], v: [] };
          snapshotRef.current = EMPTY;
          notify();
        }
      });

      return () => {
        cancelled = true;
        unsubSamples();
        unsubStatus();
      };
    },
    [key, windowSec],
  );

  const legacySeries = useDataSourceSubscription<SeriesRange>(
    sourceId,
    setup,
    EMPTY,
  );

  // The shim: subscribed whenever a `TelemetryProvider` is mounted, with the
  // carried-channels gate deciding which of the two SERIES is returned, same
  // as `useTelemetry`'s streamed branch (`isTopicCarried`/`mapTopic`).
  //
  // The gate picks between two live reads; it is not permission to reach the
  // stream. It used to be both: an uncarried topic short-circuited
  // `subscribeStream` to a no-op. That is safe only while the legacy series it
  // diverts to exists, and it does not, for the same reason the `topic` comment
  // below already gives: nothing registers the `"data"` source in production.
  // So an uncarried plot drew an empty chart for ever, and drew it silently,
  // because `installUnownedTopicWarning` can only report topics something
  // subscribed to. The subscription is now unconditional and the legacy series
  // simply gets first refusal, which is the behaviour the gate was written for.
  const client = useTelemetryClientOptional();
  const store = useTelemetryStoreOptional();
  const carriedChannels = useCarriedChannelsOptional();
  // `mapTopic` translates one spelling of a key and has nothing to say about
  // the canonical one, so translating first would leave a canonical path
  // (`vessel.orbit.sma`, what most widgets plot) resolving to `undefined` and
  // falling through to the `"data"` `DataSource` that nothing registers in
  // production: an empty plot, forever, with nothing failing. Passing the key
  // through unchanged lets `isTopicCarried` answer for both spellings; a key
  // that is neither still resolves to nothing and takes the fallback path
  // below.
  const topic = mapTopic(sourceId, key) ?? key;
  const carried =
    store !== undefined &&
    carriedChannels !== undefined &&
    isTopicCarried(store, carriedChannels, topic);
  const routable = client !== undefined && store !== undefined && carried;

  const subscribeStream = useCallback(
    (onStoreChange: () => void) => {
      if (!client || !store) {
        return () => {};
      }
      // `resolveSubscriptionTopics` already resolves a DERIVED topic to its
      // raw `inputs` (recursively): the exact same raw topics
      // `sampleDerivedRange` below reads via `sampleRange`, so subscribing
      // here is what keeps those raw timelines populated for the replay.
      const inputTopics = store.resolveSubscriptionTopics(topic);
      const unsubscribeInputs = inputTopics.map((inputTopic) =>
        client.subscribe(inputTopic, () => {}),
      );
      const unsubscribeFrame = store.subscribeFrame(onStoreChange);
      return () => {
        unsubscribeFrame();
        for (const unsubscribe of unsubscribeInputs) unsubscribe();
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
    // A DERIVED topic (`vessel.state.*` and friends) has no stored range of
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
    const tail = store.sampleReckonedTail<number>(topic, fromUt, toUt);
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
    const nextBreaks: number[] = [];
    for (let i = 0; i < observed.length; i++) {
      // The FIRST point cannot open a break in the drawn series: there is no
      // segment before it to break. The hole is real, and it is off the left
      // edge of the window, where a chart already draws nothing.
      if (i > 0 && observed[i].meta.gapSinceUt != null) nextBreaks.push(i);
    }
    /*
     * Which runs of the window came off the craft's own recorder rather than
     * off a live link. `breaks` above says what is GONE; this says what is
     * merely LATE, and without it a replayed span and a live span leave the
     * store looking identical, which is the one distinction the blackout model
     * exists to make.
     */
    const nextSpans = buildSpans(observed);
    // Magnitudes: a series feeds a sparkline and a graph axis, which plot
    // numbers. A declared quantity arrives wrapped from the decode, so
    // without this every stream-backed chart drew nothing.
    const nextV = observed.map((p) => plotValue(p.payload));
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
      nextV.push(sample.value);
      const open = nextReckoned[nextReckoned.length - 1];
      if (
        open !== undefined &&
        open.basis === sample.basis &&
        open.to === i - 1
      )
        open.to = i;
      else nextReckoned.push({ from: i, to: i, basis: sample.basis });
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
    // built `SeriesRange`, the same referential-stability contract the
    // legacy path gets for free from its mutate-in-place buffer.
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

  const streamedSeries = useSyncExternalStore(
    subscribeStream,
    getStreamSnapshot,
  );

  // Gated off, so the legacy series gets first refusal: that ordering IS the
  // gate, and it is unchanged. What changed is the tie-break when it declines.
  // An empty legacy series used to end the matter, and on a `sourceId` no
  // longer backed by a registered source it was empty for ever.
  //
  // Reported only when there is no registered source at all, which is the
  // unambiguous case. A registered source that has simply not filled its window
  // yet is rescued too, and is not worth a line that fires once per read for
  // the whole session.
  const hasLegacySource = getDataSource(sourceId) !== undefined;
  const gatedRescue =
    !routable &&
    client !== undefined &&
    store !== undefined &&
    legacySeries.t.length === 0 &&
    streamedSeries.t.length > 0;
  useEffect(() => {
    if (gatedRescue && !hasLegacySource && store) {
      warnGatedRead(
        "useDataSeries",
        sourceId,
        key,
        topic,
        store.resolveSubscriptionTopics(topic),
      );
    }
  }, [gatedRescue, hasLegacySource, sourceId, key, topic, store]);

  return routable || gatedRescue ? streamedSeries : legacySeries;
}
