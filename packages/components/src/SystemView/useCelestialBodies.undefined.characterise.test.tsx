import { act, renderHook, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { useCelestialBodies } from "./useCelestialBodies";

/**
 * CHARACTERISATION of what `undefined` MEANS to `useCelestialBodies` today, so
 * the `Reading<T>` migration can be checked against recorded behaviour rather
 * than against intent.
 *
 * The hook has exactly one telemetry read, `useTelemetry("system.bodies")`, and
 * funnels every absence through one expression:
 *
 *     const wire = systemBodies?.bodies;
 *     if (!wire || wire.length === 0) return [];
 *
 * Three unrelated situations collapse into that single empty array: nothing has
 * arrived, a record arrived without a `bodies` field, and a record arrived
 * carrying an empty roster. A `Reading` is always truthy, so the optional chain
 * and the `!wire` gate both stop gating on migration, and the tests below are
 * what says so.
 */

const KERBIN_MU = 3.5316e12;

function renderBodies(opts: { pinnedUt?: number } = { pinnedUt: 0 }) {
  const fixture = setupStreamFixture({
    carriedChannels: ["system.bodies"],
    pinnedUt: opts.pinnedUt,
  });
  const { result, rerender } = renderHook(() => useCelestialBodies(), {
    wrapper: fixture.Provider,
  });
  return { fixture, result, rerender };
}

describe("useCelestialBodies: what undefined means today", () => {
  // ── 1. Nothing has arrived at all ────────────────────────────────────────

  it("answers a stable empty roster before any system.bodies sample, never a hole", () => {
    const { result, rerender } = renderBodies();

    // Specifically an empty ARRAY, not undefined: every consumer maps over it
    // unguarded (`bodies.filter`, `bodies.find`), so the never-arrived case is
    // already spelt as "the system has no bodies in it".
    expect(Array.isArray(result.current)).toBe(true);
    expect(result.current).toHaveLength(0);

    // Identity is held across a re-render while data-less, which is what stops
    // a memoising consumer churning. `SystemView`'s `children` memo depends on
    // this array, so a fresh `[]` each render would recompute the whole
    // diagram input every frame.
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  // ── 2. The absence gate, proved to fire ──────────────────────────────────

  it("fires the `!wire` gate for a record whose bodies field never arrived", async () => {
    const { fixture, result } = renderBodies();
    // A whole record present with the array field missing: `systemBodies?.bodies`
    // is undefined and the gate short-circuits. Post-migration the record is
    // reached through a Reading arm, so this gate has to be rewritten or the
    // hole reaches `wire.map`.
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

    // `wire.length === 0` and `!wire` reach the same `return []`, so "the game
    // reports no bodies" and "we have heard nothing" are one state to every
    // consumer. This is the pair the `pending`/`absent`/`observed` split exists
    // to separate.
    await waitFor(() => expect(result.current).toHaveLength(0));
    expect(result.current).toEqual(beforeAnySample);
  });

  // ── 3. null versus undefined ─────────────────────────────────────────────

  it("treats a null system.bodies payload as not-arrived-yet, not as a confirmed absence", async () => {
    // View time ahead of both samples so the tombstone is the one sampled.
    const { fixture, result } = renderBodies({ pinnedUt: 10 });
    act(() => {
      fixture.emit("system.bodies", { bodies: [{ index: 0, name: "Kerbin" }] });
    });
    await waitFor(() => expect(result.current).toHaveLength(1));

    // `useTelemetry` returns the point's payload verbatim, so a tombstone
    // surfaces as `null` rather than `undefined`. This hook does NOT
    // distinguish: `null?.bodies` is undefined and the same `!wire` gate fires,
    // so a subject confirming it has no bodies renders identically to a cold
    // topic. It never reads the tombstone's own age either, so it cannot say
    // "confirmed, 3 s ago".
    act(() => {
      fixture.emit("system.bodies", null, { validAt: 5, seq: 1 });
    });
    await waitFor(() => expect(result.current).toHaveLength(0));
  });

  // ── 4. A partial payload: the record arrived, a field inside did not ─────

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
    // `hasAtmosphere: atmosphere !== null` turns a missing field into `false`,
    // which AlmanacPanel renders as the row "No atmosphere" (its
    // `hasAtmosphere === false` branch). Every other unknown on this record is
    // spelt `null` and renders nothing at all, so this one field alone reports
    // an unarrived value as a fact.
    expect(kerbin.atmosphere).toBeNull();
    expect(kerbin.hasAtmosphere).toBe(false);
    // The two mirrors of the same missing field stay honestly unknown, so the
    // record is internally inconsistent about what absence means.
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
    // `entry.orbit ?? null` covers the field being absent as well as null, and
    // every element then reads null, so a root star and a body mid-resync are
    // the same record. Nothing downstream can tell them apart.
    expect(root.semiMajorAxis).toBeNull();
    expect(root.eccentricity).toBeNull();
    expect(root.lan).toBeNull();
    expect(root.argumentOfPeriapsis).toBeNull();
    expect(root.meanAnomalyAtEpoch).toBeNull();
    expect(root.epoch).toBeNull();
    // Derivations decline rather than coercing to zero, which is why
    // `usePhaseAngles` can skip the body instead of plotting it at longitude 0.
    expect(root.period).toBeNull();
    expect(root.trueAnomaly).toBeNull();
    // Carried, not derived: a wire that did not send it reads null, which is
    // also what KSP's own PositiveInfinity for the root star becomes.
    expect(root.hillSphere).toBeNull();
    expect(root.mass).toBeNull();
    // The one property that only needs mu + radius still resolves, so a partial
    // record is partially populated rather than dropped.
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
    // A body reduced to its index and name still enters the list: the roster is
    // non-empty and every readout on it is a null placeholder. Absence lives
    // per-field here, never as an absent body.
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
          // Parent present but with no gravParameter: the child's orbit is
          // complete and still cannot be turned into a period or an anomaly.
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
    // One absent field two entries away silently removes the live true anomaly,
    // and a null `trueAnomaly` is exactly what makes `usePhaseAngles` skip the
    // body: an absence that propagates into another hook's gate.
    expect(mun.period).toBeNull();
    expect(mun.trueAnomaly).toBeNull();
    expect(mun.hillSphere).toBeNull();
  });
});
