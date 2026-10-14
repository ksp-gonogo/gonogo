import { describe, expect, it } from "vitest";
import { writeThreeFigures } from "./ticks";

describe("writeThreeFigures", () => {
  it("keeps three significant figures in whatever unit the kit settles on", () => {
    expect(writeThreeFigures({ magnitude: 477.68, unit: "Pa" })).toBe("478 Pa");
    expect(writeThreeFigures({ magnitude: 37_280, unit: "Pa" })).toBe(
      "37.3 kPa",
    );
    expect(writeThreeFigures({ magnitude: 1_210, unit: "Pa" })).toBe(
      "1.21 kPa",
    );
  });
});
