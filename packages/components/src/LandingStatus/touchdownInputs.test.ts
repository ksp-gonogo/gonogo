import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  finiteMagnitudes,
  gridSideOf,
  siteDescription,
  siteElevationOf,
} from "./touchdownInputs";

describe("the touchdown inputs", () => {
  it("describes the site's slope from the quantity itself, and says nothing for an absent or unreadable one", () => {
    expect(siteDescription(value("°", 12), null, null)).toContain("12.0°");
    expect(siteDescription(null, null, null)).toBe("predicted touchdown site");
    expect(siteDescription(value("°", Number.NaN), null, null)).toBe(
      "predicted touchdown site",
    );
  });

  it("takes the grid's side from its samples, and only while the wire's own count agrees", () => {
    const samples = Array.from({ length: 9 }, (_, i) => i);
    expect(gridSideOf(samples, value("count", 3))).toBe(3);
    expect(gridSideOf(samples, value("count", 4))).toBeNull();
    expect(gridSideOf(samples, null)).toBeNull();
    expect(gridSideOf([1, 2, 3], value("count", 3))).toBeNull();
    expect(gridSideOf(null, value("count", 3))).toBeNull();
  });

  it("draws no grid with a hole in it", () => {
    expect(
      finiteMagnitudes([value("m", 1), value("m", Number.NaN)]),
    ).toBeNull();
    expect(finiteMagnitudes([value("m", 1), value("m", 2)])).toEqual([1, 2]);
  });

  it("stands the site's elevation on the wire's figure, or on the craft's altitude less its height above the ground", () => {
    const asl = value("m", 500);
    expect(
      siteElevationOf(value("m", 80), asl, value("m", 100))?.magnitude,
    ).toBe(80);
    expect(siteElevationOf(null, asl, value("m", 100))?.magnitude).toBe(400);
    expect(siteElevationOf(null, asl, value("m", -5))?.magnitude).toBe(500);
    expect(siteElevationOf(null, asl, null)?.magnitude).toBe(500);
    expect(siteElevationOf(null, null, value("m", 100))).toBeNull();
  });
});
