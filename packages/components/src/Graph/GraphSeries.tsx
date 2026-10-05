import type { SeriesRange, TopicFieldHandle } from "@ksp-gonogo/data";
import { plotColumnsOf, useSeriesReadings } from "@ksp-gonogo/data";
import { seriesKeyOf } from "@ksp-gonogo/sitrep-sdk";
import { useEffect } from "react";

interface Props {
  source: TopicFieldHandle;
  windowSec: number;
  onData: (key: string, data: SeriesRange<number>) => void;
}

/** Invisible per-series fetcher, so `useSeriesReadings` is never called conditionally inside a map. It hands back what the chart draws of the readings. */
export function GraphSeries({ source, windowSec, onData }: Readonly<Props>) {
  const readings = useSeriesReadings(source, windowSec);
  const key = seriesKeyOf(source);

  useEffect(() => {
    onData(key, plotColumnsOf(readings));
  }, [readings, key, onData]);

  return null;
}
