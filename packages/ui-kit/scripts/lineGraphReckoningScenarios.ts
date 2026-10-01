/**
 * The series the LineGraph reckoning sheet draws, as DATA, so the before and after
 * renders differ only in what `<LineGraph>` does with them.
 */
export interface ReckoningCase {
  id: string;
  title: string;
  note: string;
  variant: "chart" | "sparkline";
  /** Whether the tail is reckoned, and what its band claims. */
  tail: "none" | "bound" | "sigma1";
}

const MEASURED = 12;
const TOTAL = 20;

/** Measured up to `MEASURED`, then a model carries the figure on with a widening interval. */
export function seriesPoints(): Array<{ x: number; y: number }> {
  return Array.from({ length: TOTAL + 1 }, (_, x) => ({
    x,
    y: x <= MEASURED ? 40 + x * 3 : 76 + (x - MEASURED) * 1.5,
  }));
}

/** One band entry per point of the reckoned run, from `MEASURED` to the end. */
export function tailBand(points: Array<{ x: number; y: number }>): {
  lo: number[];
  hi: number[];
} {
  const run = points.slice(MEASURED);
  return {
    lo: run.map((p, i) => p.y - 1 - i * 1.2),
    hi: run.map((p, i) => p.y + 1 + i * 1.2),
  };
}

export const RECKONED_FROM = MEASURED;
export const RECKONED_TO = TOTAL;

export const CASES: ReckoningCase[] = [
  {
    id: "chart-bound",
    title: "Chart, reckoned tail with a hard bound",
    note: "Measured to t=12, then carried forward. The model claims the value is inside its bounds.",
    variant: "chart",
    tail: "bound",
  },
  {
    id: "chart-sigma",
    title: "Chart, reckoned tail with a one-sigma interval",
    note: "Same tail, a statistical interval: no hard edge is claimed.",
    variant: "chart",
    tail: "sigma1",
  },
  {
    id: "sparkline-bound",
    title: "Sparkline, reckoned tail with a hard bound",
    note: "The compact variant, area-shaded under the stroke.",
    variant: "sparkline",
    tail: "bound",
  },
  {
    id: "sparkline-sigma",
    title: "Sparkline, reckoned tail with a one-sigma interval",
    note: "A filled series: the band must read apart from the area fill under the stroke.",
    variant: "sparkline",
    tail: "sigma1",
  },
  {
    id: "chart-measured",
    title: "Chart, fully measured (control)",
    note: "Nothing reckoned: must not change between before and after.",
    variant: "chart",
    tail: "none",
  },
];
