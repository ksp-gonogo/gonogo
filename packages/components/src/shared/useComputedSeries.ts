import {
  plotColumnsOf,
  plottedFigure,
  type ReadingSeriesRange,
  type TopicFieldHandle,
  useSeriesReadings,
} from "@ksp-gonogo/data";
import type { Reading } from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";

/**
 * A series computed from two wire series, on `primary`'s instants with
 * `secondary` sample-and-held. Each sample keeps `primary`'s provenance, so a
 * stretch a model supplied is computed from the model's figure and stays
 * marked as modelled, but a reckoned band is dropped: an operand's uncertainty
 * is not the result's. `compute` answers `null` to drop a point.
 */
export function useComputedSeries(
  primary: TopicFieldHandle,
  secondary: TopicFieldHandle,
  windowSec: number,
  compute: (primary: number, secondary: number) => number | null,
): ReadingSeriesRange<number> {
  const a = useSeriesReadings(primary, windowSec);
  const b = useSeriesReadings(secondary, windowSec);

  return useMemo(() => {
    const held = plotColumnsOf(b);
    let j = -1;
    const readings = a.readings.map((reading, i): Reading<number> => {
      const at = a.t[i];
      while (j + 1 < held.t.length && held.t[j + 1] <= at) j++;
      const other = j >= 0 ? held.v[j] : undefined;
      // NaN where there is nothing to plot, which is what the chart drops.
      const computed = (figure: unknown): number => {
        const x = plottedFigure(figure);
        if (other === undefined || !Number.isFinite(x)) return Number.NaN;
        const y = compute(x, other);
        return y === null || !Number.isFinite(y) ? Number.NaN : y;
      };
      const value =
        reading.value === undefined ? undefined : computed(reading.value);
      if (reading.reckoning.status !== "available") {
        return { ...reading, value, reckoning: { status: "none" } };
      }
      const { band: _band, ...model } = reading.reckoning;
      return {
        ...reading,
        value,
        reckoning: { ...model, modelled: computed(model.modelled) },
      };
    });
    return { ...a, readings };
  }, [a, b, compute]);
}
