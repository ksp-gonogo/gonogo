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
    };
    for (let i = 0; i < raw.t.length; i++) {
      const n = Number(raw.v[i]);
      if (!Number.isNaN(n)) {
        numeric.t.push(raw.t[i]);
        numeric.v.push(n);
      }
    }
    onData(dataKey, numeric);
  }, [raw, dataKey, onData]);

  return null;
}
