import { describe, expect, it } from "vitest";
import {
  buildBandPath,
  buildPath,
  buildStepPath,
  makeLogScale,
  makeScale,
  niceLogTicks,
  niceTicks,
} from "./lineChartMath";

const id = (v: number) => v;

describe("makeScale", () => {
  it("maps the domain bounds to the range bounds", () => {
    const s = makeScale(0, 10, 0, 100);
    expect(s(0)).toBe(0);
    expect(s(10)).toBe(100);
    expect(s(5)).toBe(50);
  });

  it("collapses to the midpoint when domain has zero span", () => {
    const s = makeScale(7, 7, 0, 100);
    expect(s(7)).toBe(50);
    expect(s(99)).toBe(50);
  });
});

describe("niceTicks", () => {
  it("returns 5 evenly-spaced ticks for a clean range", () => {
    const ticks = niceTicks(0, 100, 5);
    expect(ticks).toEqual([0, 25, 50, 75, 100]);
  });

  it("falls back to bounds when min equals max with count < 2 effective ticks", () => {
    const ticks = niceTicks(5, 5, 5);
    // All 5 entries are 5
    expect(ticks).toHaveLength(5);
    expect(new Set(ticks)).toEqual(new Set([5]));
  });
});

describe("buildPath", () => {
  it("returns empty for empty arrays", () => {
    expect(buildPath([], [], id, id)).toBe("");
  });

  it("joins points with M then L commands", () => {
    expect(buildPath([0, 1, 2], [0, 10, 20], id, id)).toBe(
      "M0.00,0.00 L1.00,10.00 L2.00,20.00",
    );
  });
});

describe("buildStepPath", () => {
  it("holds Y until the next X then jumps", () => {
    // Three samples: y starts at 0, rises to 5, falls to 2.
    const path = buildStepPath([0, 1, 2], [0, 5, 2], id, id);
    expect(path).toBe("M0.00,0.00 H1.00 V5.00 H2.00 V2.00");
  });

  it("omits the V step when Y doesn't change", () => {
    const path = buildStepPath([0, 1, 2], [3, 3, 3], id, id);
    expect(path).toBe("M0.00,3.00 H1.00 H2.00");
  });

  it("returns empty for empty input", () => {
    expect(buildStepPath([], [], id, id)).toBe("");
  });
});

describe("buildBandPath", () => {
  it("returns empty for empty input", () => {
    expect(buildBandPath([], [], [], id, id)).toBe("");
  });

  it("traces high forward then low reverse and closes", () => {
    const path = buildBandPath([0, 1], [0, 1], [10, 11], id, id);
    expect(path).toBe("M0.00,10.00 L1.00,11.00 L1.00,1.00 L0.00,0.00 Z");
  });

  it("clamps to the shortest of the three arrays", () => {
    const path = buildBandPath([0, 1, 2], [0, 1], [10, 11, 12], id, id);
    // n = 2 — final third sample is ignored
    expect(path).not.toContain("2.00,12.00");
  });
});

describe("makeLogScale", () => {
  it("maps powers of 10 evenly across the range", () => {
    const s = makeLogScale(1, 1000, 0, 100);
    expect(s(1)).toBeCloseTo(0);
    expect(s(10)).toBeCloseTo(100 / 3);
    expect(s(100)).toBeCloseTo(200 / 3);
    expect(s(1000)).toBeCloseTo(100);
  });

  it("clamps non-positive input to the domain floor instead of returning NaN", () => {
    const s = makeLogScale(1, 1000, 0, 100);
    expect(s(0)).toBeCloseTo(0);
    expect(s(-50)).toBeCloseTo(0);
  });

  it("collapses to the midpoint when domain bounds are the same", () => {
    const s = makeLogScale(100, 100, 0, 100);
    expect(s(100)).toBe(50);
  });
});

describe("niceLogTicks", () => {
  it("returns powers of 10 within the domain", () => {
    const ticks = niceLogTicks(1, 1000);
    expect(ticks).toEqual([1, 10, 100, 1000]);
  });

  it("falls back to linear ticks for sub-decade ranges", () => {
    const ticks = niceLogTicks(50, 200);
    expect(ticks).toEqual(niceTicks(50, 200, 5));
  });

  it("falls back when bounds are non-positive", () => {
    expect(niceLogTicks(0, 100)).toEqual(niceTicks(0, 100, 5));
  });

  it("strides over decades when the span is large", () => {
    const ticks = niceLogTicks(1, 1e10, 4);
    // 11 decades, count=4 → stride 3 → exponents 0, 3, 6, 9
    expect(ticks).toEqual([1, 1000, 1_000_000, 1_000_000_000]);
  });
});
