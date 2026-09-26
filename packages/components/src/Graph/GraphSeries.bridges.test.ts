import type { SeriesRange } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { toNumericSeries } from "./GraphSeries";

/** A bridge is the chord ending at its sample: unlike a break it cannot slide, so it survives only while both ends do, adjacent and unbroken. */
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
    // Dropping index 1 makes 0 and 2 adjacent on the way out, but they were never a recorded chord.
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
