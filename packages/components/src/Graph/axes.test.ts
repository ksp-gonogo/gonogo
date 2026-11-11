import type { ChartSeries } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { constantRatioDomain, timeWindowDomain } from "./axes";

function seriesAt(x: number[]): ChartSeries {
  return {
    id: "s",
    label: "s",
    axis: "primary",
    color: "#fff",
    type: "line",
    data: { x, y: x.map(() => 1) },
  };
}

describe("timeWindowDomain", () => {
  it("spans the whole window for a series with a single sample", () => {
    expect(
      timeWindowDomain([seriesAt([1000])], 300, undefined, "ut-seconds"),
    ).toEqual([700, 1000]);
  });

  it("keeps its width in milliseconds on a wall-clock series", () => {
    expect(timeWindowDomain([seriesAt([400_000])], 300)).toEqual([
      100_000, 400_000,
    ]);
  });

  it("does not move the left edge when old samples are evicted", () => {
    const full = timeWindowDomain(
      [seriesAt([700, 800, 1000])],
      300,
      undefined,
      "ut-seconds",
    );
    const evicted = timeWindowDomain(
      [seriesAt([1000])],
      300,
      undefined,
      "ut-seconds",
    );
    expect(evicted).toEqual(full);
  });

  it("extends the right edge to a reckoned window end", () => {
    expect(
      timeWindowDomain([seriesAt([1000])], 300, 1100, "ut-seconds"),
    ).toEqual([800, 1100]);
  });
});

describe("constantRatioDomain", () => {
  const flat = (y: number): ChartSeries => ({
    ...seriesAt([0, 10]),
    data: { x: [0, 10], y: [y, y] },
  });

  it("spans the whole 0 to 1 for a constant ratio", () => {
    expect(constantRatioDomain([flat(1)], ["ratio"])).toEqual([0, 1]);
    expect(constantRatioDomain([flat(0)], ["ratio"])).toEqual([0, 1]);
  });

  it("widens to take in a ratio outside 0 to 1", () => {
    expect(constantRatioDomain([flat(1.2)], ["ratio"])).toEqual([0, 1.2]);
  });

  it("leaves a moving series or another unit to the chart", () => {
    const moving = {
      ...seriesAt([0, 10]),
      data: { x: [0, 10], y: [0.2, 0.8] },
    };
    expect(constantRatioDomain([moving], ["ratio"])).toBeUndefined();
    expect(constantRatioDomain([flat(1)], ["m/s"])).toBeUndefined();
  });
});
