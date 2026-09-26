import { type SeriesRange, useDataSeries } from "@ksp-gonogo/data";
import { useMemo } from "react";
import { toNumericSeries } from "../Graph/GraphSeries";

/**
 * A series computed from two wire series, on `primary`'s instants with
 * `secondary` sample-and-held. `primary` lends its annotations, but a reckoned
 * band is dropped: an operand's uncertainty is not the result's. `compute`
 * answers `null` to drop a point.
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
