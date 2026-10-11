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
