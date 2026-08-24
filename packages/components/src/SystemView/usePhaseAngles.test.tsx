import type { PropagationHorizonLike } from "@ksp-gonogo/sitrep-client";
import { act, renderHook, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import {
  ANALYTIC_UNBOUNDED_HORIZON,
  integratedHorizon,
  UNBOUNDED_HORIZON,
} from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import type { CelestialBody } from "./useCelestialBodies";
import { usePhaseAngles } from "./usePhaseAngles";

/**
 * `usePhaseAngles` derives each body's phase angle to the active vessel
 * CLIENT-SIDE, from elements the stream already carries.
 * Phase angle = `wrap360(bodyLon − vesselLon)` in [0, 360), where a body's true
 * longitude is `wrap360(lan + argPe + trueAnomaly)`. The bodies arrive with those
 * elements already on `CelestialBody` (view-UT-derived `trueAnomaly`); the vessel
 * side is read off the `vessel.orbit` Topic through a real `TelemetryProvider`
 * (its true anomaly solved at the view-UT via the shared Kepler path).
 *
 * Positive = body ahead of the vessel in the prograde direction, matching
 * `hohmannPhaseAngle`'s "+ = target ahead" so `angleDelta(live, ideal)` lines up.
 */

const KERBIN_MU = 3.5316e12;

/** A `CelestialBody` fixture: only the orbital-longitude inputs matter here. */
function makeBody(
  index: number,
  name: string,
  overrides: Partial<CelestialBody> = {},
): CelestialBody {
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
    ...overrides,
  };
}

/**
 * A circular vessel orbit whose true longitude is exactly `lonDeg` at UT 0.
 *
 * The horizon is what the stock analytic producer sends unless a test states
 * otherwise. It has to be stated: the hook propagates these elements to the
 * view instant, and a sample carrying no horizon is one from a producer that
 * dropped the field, which is not a licence to extrapolate.
 */
function vesselAtLongitude(
  lonDeg: number,
  horizon: PropagationHorizonLike = ANALYTIC_UNBOUNDED_HORIZON,
): Record<string, unknown> {
  return {
    referenceBodyIndex: 0,
    sma: 700_000,
    ecc: 0, // circular → ν = mean anomaly = 0 at epoch, so lon = lan
    inc: 0,
    lan: lonDeg,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
    mu: KERBIN_MU,
    horizon,
  };
}

function renderPhaseAngles(bodies: CelestialBody[]) {
  const fixture = setupStreamFixture({
    carriedChannels: ["vessel.orbit"],
    pinnedUt: 0,
  });
  const { result, rerender } = renderHook(
    ({ b }: { b: CelestialBody[] }) => usePhaseAngles(b),
    { wrapper: fixture.Provider, initialProps: { b: bodies } },
  );
  return { fixture, result, rerender };
}

