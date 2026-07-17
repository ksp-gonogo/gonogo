import { renderHook } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import type { CelestialBody } from "./useCelestialBodies";
import { usePhaseAngles } from "./usePhaseAngles";

/**
 * `usePhaseAngles` rode Telemachus's `b.o.phaseAngle[i]` via the deleted
 * `getDataSource("data")` source, so it already degraded to empty in the field.
 * The migration keeps it a strict non-regression — an empty map — until the
 * client-side phase-angle derivation is built (see the hook's doc comment).
 * These tests pin that contract so a future derivation lands deliberately, not
 * by accident.
 */

function makeBody(index: number, name: string): CelestialBody {
  // Only `index` is read by any consumer keyed off this hook's result; the rest
  // are filler so the fixture satisfies the type.
  return {
    index,
    name,
    referenceBody: null,
    radius: null,
    soi: null,
    gravParameter: null,
    semiMajorAxis: null,
    eccentricity: null,
    inclination: null,
    lan: null,
    argumentOfPeriapsis: null,
    meanAnomalyAtEpoch: null,
    epoch: null,
    period: null,
    trueAnomaly: null,
    mass: null,
    geeASL: null,
    escapeVelocity: null,
    hillSphere: null,
    rotationPeriod: null,
    tidallyLocked: null,
    rotates: null,
    hasOcean: null,
    description: null,
    atmosphere: null,
    hasAtmosphere: null,
    maxAtmosphere: null,
    hasOxygen: null,
  };
}

describe("usePhaseAngles (migration: empty until derived)", () => {
  it("returns an empty map for any body list", () => {
    const { result } = renderHook(() =>
      usePhaseAngles([makeBody(0, "Mun"), makeBody(1, "Minmus")]),
    );
    expect(result.current.size).toBe(0);
  });

  it("returns a stable map identity across re-renders (no consumer churn)", () => {
    const { result, rerender } = renderHook(
      ({ bodies }: { bodies: CelestialBody[] }) => usePhaseAngles(bodies),
      { initialProps: { bodies: [makeBody(0, "Mun")] } },
    );
    const first = result.current;
    rerender({ bodies: [makeBody(2, "Duna")] });
    expect(result.current).toBe(first);
    expect(result.current.size).toBe(0);
  });
});
