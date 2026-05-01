import { type DataSource, useDataSourceSubscription } from "@gonogo/core";
import { useCallback, useRef } from "react";
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
 */
export function useDataSeries(
  sourceId: "data",
  key: string,
  windowSec: number,
): SeriesRange {
  // Mutable internal storage. Kept outside React state so live appends
  // don't allocate new arrays per sample.
  const dataRef = useRef<{ t: number[]; v: unknown[] }>({ t: [], v: [] });

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

  return useDataSourceSubscription<SeriesRange>(sourceId, setup, EMPTY);
}
