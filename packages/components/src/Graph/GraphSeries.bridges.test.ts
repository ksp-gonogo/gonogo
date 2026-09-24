import type { SeriesRange } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { toNumericSeries } from "./GraphSeries";

/**
 * A bridge names the chord ENDING at its sample, so reindexing it is not the
 * same problem as reindexing a break. A break survives a dropped sample by
 * sliding onto the next one that lives, because the hole is still there. A
 * chord cannot: it is drawn between two specific samples, and if either end is
 * dropped, or a break opens between them, the chord the chart would draw is a
 * different chord from the one recorded.
 */
/*
 * The basis is whatever model carried the span, taken straight off the gap
 * model by `plottedGap`. Reindexing carries it verbatim and never reads it, so
 * one real member stands for all four here.
 */
const bridge = (to: number) => ({
  to,
  t: [10, 20],
  v: [1, 2],
  basis: "linear-dead-reckoning" as const,
});

const range = (
  v: unknown[],
  extra: Partial<SeriesRange<unknown>> = {},
): SeriesRange<unknown> => ({
  t: v.map((_, i) => i * 10),
  v,
  ...extra,
});

describe("toNumericSeries: bridges", () => {
  it("moves a surviving chord onto its output index", () => {
    const out = toNumericSeries(range([1, 2, 3], { bridges: [bridge(2)] }));

    expect(out.v).toEqual([1, 2, 3]);
    expect(out.bridges).toEqual([{ ...bridge(2), to: 2 }]);
  });

  it("reindexes a chord that a dropped earlier sample moved", () => {
    // The non-numeric sample at 1 goes, so input index 3 leaves as output 2.
    const out = toNumericSeries(
      range([1, "x", 3, 4], { bridges: [bridge(3)] }),
    );

    expect(out.v).toEqual([1, 3, 4]);
    expect(out.bridges).toEqual([{ ...bridge(3), to: 2 }]);
  });

  it("drops a chord whose own sample the numeric filter removed", () => {
    const out = toNumericSeries(range([1, 2, "x"], { bridges: [bridge(2)] }));

    expect(out.v).toEqual([1, 2]);
    expect(out.bridges).toEqual([]);
  });

  it("drops a chord whose left end the numeric filter removed", () => {
    // Both ends must survive ADJACENT: dropping index 1 leaves 0 and 2 next to
    // each other on the way out, but they were never a recorded chord.
    const out = toNumericSeries(range([1, "x", 3], { bridges: [bridge(2)] }));

    expect(out.v).toEqual([1, 3]);
    expect(out.bridges).toEqual([]);
  });

  it("drops a chord with a break between its ends", () => {
    const out = toNumericSeries(
      range([1, 2, 3], { bridges: [bridge(2)], breaks: [2] }),
    );

    expect(out.breaks).toEqual([2]);
    expect(out.bridges).toEqual([]);
  });

  it("drops a chord carrying a non-finite value", () => {
    const out = toNumericSeries(
      range([1, 2, 3], {
        bridges: [{ ...bridge(2), v: [1, Number.NaN] }],
      }),
    );

    expect(out.bridges).toEqual([]);
  });

  it("offers an empty list rather than nothing when none were recorded", () => {
    expect(toNumericSeries(range([1, 2])).bridges).toEqual([]);
  });
});
