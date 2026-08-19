import { act, renderHook, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import type { CelestialBody } from "./useCelestialBodies";
import { usePhaseAngles } from "./usePhaseAngles";

/**
 * CHARACTERISATION of what `undefined` MEANS to `usePhaseAngles` today.
 *
 * One telemetry read, `useTelemetry("vessel.orbit")`, behind one gate:
 *
 *     if (!orbit) return EMPTY;
 *
 * `EMPTY` is a module-level shared `Map`, and the hook's own doc says the empty
 * map is "treated as no highlight". Three separate situations reach it: no
 * vessel orbit has arrived, the orbit is hyperbolic, and every body lacked
 * elements (`out.size > 0 ? out : EMPTY`). A `Reading` is always truthy, so the
 * gate above stops gating on migration and `orbit.sma.magnitude` reads a field
 * off the wrapper instead of the payload.
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

/** A circular vessel orbit whose true longitude is exactly `lonDeg` at UT 0. */
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
  };
}

function renderPhaseAngles(bodies: CelestialBody[], pinnedUt = 0) {
  const fixture = setupStreamFixture({
    carriedChannels: ["vessel.orbit"],
    pinnedUt,
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
  // ── 1. Nothing has arrived at all ────────────────────────────────────────

  it("answers no phase angle for a fully-elemented body while vessel.orbit is absent", () => {
    const { result } = renderPhaseAngles([bodyAt90()]);

    // The body has everything the maths needs; only the vessel side is missing.
    // The gate short-circuits before the body loop runs at all, so the absence
    // of ONE telemetry read erases every body's answer rather than the vessel's.
    expect(result.current.size).toBe(0);
    expect(result.current.has(1)).toBe(false);
    expect(result.current.get(1)).toBeUndefined();
  });

  it("hands every data-less render the same EMPTY map instance, whatever the bodies are", () => {
    const { result, rerender } = renderPhaseAngles([bodyAt90()]);
    const first = result.current;

    // The shared module-level `EMPTY` is what `SystemView`'s `transferStatuses`
    // memo depends on, so its identity is load-bearing: a fresh map per render
    // would recompute the whole transfer-window pass every frame.
    rerender({ b: [makeBody(2, "Minmus", { lan: 45 })] });
    expect(result.current).toBe(first);
    rerender({ b: [] });
    expect(result.current).toBe(first);
  });

  // ── 2. The absence gate is indistinguishable from two other outcomes ─────

  it("cannot tell an absent vessel orbit from bodies that have no elements", async () => {
    const { fixture, result } = renderPhaseAngles([
      makeBody(1, "Mun"), // every element null: the useCelestialBodies partial
    ]);
    const beforeAnyOrbit = result.current;

    act(() => {
      fixture.emit("vessel.orbit", vesselAtLongitude(0));
    });

    // `out.size > 0 ? out : EMPTY` sends "the vessel is missing" and "the bodies
    // are missing" to the identical value, down to object identity, so a
    // consumer cannot report which side it is waiting on.
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
    // Per-body absence is per-body: `trueLongitudeDeg` returns null for the
    // missing element and the loop `continue`s. A partly-resynced body is
    // absent from the map, never plotted at longitude 0.
    expect(result.current.has(2)).toBe(false);
  });

  // ── 3. null versus undefined ─────────────────────────────────────────────

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

    // A tombstone surfaces as `null` from `useTelemetry`, and `!orbit` catches
    // it exactly as it catches `undefined`: the hook does not distinguish
    // "confirmed no orbit" from "have not heard yet", and reverts to the shared
    // EMPTY with no record that anything was ever known.
    await waitFor(() => expect(result.current.size).toBe(0));
  });

  // ── 4. A partial payload: the record arrived, a field inside did not ─────

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
    };
    const { fixture, result } = renderPhaseAngles([bodyAt90()]);
    act(() => {
      fixture.emit("vessel.orbit", noNodeElements);
    });

    // `orbit.lan?.magnitude ?? 0` coerces both absences to zero, so the answer
    // is a confident 90 degrees: exactly what an explicitly-equatorial vessel
    // at longitude 0 produces. The phase angle carries no trace of the two
    // elements never having arrived.
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
