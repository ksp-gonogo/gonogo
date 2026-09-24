import { type SeriesRange, useDataSeries } from "@ksp-gonogo/data";
import { useMemo } from "react";
import { toNumericSeries } from "../Graph/GraphSeries";

/**
 * A series computed at the point of read from two wire series, for a quantity
 * the wire does not carry.
 *
 * Sampled on `primary`'s instants: each point combines `primary`'s value with
 * `secondary`'s most recent value at or before it, which is exact when both are
 * fields of one topic (they share instants) and a sample-and-hold otherwise.
 * `primary` also lends the result its annotations: its breaks, its status runs
 * and which of its points a model supplied. A reckoned run's BAND is dropped,
 * because an uncertainty on an operand is not an uncertainty on the result.
 *
 * `compute` answers `null` for an instant with no meaningful value, which drops
 * the point exactly as a non-numeric fetched sample is dropped.
 *
 * Both keys must name wire fields. A key on a derived channel would put back
 * the dependency this exists to remove: the day that channel goes, the series
 * would go empty with no error anywhere.
 */
export function useComputedSeries(
  primary: string,
  secondary: string,
  windowSec: number,
  compute: (primary: number, secondary: number) => number | null,
): SeriesRange<number> {
  const a = useDataSeries("data", primary, windowSec);
  const b = useDataSeries("data", secondary, windowSec);

  return useMemo(() => {
    const held = toNumericSeries(b);
    const v: (number | null)[] = [];
    let j = -1;
    for (let i = 0; i < a.t.length; i++) {
      const at = a.t[i];
      while (j + 1 < held.t.length && held.t[j + 1] <= at) j++;
      const x = Number(a.v[i]);
      v.push(j >= 0 && Number.isFinite(x) ? compute(x, held.v[j]) : null);
    }
    return toNumericSeries({
      ...a,
      v: v.map((n) => (n === null || !Number.isFinite(n) ? Number.NaN : n)),
      reckoned: a.reckoned?.map(({ from, to, basis }) => ({ from, to, basis })),
    });
  }, [a, b, compute]);
}
