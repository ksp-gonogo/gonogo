import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { plannedConic } from "./ConformanceSection";
import { widestSeparation } from "./widestSeparation";

const KERBIN_RADIUS_M = 600_000;

describe("plannedConic: the planned orbit in the same terms as the current one", () => {
  it("plans a circular orbit conformant with itself", () => {
    const radius = KERBIN_RADIUS_M + 100_000;
    const current = {
      sma: radius,
      ecc: 0,
      apoapsis: radius,
      periapsis: radius,
      argPe: 0,
    };
    const patch = {
      sma: value("m", radius),
      ecc: value("1", 0),
      argPe: value("°", 0),
      apA: value("m", radius - KERBIN_RADIUS_M),
      peA: value("m", radius - KERBIN_RADIUS_M),
    };

    const planned = plannedConic(patch);

    expect(planned).toEqual(current);
    expect(widestSeparation(current, planned)).toBeNull();
  });

  it("takes each apsis as a radius from the centre, not an altitude", () => {
    const planned = plannedConic({
      sma: value("m", 1_000_000),
      ecc: value("1", 0.25),
      argPe: value("°", 90),
    });

    expect(planned.apoapsis).toBe(1_250_000);
    expect(planned.periapsis).toBe(750_000);
  });
});
