import { ANALYTIC_BODY_HORIZON } from "@ksp-gonogo/sitrep-client";
import { act, renderHook, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import type { CelestialBody } from "./useCelestialBodies";
import { usePhaseAngles } from "./usePhaseAngles";

/**
 * Characterises what `undefined` means to `usePhaseAngles`: one read behind one gate, `if (!orbit) return EMPTY`.
 *
 * No vessel orbit, a hyperbolic orbit, and every body lacking elements all reach the shared `EMPTY`. A `Reading` is always truthy, so the gate stops gating on migration.
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
    // About geometry, not how far anyone vouches for it, so every body is unbounded and analytic.
    horizon: ANALYTIC_BODY_HORIZON,
    period: null,
    trueAnomaly: null,
    mass: null,
    geeASL: null,
    escapeVelocity: null,
    hillSphere: null,
    rotationPeriod: null,
    initialRotation: null,
    tidallyLocked: null,
    rotates: null,
    hasOcean: null,
    description: null,
    atmosphere: null,
    hasAtmosphere: null,
    maxAtmosphere: null,
    hasOxygen: null,
    figures: {
      radius: null,
      mass: null,
      surfaceGravity: null,
      dayLength: null,
      atmosphereDepth: null,
    },
    ...overrides,
  };
}

/** A circular vessel orbit at true longitude `lonDeg` at UT 0 with the stock analytic horizon, so a missing-elements fixture does not also test a missing horizon. */
function vesselAtLongitude(lonDeg: number): Record<string, unknown> {
  return {
    referenceBodyIndex: 0,
    sma: 700_000,
    ecc: 0,
    inc: 0,
    lan: lonDeg,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
    mu: KERBIN_MU,
    horizon: ANALYTIC_UNBOUNDED_HORIZON,
  };
}

function renderPhaseAngles(bodies: CelestialBody[], pinnedUt = 0) {
  const fixture = setupStreamFixture({
    pinnedUt,
    suspendFrames: true,
  });
  const { result, rerender } = renderHook(
    ({ b }: { b: CelestialBody[] }) => usePhaseAngles(b),
    { wrapper: fixture.Provider, initialProps: { b: bodies } },
  );
  return { fixture, result, rerender };
}

/** A body whose true longitude is unambiguously 90 degrees. */
function bodyAt90() {
  return makeBody(1, "Mun", {
    lan: 90,
    argumentOfPeriapsis: 0,
    trueAnomaly: 0,
  });
}

describe("usePhaseAngles: what undefined means today", () => {
  it("answers no phase angle for a fully-elemented body while vessel.orbit is absent", () => {
    const { result } = renderPhaseAngles([bodyAt90()]);

    // The gate short-circuits before the body loop, so one absent read erases every body's answer.
    expect(result.current.size).toBe(0);
    expect(result.current.has(1)).toBe(false);
    expect(result.current.get(1)).toBeUndefined();
  });

  it("hands every data-less render the same EMPTY map instance, whatever the bodies are", () => {
    const { result, rerender } = renderPhaseAngles([bodyAt90()]);
    const first = result.current;

    // `EMPTY`'s identity keeps SystemView's transfer-window memo from recomputing every frame.
    rerender({ b: [makeBody(2, "Minmus", { lan: 45 })] });
    expect(result.current).toBe(first);
    rerender({ b: [] });
    expect(result.current).toBe(first);
  });

  it("cannot tell an absent vessel orbit from bodies that have no elements", async () => {
    const { fixture, result } = renderPhaseAngles([
      makeBody(1, "Mun"), // every element null: the useCelestialBodies partial
    ]);
    const beforeAnyOrbit = result.current;

    act(() => {
      fixture.emit("vessel.orbit", vesselAtLongitude(0));
    });

    // "Vessel missing" and "bodies missing" reach the identical value, so a consumer cannot say which it awaits.
    await waitFor(() => expect(result.current.size).toBe(0));
    expect(result.current).toBe(beforeAnyOrbit);
  });

  it("skips only the body whose elements are missing, keeping the elemented one", async () => {
    const { fixture, result } = renderPhaseAngles([
      bodyAt90(),
      makeBody(2, "Ike", { lan: 45, argumentOfPeriapsis: 0 }), // trueAnomaly null
    ]);
    act(() => {
      fixture.emit("vessel.orbit", vesselAtLongitude(0));
    });

    await waitFor(() => expect(result.current.get(1)).toBeCloseTo(90, 4));
    // Absence is per body: a partly-resynced body is left out of the map, never plotted at longitude 0.
    expect(result.current.has(2)).toBe(false);
  });

  it("treats a null vessel.orbit as not-arrived-yet, not as a confirmed absence", async () => {
    // View time ahead of both samples so the tombstone is the one sampled.
    const { fixture, result } = renderPhaseAngles([bodyAt90()], 10);
    act(() => {
      fixture.emit("vessel.orbit", vesselAtLongitude(0));
    });
    await waitFor(() => expect(result.current.size).toBe(1));

    act(() => {
      fixture.emit("vessel.orbit", null, { validAt: 5, seq: 1 });
    });

    // A tombstone is caught exactly like `undefined`: "confirmed no orbit" and "not heard yet" are the same EMPTY.
    await waitFor(() => expect(result.current.size).toBe(0));
  });

  it("reads an absent LAN and argPe as a real zero, indistinguishable from an equatorial orbit", async () => {
    const noNodeElements = {
      referenceBodyIndex: 0,
      sma: 700_000,
      ecc: 0,
      inc: 0,
      // lan and argPe deliberately absent: both are optional on the wire.
      meanAnomalyAtEpoch: 0,
      epoch: 0,
      mu: KERBIN_MU,
      horizon: ANALYTIC_UNBOUNDED_HORIZON,
    };
    const { fixture, result } = renderPhaseAngles([bodyAt90()]);
    act(() => {
      fixture.emit("vessel.orbit", noNodeElements);
    });

    // `orbit.lan?.magnitude ?? 0` gives a confident 90 degrees, exactly what an equatorial vessel produces.
    await waitFor(() => expect(result.current.get(1)).toBeCloseTo(90, 4));

    const explicitZeroes = renderPhaseAngles([bodyAt90()]);
    act(() => {
      explicitZeroes.fixture.emit("vessel.orbit", vesselAtLongitude(0));
    });
    await waitFor(() =>
      expect(explicitZeroes.result.current.get(1)).toBeCloseTo(90, 4),
    );
    expect(result.current.get(1)).toBe(explicitZeroes.result.current.get(1));
  });
});
