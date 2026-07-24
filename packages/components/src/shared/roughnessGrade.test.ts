import { describe, expect, it } from "vitest";
import { rateTerrainRoughness } from "./roughnessGrade";

describe("rateTerrainRoughness", () => {
  it("grades the shared A/B/C/F bands by elevation sigma", () => {
    expect(rateTerrainRoughness(30)).toEqual({ badge: "A", label: "Smooth" });
    expect(rateTerrainRoughness(120)).toEqual({
      badge: "B",
      label: "Acceptable",
    });
    expect(rateTerrainRoughness(300)).toEqual({ badge: "C", label: "Rough" });
    expect(rateTerrainRoughness(500)).toEqual({
      badge: "F",
      label: "Hazardous",
    });
  });

  it("puts the boundaries on the lower band (< is exclusive at the top)", () => {
    expect(rateTerrainRoughness(50).badge).toBe("B");
    expect(rateTerrainRoughness(150).badge).toBe("C");
    expect(rateTerrainRoughness(400).badge).toBe("F");
  });

  it("fails safe (F) on a non-finite or negative sigma", () => {
    expect(rateTerrainRoughness(Number.NaN).badge).toBe("F");
    expect(rateTerrainRoughness(-1).badge).toBe("F");
  });
});
