import { describe, expect, it } from "vitest";
import {
  deriveExperimentBreakdown,
  scienceAggregate,
} from "./scienceAggregates";

describe("scienceAggregate — sci.count / sci.dataAmount off science.experiments", () => {
  it("sums count and total data amount", () => {
    const raw = [
      { subjectId: "a", dataAmount: 5 },
      { subjectId: "b", dataAmount: 8.5 },
      { subjectId: "c", dataAmount: 0 },
    ];
    expect(scienceAggregate(raw)).toEqual({ count: 3, dataAmount: 13.5 });
  });

  it("treats a missing / non-numeric dataAmount as 0, never NaN", () => {
    const raw = [{ subjectId: "a" }, { subjectId: "b", dataAmount: "x" }];
    const agg = scienceAggregate(raw);
    expect(agg).toEqual({ count: 2, dataAmount: 0 });
    expect(Number.isNaN(agg?.dataAmount)).toBe(false);
  });

  it("skips non-object entries but still counts the valid ones", () => {
    const raw = [{ subjectId: "a", dataAmount: 2 }, null, 5, ["nested"]];
    expect(scienceAggregate(raw)).toEqual({ count: 1, dataAmount: 2 });
  });

  it("empty array is a real zero; non-array is null (fall back)", () => {
    expect(scienceAggregate([])).toEqual({ count: 0, dataAmount: 0 });
    expect(scienceAggregate(undefined)).toBeNull();
    expect(scienceAggregate(42)).toBeNull();
  });
});

describe("deriveExperimentBreakdown — sci.experimentBreakdown DROP, derived from the array", () => {
  it("maps location→biome, situation, title, dataAmount→dataMits, scienceValueRatio→remainingPotential", () => {
    const raw = [
      {
        subjectId: "surfaceSample@KerbinShores",
        title: "Surface Sample",
        location: "Shores",
        situation: "SrfLanded",
        dataAmount: 30,
        scienceValueRatio: 0.4,
      },
    ];
    const breakdown = deriveExperimentBreakdown(raw);
    expect(breakdown).toEqual([
      {
        subjectId: "surfaceSample@KerbinShores",
        biome: "Shores",
        situation: "SrfLanded",
        expTitle: "Surface Sample",
        dataMits: 30,
        remainingPotential: 0.4,
      },
    ]);
  });

  it("sorts by remainingPotential descending (most science left first)", () => {
    const raw = [
      { subjectId: "low", scienceValueRatio: 0.1 },
      { subjectId: "high", scienceValueRatio: 0.9 },
      { subjectId: "mid", scienceValueRatio: 0.5 },
    ];
    const breakdown = deriveExperimentBreakdown(raw);
    expect(breakdown?.map((b) => b.subjectId)).toEqual(["high", "mid", "low"]);
  });

  it("null for a non-array input", () => {
    expect(deriveExperimentBreakdown(undefined)).toBeNull();
    expect(deriveExperimentBreakdown(null)).toBeNull();
  });
});
