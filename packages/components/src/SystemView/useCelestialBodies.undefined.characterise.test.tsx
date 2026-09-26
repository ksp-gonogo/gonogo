import { act, renderHook, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { useCelestialBodies } from "./useCelestialBodies";

/**
 * Characterises what `undefined` means to `useCelestialBodies`: one read and one gate, `if (!wire || wire.length === 0) return []`.
 *
 * Nothing arrived, a record without `bodies`, and an empty roster all collapse into one empty array. A `Reading` is always truthy, so both gates stop gating on migration.
 */

const KERBIN_MU = 3.5316e12;

function renderBodies(opts: { pinnedUt?: number } = { pinnedUt: 0 }) {
  const fixture = setupStreamFixture({
    carriedChannels: ["system.bodies"],
    pinnedUt: opts.pinnedUt,
    suspendFrames: true,
  });
  const { result, rerender } = renderHook(() => useCelestialBodies(), {
    wrapper: fixture.Provider,
  });
  return { fixture, result, rerender };
}

describe("useCelestialBodies: what undefined means today", () => {
  it("answers a stable empty roster before any system.bodies sample, never a hole", () => {
    const { result, rerender } = renderBodies();

    // An empty array, not undefined: consumers map over it unguarded, so never-arrived reads as "no bodies".
    expect(Array.isArray(result.current)).toBe(true);
    expect(result.current).toHaveLength(0);

    // Identity is held across re-renders while data-less, so memoising consumers do not recompute every frame.
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("fires the `!wire` gate for a record whose bodies field never arrived", async () => {
    const { fixture, result } = renderBodies();
    // The record is present with the array missing, so the gate short-circuits.
    act(() => {
      fixture.emit("system.bodies", {});
    });

    await waitFor(() => expect(result.current).toHaveLength(0));
  });

  it("cannot tell a confirmed empty roster from a stream that never spoke", async () => {
    const { fixture, result } = renderBodies();
    const beforeAnySample = result.current;
    act(() => {
      fixture.emit("system.bodies", { bodies: [] });
    });

    // "No bodies reported" and "nothing heard" are one state to every consumer.
    await waitFor(() => expect(result.current).toHaveLength(0));
    expect(result.current).toEqual(beforeAnySample);
  });

  it("treats a null system.bodies payload as not-arrived-yet, not as a confirmed absence", async () => {
    // View time ahead of both samples so the tombstone is the one sampled.
    const { fixture, result } = renderBodies({ pinnedUt: 10 });
    act(() => {
      fixture.emit("system.bodies", { bodies: [{ index: 0, name: "Kerbin" }] });
    });
    await waitFor(() => expect(result.current).toHaveLength(1));

    // A tombstone surfaces as `null`, the same gate fires, and a confirmed empty system renders like a cold topic with no age.
    act(() => {
      fixture.emit("system.bodies", null, { validAt: 5, seq: 1 });
    });
    await waitFor(() => expect(result.current).toHaveLength(0));
  });

  it("reports a body with no atmosphere field as confidently airless", async () => {
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
            orbit: null,
          },
        ],
      });
    });
    await waitFor(() => expect(result.current).toHaveLength(1));

    const kerbin = result.current[0];
    // `hasAtmosphere: atmosphere !== null` turns a missing field into `false`, which the almanac renders as "No atmosphere": the one unarrived value reported as fact.
    expect(kerbin.atmosphere).toBeNull();
    expect(kerbin.hasAtmosphere).toBe(false);
    // The two mirrors of the same missing field stay unknown, so the record is inconsistent about absence.
    expect(kerbin.maxAtmosphere).toBeNull();
    expect(kerbin.hasOxygen).toBeNull();
  });

  it("nulls every orbit element and every orbit derivation for a body with no orbit", async () => {
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
          },
        ],
      });
    });
    await waitFor(() => expect(result.current).toHaveLength(1));

    const root = result.current[0];
    // `entry.orbit ?? null` makes a root star and a body mid-resync the same record.
    expect(root.semiMajorAxis).toBeNull();
    expect(root.eccentricity).toBeNull();
    expect(root.lan).toBeNull();
    expect(root.argumentOfPeriapsis).toBeNull();
    expect(root.meanAnomalyAtEpoch).toBeNull();
    expect(root.epoch).toBeNull();
    // Derivations decline rather than coercing to zero, which is why `usePhaseAngles` can skip the body instead of plotting it at longitude 0.
    expect(root.period).toBeNull();
    expect(root.trueAnomaly).toBeNull();
    // Carried, not derived: absent reads null, as does KSP's PositiveInfinity for the root star.
    expect(root.hillSphere).toBeNull();
    expect(root.mass).toBeNull();
    // Only needs mu and radius, so a partial record is partially populated rather than dropped.
    expect(root.escapeVelocity).not.toBeNull();
  });

  it("nulls the mu-derived properties for a body whose gravParameter never arrived", async () => {
    const { fixture, result } = renderBodies();
    act(() => {
      fixture.emit("system.bodies", {
        bodies: [{ index: 0, name: "Kerbin", parentIndex: null, orbit: null }],
      });
    });
    await waitFor(() => expect(result.current).toHaveLength(1));

    const kerbin = result.current[0];
    // A body reduced to index and name still enters the list, with absence per field.
    expect(kerbin.name).toBe("Kerbin");
    expect(kerbin.gravParameter).toBeNull();
    expect(kerbin.mass).toBeNull();
    expect(kerbin.geeASL).toBeNull();
    expect(kerbin.escapeVelocity).toBeNull();
    expect(kerbin.radius).toBeNull();
    expect(kerbin.soi).toBeNull();
    // `rotates` stays unknown rather than false, unlike `hasAtmosphere` above.
    expect(kerbin.rotates).toBeNull();
  });

  it("nulls a child's derived period when the parent's mu is the missing field", async () => {
    const { fixture, result } = renderBodies();
    act(() => {
      fixture.emit("system.bodies", {
        bodies: [
          // Parent present but with no gravParameter: the child's orbit is complete and still cannot be turned into a period or an anomaly.
          { index: 0, name: "Kerbin", parentIndex: null, orbit: null },
          {
            index: 1,
            name: "Mun",
            parentIndex: 0,
            radius: 200_000,
            gravParameter: 6.5138398e10,
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

    const mun = result.current[1];
    expect(mun.referenceBody).toBe("Kerbin");
    expect(mun.semiMajorAxis).toBe(12_000_000);
    // One absent field two entries away removes the live true anomaly, which makes `usePhaseAngles` skip the body.
    expect(mun.period).toBeNull();
    expect(mun.trueAnomaly).toBeNull();
    expect(mun.hillSphere).toBeNull();
  });
});
