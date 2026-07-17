import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { GRAVITATIONAL_CONSTANT, STANDARD_GRAVITY } from "./bodyDerivations";
import { useCelestialBodies } from "./useCelestialBodies";

/**
 * `useCelestialBodies` reads the mod's `system.bodies` Topic through a real
 * `TelemetryProvider` (no legacy `MockDataSource`, no `getDataSource` shim
 * bypass) and enriches each body with the derived almanac values.
 */

const KERBIN_MU = 3.5316e12;

function renderBodies() {
  const fixture = setupStreamFixture({
    carriedChannels: ["system.bodies"],
    pinnedUt: 0,
  });
  const { result } = renderHook(() => useCelestialBodies(), {
    wrapper: fixture.Provider,
  });
  return { fixture, result };
}

describe("useCelestialBodies", () => {
  it("returns an empty array before the first system.bodies sample", () => {
    const { result } = renderBodies();
    expect(result.current).toEqual([]);
  });

  it("maps the streamed tree and resolves parentIndex → referenceBody name", async () => {
    const { fixture, result } = renderBodies();
    act(() => {
      fixture.emit("system.bodies", {
        bodies: [
          {
            index: 0,
            name: "Kerbol",
            parentIndex: null,
            radius: 261_600_000,
            gravParameter: 1.1723328e18,
            orbit: null,
          },
          {
            index: 1,
            name: "Kerbin",
            parentIndex: 0,
            radius: 600_000,
            gravParameter: KERBIN_MU,
            orbit: {
              sma: 13_599_840_256,
              ecc: 0,
              inc: 0,
              lan: 0,
              argPe: 0,
              meanAnomalyAtEpoch: 3.14,
              epoch: 0,
            },
          },
        ],
      });
    });

    await waitFor(() => expect(result.current).toHaveLength(2));
    const kerbol = result.current[0];
    expect(kerbol.name).toBe("Kerbol");
    expect(kerbol.radius).toBe(261_600_000);
    expect(kerbol.referenceBody).toBeNull();

    const kerbin = result.current[1];
    expect(kerbin.name).toBe("Kerbin");
    expect(kerbin.referenceBody).toBe("Kerbol");
    expect(kerbin.semiMajorAxis).toBe(13_599_840_256);
  });

  it("derives mass, surface gravity and period the wire no longer carries", async () => {
    const { fixture, result } = renderBodies();
    act(() => {
      fixture.emit("system.bodies", {
        bodies: [
          {
            index: 0,
            name: "Kerbol",
            parentIndex: null,
            radius: 261_600_000,
            gravParameter: 1.1723328e18,
            orbit: null,
          },
          {
            index: 1,
            name: "Kerbin",
            parentIndex: 0,
            radius: 600_000,
            gravParameter: KERBIN_MU,
            orbit: {
              sma: 13_599_840_256,
              ecc: 0,
              inc: 0,
              lan: 0,
              argPe: 0,
              meanAnomalyAtEpoch: 0,
              epoch: 0,
            },
          },
        ],
      });
    });

    await waitFor(() => expect(result.current).toHaveLength(2));
    const kerbin = result.current[1];
    expect(kerbin.mass).toBeCloseTo(KERBIN_MU / GRAVITATIONAL_CONSTANT, -10);
    expect(kerbin.geeASL).toBeCloseTo(
      KERBIN_MU / (600_000 * 600_000) / STANDARD_GRAVITY,
      2,
    );
    // Parent μ = Kerbol's → a real, positive orbital period.
    expect(kerbin.period).not.toBeNull();
    expect(kerbin.period as number).toBeGreaterThan(0);
    // ecc 0, maae 0, ut(pinned) 0 → true anomaly 0°.
    expect(kerbin.trueAnomaly).toBeCloseTo(0, 4);
  });

  it("surfaces the nested atmosphere object and its convenience mirrors; null for airless bodies", async () => {
    const { fixture, result } = renderBodies();
    act(() => {
      fixture.emit("system.bodies", {
        bodies: [
          {
            index: 0,
            name: "Kerbin",
            parentIndex: null,
            radius: 600_000,
            gravParameter: KERBIN_MU,
            hasOcean: true,
            atmosphere: {
              depth: 70_000,
              hasOxygen: true,
              seaLevelPressure: 101.325,
            },
            orbit: null,
          },
          {
            index: 1,
            name: "Mun",
            parentIndex: 0,
            radius: 200_000,
            gravParameter: 6.5138398e10,
            tidallyLocked: true,
            hasOcean: false,
            atmosphere: null,
            orbit: {
              sma: 12_000_000,
              ecc: 0,
              inc: 0,
              lan: 0,
              argPe: 0,
              meanAnomalyAtEpoch: 0,
              epoch: 0,
            },
          },
        ],
      });
    });

    await waitFor(() => expect(result.current).toHaveLength(2));
    const kerbin = result.current[0];
    expect(kerbin.hasAtmosphere).toBe(true);
    expect(kerbin.atmosphere?.depth).toBe(70_000);
    expect(kerbin.atmosphere?.seaLevelPressure).toBe(101.325);
    expect(kerbin.maxAtmosphere).toBe(70_000);
    expect(kerbin.hasOxygen).toBe(true);
    expect(kerbin.hasOcean).toBe(true);

    const mun = result.current[1];
    expect(mun.hasAtmosphere).toBe(false);
    expect(mun.atmosphere).toBeNull();
    expect(mun.maxAtmosphere).toBeNull();
    expect(mun.tidallyLocked).toBe(true);
    // rotationPeriod absent → rotates unknown (null), not false.
    expect(mun.rotates).toBeNull();
  });

  it("rebuilds cleanly when a smaller tree arrives — no stale bodies linger", async () => {
    const { fixture, result } = renderBodies();
    act(() => {
      fixture.emit("system.bodies", {
        bodies: [
          { index: 0, name: "A", parentIndex: null, orbit: null },
          { index: 1, name: "B", parentIndex: 0, orbit: null },
          { index: 2, name: "C", parentIndex: 0, orbit: null },
        ],
      });
    });
    await waitFor(() => expect(result.current).toHaveLength(3));

    act(() => {
      fixture.emit("system.bodies", {
        bodies: [{ index: 0, name: "A", parentIndex: null, orbit: null }],
      });
    });
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].name).toBe("A");
  });
});
