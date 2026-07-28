import { act, renderHook } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { useGroundSurveySamples } from "./useGroundSurveySamples";

/**
 * Encodes producer↔consumer disagreement **L1**
 * (`docs/superpowers/specs/2026-07-24-producer-consumer-disagreements.md`).
 *
 * PRODUCER: the mod publishes TWO distinct terrain-height quantities,
 * `vessel.flight.altitudeTerrain` (KSP `radarAltitude`, from the CENTRE OF
 * MASS) and `vessel.surface.heightFromTerrain` (KSP's own `heightFromTerrain`,
 * accounting for the vessel's physical extent: the lowest-point-to-ground
 * distance a landing widget actually wants; see `VesselSurface.cs`). LandingStatus
 * already prefers the surface value and falls back to the CoM value with a note.
 *
 * CONSUMER: `useGroundSurveySamples` reads only `vessel.flight.altitudeTerrain`
 * (the CoM value) as its `hft`, driving the terrain strip AND the freeze/ceiling
 * thresholds: off by the CoM-to-lowest-point offset, the exact gear height that
 * decides the freeze on final approach.
 *
 * FIXED (2026-07-24): the hook now reads `vessel.surface.heightFromTerrain`
 * with a CoM fallback (like LandingStatus). This is the regression test, it
 * asserts the freeze tracks the lowest-point surface datum, not the CoM radar
 * altitude.
 */
describe("GroundSurvey: L1: freeze datum is vessel.surface, not CoM altitude", () => {
  it("freezes on the lowest-point surface height, not the CoM radar altitude", () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.flight", "vessel.surface"],
    });
    const { result } = renderHook(() => useGroundSurveySamples(), {
      wrapper: fixture.Provider,
    });

    act(() => {
      // CoM radar altitude 1100 m: ABOVE the 1000 m freezeBelowM: but the
      // craft's LOWEST point is 900 m from the ground (BELOW it): a lander
      // with ~200 m of body/gear below its centre of mass.
      fixture.emit("vessel.flight", {
        latitude: 0,
        longitude: 0,
        altitudeAsl: 5_000,
        altitudeTerrain: 1_100,
        verticalSpeed: -20,
        surfaceSpeed: 5,
        orbitalSpeed: 5,
        gForce: 1,
        dynamicPressureKPa: 0,
        mach: 0,
        atmDensity: 0,
        externalTemperature: 280,
        atmosphericTemperature: 280,
      });
      fixture.emit("vessel.surface", { heightFromTerrain: 900 });
      fixture.store.beginFrame();
    });

    // CORRECT: lowest point (900 m) is below freezeBelowM (1000 m) -> "frozen".
    // BUG today: the hook uses altitudeTerrain (1100 m) -> "active".
    expect(result.current.surveyState).toBe("frozen");
  });
});
