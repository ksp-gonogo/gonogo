import type { SeriesRange } from "@ksp-gonogo/data";
import { useDataSeries } from "@ksp-gonogo/data";
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
      breaks: [],
    };
    // `breaks` is REINDEXED, not copied: this filter drops non-numeric samples,
    // so an input index naming a hole names a different sample on the way out.
    // A break whose own sample is dropped moves onto the next one that
    // survives, because the hole is still there and still to its left.
    const inBreaks = new Set(raw.breaks ?? []);
    let pendingBreak = false;
    for (let i = 0; i < raw.t.length; i++) {
      if (inBreaks.has(i)) pendingBreak = true;
      const n = Number(raw.v[i]);
      if (!Number.isNaN(n)) {
        if (pendingBreak && numeric.t.length > 0) {
          numeric.breaks?.push(numeric.t.length);
        }
        pendingBreak = false;
        numeric.t.push(raw.t[i]);
        numeric.v.push(n);
      }
    }
    onData(dataKey, numeric);
  }, [raw, dataKey, onData]);

  return null;
}
