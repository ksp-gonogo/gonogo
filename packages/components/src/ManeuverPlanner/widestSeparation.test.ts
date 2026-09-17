import { describe, expect, it } from "vitest";
import { widestSeparation } from "./ConformancePlot";

/**
 * The rule these pin is one that was got WRONG: the first version took the gap
 * at apoapsis, on the argument that a burn changes the orbit most opposite the
 * point it was made at. That holds only for a burn AT an apsis, and against a
 * real fixture whose conics nearly share an apoapsis it reported about a metre
 * for a pair visibly far apart, which then asked for a detail frame six metres
 * across and filled the panel with it.
 */
describe("widestSeparation: where two conics are actually furthest apart", () => {
  it("finds the far apsis when the burn was made at one", () => {
    // Raised apoapsis, shared periapsis: the textbook case the old rule assumed
    // was the only one.
    const found = widestSeparation(
      { sma: 973479.265252, ecc: 0.28093, argPe: 0 },
      {
        sma: 978971.589918,
        ecc: 0.284964,
        apoapsis: 1257943.179836,
        periapsis: 700000,
      },
    );

    expect(found).not.toBeNull();
    expect(found?.gap).toBeCloseTo(10985, -2);
  });

  it("finds a gap the apsides do not show, which the old rule missed entirely", () => {
    // Two conics whose apoapsis radii agree to within a metre and whose
    // periapsides are half a megametre apart. Reading the apsis alone calls
    // this pair identical.
    const found = widestSeparation(
      { sma: 342639.122959941, ecc: 0.901337673352758, argPe: 185.8 },
      {
        sma: 361169.27946205,
        ecc: 0.803788750928158,
        argPe: 185.79,
        apoapsis: 651472.672848,
        periapsis: 70865.886,
      },
    );

    expect(found).not.toBeNull();
    // Far more than the ~1 m the apoapsis comparison reports for this pair.
    expect(found?.gap ?? 0).toBeGreaterThan(30_000);
  });

  it("withholds when either conic is unbounded", () => {
    expect(
      widestSeparation(
        { sma: 973479, ecc: 0.28, argPe: 0 },
        { sma: -900_000, ecc: 1.4, apoapsis: 0, periapsis: 650_000 },
      ),
    ).toBeNull();
  });
});
