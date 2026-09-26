import { describe, expect, it } from "vitest";
import { widestSeparation } from "./ConformancePlot";

// The far apsis is the widest point only for a burn made at an apsis.
describe("widestSeparation: where two conics are actually furthest apart", () => {
  it("finds the far apsis when the burn was made at one", () => {
    // Raised apoapsis, shared periapsis.
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
    // Apoapsis radii within a metre, periapsides half a megametre apart.
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
