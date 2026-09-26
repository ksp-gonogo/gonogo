import type { SeriesRange } from "@ksp-gonogo/data";
import { GraphSeries } from "./GraphSeries";
import type { GraphSeriesConfig } from "./types";

interface Props {
  /** Every configured series not already supplied via `computedSeries`. */
  series: readonly GraphSeriesConfig[];
  /** Band upper-bound keys, fetched alongside their lower-bound series. */
  extraFetchKeys: readonly string[];
  /** The X-axis key to fetch, or `undefined` on a time or pinned axis. */
  xFetchKey: string | undefined;
  windowSec: number;
  onData: (key: string, data: SeriesRange<number>) => void;
  onXData: (key: string, data: SeriesRange<number>) => void;
}

/** Mounts the invisible per-key fetchers a chart's live series, band highs and X axis need; nothing here renders anything itself. */
export function GraphFetchers({
  series,
  extraFetchKeys,
  xFetchKey,
  windowSec,
  onData,
  onXData,
}: Readonly<Props>) {
  return (
    <>
      {series.map((cfg) => (
        <GraphSeries
          key={cfg.id}
          dataKey={cfg.key}
          windowSec={windowSec}
          onData={onData}
        />
      ))}
      {extraFetchKeys.map((k) => (
        <GraphSeries
          key={`extra-${k}`}
          dataKey={k}
          windowSec={windowSec}
          onData={onData}
        />
      ))}
      {xFetchKey !== undefined && (
        <GraphSeries
          key={`x-${xFetchKey}`}
          dataKey={xFetchKey}
          windowSec={windowSec}
          onData={onXData}
        />
      )}
    </>
  );
}
