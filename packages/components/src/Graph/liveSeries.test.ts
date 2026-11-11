import type { SeriesRange } from "@ksp-gonogo/data";
import { describe, expect, it } from "vitest";
import { buildLiveSeries } from "./liveSeries";
import type { GraphSeries } from "./types";

function typeDrawn(
  interpolation: SeriesRange["interpolation"],
  chosen?: GraphSeries["type"],
  xIsTime = true,
) {
  const cfg: GraphSeries = {
    id: "s",
    source: { topic: "vessel.propulsion", field: "dryMass" },
    type: chosen,
    axis: "auto",
  };
  const data = new Map<string, SeriesRange<number>>([
    ["vessel.propulsion.dryMass", { t: [1, 2], v: [10, 8], interpolation }],
  ]);
  const [series] = buildLiveSeries(
    [cfg],
    new Map(),
    data,
    ["primary"],
    xIsTime,
    { t: [], v: [] },
  );
  return series.type;
}

describe("a Graph series is drawn the way its value allows", () => {
  it("steps a line asked of a value that stands until it changes", () => {
    expect(typeDrawn("step")).toBe("step");
  });

  it("marks a line asked of occurrences as separate points", () => {
    expect(typeDrawn("none")).toBe("scatter");
  });

  it("joins a continuous value with the line asked for", () => {
    expect(typeDrawn("linear")).toBe("line");
    expect(typeDrawn(undefined)).toBe("line");
  });

  it("keeps any other choice the operator made", () => {
    expect(typeDrawn("step", "band")).toBe("band");
    expect(typeDrawn("linear", "scatter")).toBe("scatter");
  });
});

describe("a Graph series that stopped emitting", () => {
  function drawn(extra: Partial<SeriesRange<number>>) {
    const cfg: GraphSeries = {
      id: "s",
      source: { topic: "vessel.propulsion", field: "dryMass" },
      axis: "auto",
    };
    const data = new Map<string, SeriesRange<number>>([
      ["vessel.propulsion.dryMass", { t: [1, 5], v: [10, 8], ...extra }],
    ]);
    return buildLiveSeries([cfg], new Map(), data, ["primary"], true, {
      t: [],
      v: [],
    })[0].data;
  }

  it("holds its last value out to the window's end", () => {
    const data = drawn({ windowEndAt: 20 });
    expect(data.x).toEqual([1, 5, 20]);
    expect(data.y).toEqual([10, 8, 8]);
  });

  it("holds nothing when the window ends at its last sample", () => {
    expect(drawn({ windowEndAt: 5 }).x).toEqual([1, 5]);
    expect(drawn({}).x).toEqual([1, 5]);
  });

  it("leaves a reckoned tail to the model", () => {
    const data = drawn({
      windowEndAt: 20,
      reckoned: [{ from: 1, to: 1, basis: "rate-integration" }],
    });
    expect(data.x).toEqual([1, 5]);
  });
});
