import type {
  SeriesRange,
  SeriesReckonedSpan,
  SeriesStatusSpan,
} from "@ksp-gonogo/data";
import { useDataSeries } from "@ksp-gonogo/data";
import type { ReckoningBasis, StreamStatusValue } from "@ksp-gonogo/sitrep-sdk";
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
    const numeric: SeriesRange<number> = {
      t: [],
      v: [],
      basis: raw.basis,
      breaks: [],
      spans: [],
      reckoned: [],
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
    for (const run of raw.reckoned ?? []) {
      for (let i = run.from; i <= run.to; i++) basisAt.set(i, run.basis);
    }
    let open: SeriesStatusSpan | null = null;
    let openReckoned: SeriesReckonedSpan | null = null;
    let pendingBreak = false;
    for (let i = 0; i < raw.t.length; i++) {
      if (inBreaks.has(i)) pendingBreak = true;
      const n = Number(raw.v[i]);
      if (Number.isNaN(n)) continue;
      const out = numeric.t.length;
      if (pendingBreak && out > 0) numeric.breaks?.push(out);
      pendingBreak = false;
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
      if (basis === undefined) {
        openReckoned = null;
      } else if (openReckoned !== null && openReckoned.basis === basis) {
        openReckoned.to = out;
      } else {
        openReckoned = { from: out, to: out, basis };
        numeric.reckoned?.push(openReckoned);
      }
    }
    onData(dataKey, numeric);
  }, [raw, dataKey, onData]);

  return null;
}
