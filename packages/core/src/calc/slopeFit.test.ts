import { describe, expect, it } from "vitest";
import { slopeFit } from "./slopeFit";

describe("slopeFit", () => {
  it("returns null for fewer than two samples", () => {
    expect(slopeFit([])).toBeNull();
    expect(slopeFit([{ x: 0, y: 1 }])).toBeNull();
  });

  it("computes slope of an exactly linear series", () => {
    const result = slopeFit([
      { x: 0, y: 0 },
      { x: 1, y: 2 },
      { x: 2, y: 4 },
      { x: 3, y: 6 },
    ]);
    if (result === null) throw new Error("expected non-null result");
    expect(result.slope).toBeCloseTo(2, 10);
    expect(result.latestY).toBe(6);
  });

  it("handles negative slopes", () => {
    const result = slopeFit([
      { x: 0, y: 100 },
      { x: 1, y: 90 },
      { x: 2, y: 80 },
    ]);
    if (result === null) throw new Error("expected non-null result");
    expect(result.slope).toBeCloseTo(-10, 10);
  });

  it("normalises x against the first sample (large absolute UTs)", () => {
    const result = slopeFit([
      { x: 1_000_000_000, y: 50 },
      { x: 1_000_000_001, y: 60 },
      { x: 1_000_000_002, y: 70 },
      { x: 1_000_000_003, y: 80 },
    ]);
    if (result === null) throw new Error("expected non-null result");
    expect(result.slope).toBeCloseTo(10, 8);
  });

  it("returns null when all samples share the same x (degenerate)", () => {
    const result = slopeFit([
      { x: 5, y: 1 },
      { x: 5, y: 2 },
      { x: 5, y: 3 },
    ]);
    expect(result).toBeNull();
  });
});
