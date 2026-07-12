import { type DataSource, useDataSourceSubscription } from "@ksp-gonogo/core";
import {
  isTopicCarried,
  mapTopic,
  useCarriedChannelsOptional,
  useTelemetryClientOptional,
  useTelemetryStoreOptional,
} from "@ksp-gonogo/sitrep-client";
import { useCallback, useRef, useSyncExternalStore } from "react";
import type { BufferedDataSource } from "../BufferedDataSource";
import type { SeriesRange } from "../types";

const EMPTY: SeriesRange = { t: [], v: [] };

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
 * comparison triggers a re-render — the internal arrays are mutated in
 * place for cheap appends, then a shallow `{ t, v }` wrapper is built at
 * snapshot time.
 *
 * **The M3 stream shim (last M3 read-side unlock).** Mirrors `@ksp-gonogo/core`'s
 * `useDataValue` shim exactly one level up, for the plotted/sparkline series
 * `GraphView`-based widgets read (`GraphSeries`, `SemiMajorAxis`, `Twr`,
 * `PowerSystems`, `KeplerPeriod`, `OrbitalAscent`, `EscapeProfile`). Same
 * `mapTopic(sourceId, key)` migration table, same carried-channels allowlist
 * gate (`isTopicCarried`) — see `useDataValue.ts`'s doc comment for the full
 * "why" on both; not reproduced here.
 *
 * The one thing genuinely different from `useDataValue`: a DERIVED topic
 * (`vessel.state.*`) has a live per-frame VALUE (`sample()`) but no stored
 * HISTORY — nothing ever buffers a range of computed values, only the raw
 * inputs it's computed from. `TimelineStore.sampleRange` returns `undefined`
 * for exactly this case (as opposed to `[]`, "genuinely nothing landed
 * yet"). Rather than falling back to legacy for every derived topic
 * (the pre-M4 behavior — dead weight once the legacy `BufferedDataSource`
 * is deleted), this hook calls `TimelineStore.sampleDerivedRange` instead:
 * it replays the derived channel's own `derive()` function at every UT its
 * raw inputs changed within the window, off `sampleRange` reads of those
 * raw inputs — a REAL series built off real buffered stream history, no
 * legacy DataSource involved. See `sampleDerivedRange`'s own doc comment
 * for the replay mechanics.
 *
 * A MAPPED + CARRIED raw topic (or raw record field-subtopic, e.g.
 * `"vessel.orbit.sma"` — `map-topic.ts`'s `TELEMACHUS_CLEAN_HOMES` table
 * mostly targets these) reads its window straight off
 * `TimelineStore.sampleRange`, mapping each `TimelinePoint`'s
 * `validAt`/`payload` into this hook's existing `{ t, v }` shape — the exact
 * same shape a consumer already gets from the legacy path, so no
 * `GraphSeries`/widget code needs to change. `t` here is UT (game universal
 * time, seconds) rather than the legacy path's wall-clock `Date.now()`
 * milliseconds — an internal-only distinction; every current consumer only
 * ever reads `v` for a sparkline, or treats `t` as an opaque monotonic
 * x-axis for its own `windowSec`-scoped chart, never compares it against
 * wall time directly.
 *
 * The window's upper bound is `store.currentFrame().viewUt` — the SAME
 * frozen view-time every other read in the frame uses (`useStream`'s
 * `getSnapshot`, `useDataValue`'s streamed branch). In the default confirmed
 * `ViewClockMode`, `viewUt() === confirmedEdgeUt()` while live (`ViewClock`'s
 * own doc), so this naturally reads only CONFIRMED data, consistent with the
 * SDK's delay handling — a value at a `validAt` beyond the confirmed edge
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

  // Stream-branch memoization (see `getStreamSnapshot` below) — the last
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
      // has no queryRange) are swallowed — the hook stays in its empty state
      // until a live sample arrives, rather than crashing the graph.
      const now = Date.now();
      void source
        .queryRange(key, now - windowMs, now)
        .then((range) => {
          if (cancelled) return;
          dataRef.current = { t: [...range.t], v: [...range.v] };
          snapshotRef.current = {
            t: dataRef.current.t,
            v: dataRef.current.v,
          };
          notify();
        })
        .catch(() => {
          // Intentionally silent — treat as "no backfill available".
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
        // Fresh wrapper per update — useSyncExternalStore's identity check
        // sees the new reference and triggers a render.
        snapshotRef.current = { t: buf.t, v: buf.v };
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

  // The shim: always subscribed (stable hook order), only consulted when a
  // `TelemetryProvider` is mounted AND `key` maps to a CARRIED topic — same
  // gate as `useDataValue`'s streamed branch (`isTopicCarried`/`mapTopic`).
  const client = useTelemetryClientOptional();
  const store = useTelemetryStoreOptional();
  const carriedChannels = useCarriedChannelsOptional();
  const topic = mapTopic(sourceId, key);
  const carried =
    store !== undefined &&
    topic !== undefined &&
    carriedChannels !== undefined &&
    isTopicCarried(store, carriedChannels, topic);
  const routable =
    client !== undefined &&
    store !== undefined &&
    topic !== undefined &&
    carried;

  const subscribeStream = useCallback(
    (onStoreChange: () => void) => {
      if (!client || !store || topic === undefined || !carried) {
        return () => {};
      }
      // `resolveSubscriptionTopics` already resolves a DERIVED topic to its
      // raw `inputs` (recursively) — the exact same raw topics
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
    [client, store, topic, carried],
  );

  const getStreamSnapshot = useCallback((): SeriesRange => {
    if (!store || topic === undefined || !carried) {
      return EMPTY;
    }
    const toUt = store.currentFrame().viewUt;
    const fromUt = toUt - windowSec;
    // A DERIVED topic (`vessel.state.*` and friends) has no stored range of
    // its own — `sampleRange` always returns `undefined` for it by design
    // (see that method's own doc). `sampleDerivedRange` is the derived-topic
    // counterpart: it replays the channel's `derive()` off its raw inputs'
    // own buffered ranges instead. Every other (raw / raw-field-subtopic)
    // topic keeps reading straight off `sampleRange`, unchanged.
    const points = store.isDerivedTopic(topic)
      ? store.sampleDerivedRange<unknown>(topic, fromUt, toUt)
      : store.sampleRange<unknown>(topic, fromUt, toUt);
    if (!points || points.length === 0) return EMPTY;

    const nextT = points.map((p) => p.validAt);
    const nextV = points.map((p) => p.payload);

    // `sampleRange` builds a fresh filtered array (and, for a raw
    // field-subtopic, fresh wrapper `TimelinePoint`s — see its own doc
    // comment) on EVERY call; it is deliberately not frame-memoized like
    // `sample()` is. A naive `{ t: nextT, v: nextV }` here would hand
    // `useSyncExternalStore` a new object identity on every single
    // getSnapshot call even when nothing actually changed, which trips
    // React's "should be cached to avoid an infinite loop" guard (object
    // identity flip-flopping between render-time and effect-time forces an
    // endless re-render). Comparing by VALUE rather than the underlying
    // points' object identity is what actually detects "truly nothing
    // changed" here — cheap at sparkline/window sizes — and reuses the last
    // built `SeriesRange`, the same referential-stability contract the
    // legacy path gets for free from its mutate-in-place buffer.
    const prev = lastSnapshotRef.current;
    const unchanged =
      prev.t.length === nextT.length &&
      prev.t.every((t, i) => t === nextT[i]) &&
      prev.v.every((v, i) => Object.is(v, nextV[i]));
    if (unchanged) return prev;

    lastSnapshotRef.current = { t: nextT, v: nextV };
    return lastSnapshotRef.current;
  }, [store, topic, carried, windowSec]);

  const streamedSeries = useSyncExternalStore(
    subscribeStream,
    getStreamSnapshot,
  );

  return routable ? streamedSeries : legacySeries;
}
