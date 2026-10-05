import type { SeriesRange, TopicFieldHandle } from "@ksp-gonogo/data";
import { seriesKeyOf } from "@ksp-gonogo/sitrep-sdk";
import { GraphSeries } from "./GraphSeries";
import type { GraphSeries as GraphSeriesSpec } from "./types";

interface Props {
  /** Every configured series not already supplied via `computedSeries`. */
  series: readonly GraphSeriesSpec[];
  /** Band upper-bound fields, fetched alongside their lower-bound series. */
  extraFetches: readonly TopicFieldHandle[];
  /** The X-axis field to fetch, or `undefined` on a time or pinned axis. */
  xFetch: TopicFieldHandle | undefined;
  windowSec: number;
  onData: (key: string, data: SeriesRange<number>) => void;
  onXData: (key: string, data: SeriesRange<number>) => void;
}

/** Mounts the invisible per-field fetchers a chart's live series, band highs and X axis need; nothing here renders anything itself. */
export function GraphFetchers({
  series,
  extraFetches,
  xFetch,
  windowSec,
  onData,
  onXData,
}: Readonly<Props>) {
  return (
    <>
      {series.map((cfg) => (
        <GraphSeries
          key={cfg.id}
          source={cfg.source}
          windowSec={windowSec}
          onData={onData}
        />
      ))}
      {extraFetches.map((source) => (
        <GraphSeries
          key={`extra-${seriesKeyOf(source)}`}
          source={source}
          windowSec={windowSec}
          onData={onData}
        />
      ))}
      {xFetch !== undefined && (
        <GraphSeries
          key={`x-${seriesKeyOf(xFetch)}`}
          source={xFetch}
          windowSec={windowSec}
          onData={onXData}
        />
      )}
    </>
  );
}