describe("usePhaseAngles", () => {
  it("computes 90° when the body leads the vessel by a quarter turn", async () => {
    const { fixture, result } = renderPhaseAngles([
      makeBody(1, "Mun", { lan: 90, argumentOfPeriapsis: 0, trueAnomaly: 0 }),
    ]);
    act(() => {
      fixture.emit("vessel.orbit", vesselAtLongitude(0));
    });
    await waitFor(() => expect(result.current.get(1)).toBeCloseTo(90, 4));
  });

  it("computes 180° for a body diametrically opposite the vessel", async () => {
    const { fixture, result } = renderPhaseAngles([
      makeBody(1, "Mun", { lan: 0, argumentOfPeriapsis: 0, trueAnomaly: 180 }),
    ]);
    act(() => {
      fixture.emit("vessel.orbit", vesselAtLongitude(0));
    });
    await waitFor(() => expect(result.current.get(1)).toBeCloseTo(180, 4));
  });

  it("wraps the seam: vessel at 350°, body at 10° → 20°", async () => {
    const { fixture, result } = renderPhaseAngles([
      makeBody(1, "Mun", { lan: 10, argumentOfPeriapsis: 0, trueAnomaly: 0 }),
    ]);
    act(() => {
      fixture.emit("vessel.orbit", vesselAtLongitude(350));
    });
    await waitFor(() => expect(result.current.get(1)).toBeCloseTo(20, 4));
  });

  it("sums lan + argPe + trueAnomaly into a body's true longitude", async () => {
    // body lon = 30 + 40 + 20 = 90; vessel lon = 0 → phase 90.
    const { fixture, result } = renderPhaseAngles([
      makeBody(1, "Mun", { lan: 30, argumentOfPeriapsis: 40, trueAnomaly: 20 }),
    ]);
    act(() => {
      fixture.emit("vessel.orbit", vesselAtLongitude(0));
    });
    await waitFor(() => expect(result.current.get(1)).toBeCloseTo(90, 4));
  });

  it("keys every body that has full elements", async () => {
    const { fixture, result } = renderPhaseAngles([
      makeBody(1, "Mun", { lan: 45, argumentOfPeriapsis: 0, trueAnomaly: 0 }),
      makeBody(2, "Minmus", {
        lan: 135,
        argumentOfPeriapsis: 0,
        trueAnomaly: 0,
      }),
    ]);
    act(() => {
      fixture.emit("vessel.orbit", vesselAtLongitude(0));
    });
    await waitFor(() => expect(result.current.size).toBe(2));
    expect(result.current.get(1)).toBeCloseTo(45, 4);
    expect(result.current.get(2)).toBeCloseTo(135, 4);
  });

  it("skips a body missing orbital elements, keeps the rest", async () => {
    const { fixture, result } = renderPhaseAngles([
      makeBody(1, "Mun", { lan: 90, argumentOfPeriapsis: 0, trueAnomaly: 0 }),
      makeBody(2, "Root", {}), // no elements: not orbiting anything
    ]);
    act(() => {
      fixture.emit("vessel.orbit", vesselAtLongitude(0));
    });
    await waitFor(() => expect(result.current.get(1)).toBeCloseTo(90, 4));
    expect(result.current.has(2)).toBe(false);
  });

  it("is empty (stable identity) until the vessel orbit arrives", () => {
    const { result, rerender } = renderPhaseAngles([
      makeBody(1, "Mun", { lan: 90, argumentOfPeriapsis: 0, trueAnomaly: 0 }),
    ]);
    const first = result.current;
    expect(first.size).toBe(0);
    rerender({ b: [makeBody(2, "Minmus", { lan: 45 })] });
    expect(result.current).toBe(first); // no consumer churn while data-less
    expect(result.current.size).toBe(0);
  });

  it("is empty for a hyperbolic vessel orbit (ecc ≥ 1, no phase reference)", async () => {
    const { fixture, result } = renderPhaseAngles([
      makeBody(1, "Mun", { lan: 90, argumentOfPeriapsis: 0, trueAnomaly: 0 }),
    ]);
    act(() => {
      fixture.emit("vessel.orbit", {
        ...vesselAtLongitude(0),
        sma: -8_000_000,
        ecc: 1.3,
      });
    });
    // Give the stream a beat; the map must stay empty.
    await waitFor(() => expect(result.current.size).toBe(0));
  });

  /**
   * A phase angle is these elements propagated to the instant on screen, which
   * is the one thing the elected provider gets to bound. SystemView's own
   * `derived` memo puts exactly this question to `canPropagate`; this read did
   * not, so an operator scrubbed past an integrator's horizon lost the vessel
   * dot and kept a transfer-window highlight computed from where the craft
   * would have been.
   *
   * SHAPE is not consulted, and the last case says so: a position at one instant
   * needs no shape, only a curve does.
   */
  describe("asks the provider before propagating to the view instant", () => {
    it("is empty when no horizon was stated at all", async () => {
      const { fixture, result } = renderPhaseAngles([
        makeBody(1, "Mun", { lan: 90, argumentOfPeriapsis: 0, trueAnomaly: 0 }),
      ]);
      act(() => {
        // `horizon` absent entirely: a producer predating the field or one that
        // dropped it, and neither is a licence to extrapolate.
        const { horizon: _dropped, ...noHorizon } = vesselAtLongitude(0);
        fixture.emit("vessel.orbit", noHorizon);
      });
      await waitFor(() => expect(result.current.size).toBe(0));
    });

    it("is empty once the view instant runs past the integrator's horizon", async () => {
      const { fixture, result } = renderPhaseAngles([
        makeBody(1, "Mun", { lan: 90, argumentOfPeriapsis: 0, trueAnomaly: 0 }),
      ]);
      act(() => {
        // The fixture pins the clock at UT 0, so a horizon at -100 is already
        // behind the instant being asked about.
        fixture.emit(
          "vessel.orbit",
          vesselAtLongitude(0, integratedHorizon(-100)),
        );
      });
      await waitFor(() => expect(result.current.size).toBe(0));
    });

    it("answers for an integrating provider inside its horizon, shape or no shape", async () => {
      const { fixture, result } = renderPhaseAngles([
        makeBody(1, "Mun", { lan: 90, argumentOfPeriapsis: 0, trueAnomaly: 0 }),
      ]);
      act(() => {
        fixture.emit(
          "vessel.orbit",
          vesselAtLongitude(0, integratedHorizon(5000)),
        );
      });
      await waitFor(() => expect(result.current.get(1)).toBeCloseTo(90, 4));
    });

    it("answers when reach is stated and shape is not", async () => {
      // Where the craft IS does not depend on whether a conic is the right
      // renderer for its path. Refusing here would be a refusal nobody stated.
      const { fixture, result } = renderPhaseAngles([
        makeBody(1, "Mun", { lan: 90, argumentOfPeriapsis: 0, trueAnomaly: 0 }),
      ]);
      act(() => {
        fixture.emit("vessel.orbit", vesselAtLongitude(0, UNBOUNDED_HORIZON));
      });
      await waitFor(() => expect(result.current.get(1)).toBeCloseTo(90, 4));
    });
  });
});
