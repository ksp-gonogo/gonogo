import { act, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import {
  KERBIN_MU,
  renderPhaseAngles,
  systemBodies,
  vesselAtLongitude,
} from "../test/phaseAngleRig";
import { setupStreamFixture } from "../test/setupStreamFixture";

/**
 * Characterises what `undefined` means to `usePhaseAngles`: one read behind one gate, `if (!orbit) return EMPTY`.
 *
 * No vessel orbit, a hyperbolic orbit, and every body lacking elements all reach the shared `EMPTY`. A `Reading` is always truthy, so the gate stops gating on migration.
 */

const MUN_AT_90 = systemBodies([{ index: 1, name: "Mun", lan: 90 }]);

describe("usePhaseAngles: what undefined means today", () => {
  it("answers no phase angle for a fully-elemented body while vessel.orbit is absent", () => {
    const { fixture, result } = renderPhaseAngles(["Mun"]);
    act(() => {
      fixture.emit("system.bodies", MUN_AT_90);
    });

    // The gate short-circuits before the body loop, so one absent read erases every body's answer.
    expect(result.current.size).toBe(0);
    expect(result.current.has(1)).toBe(false);
    expect(result.current.get(1)).toBeUndefined();
  });

  it("hands every data-less render the same EMPTY map instance, whatever the bodies are", () => {
    const { fixture, result, rerender } = renderPhaseAngles(["Mun"]);
    act(() => {
      fixture.emit("system.bodies", MUN_AT_90);
    });
    const first = result.current;

    // `EMPTY`'s identity keeps SystemView's transfer-window memo from recomputing every frame.
    rerender({ n: ["Minmus"] });
    expect(result.current).toBe(first);
    rerender({ n: [] });
    expect(result.current).toBe(first);
  });

  it("cannot tell an absent vessel orbit from bodies that have no elements", async () => {
    const { fixture, result } = renderPhaseAngles(["Mun"]);
    act(() => {
      fixture.emit(
        "system.bodies",
        systemBodies([{ index: 1, name: "Mun", noElements: true }]),
      );
    });
    const beforeAnyOrbit = result.current;

    act(() => {
      fixture.emit("vessel.orbit", vesselAtLongitude(0));
    });

    // "Vessel missing" and "bodies missing" reach the identical value, so a consumer cannot say which it awaits.
    await waitFor(() => expect(result.current.size).toBe(0));
    expect(result.current).toBe(beforeAnyOrbit);
  });

  it("skips only the body whose elements are missing, keeping the elemented one", async () => {
    const { fixture, result } = renderPhaseAngles(["Mun", "Ike"]);
    act(() => {
      fixture.emit(
        "system.bodies",
        systemBodies([
          { index: 1, name: "Mun", lan: 90 },
          { index: 2, name: "Ike", noElements: true },
        ]),
      );
      fixture.emit("vessel.orbit", vesselAtLongitude(0));
    });

    await waitFor(() => expect(result.current.get(1)).toBeCloseTo(90, 4));
    // Absence is per body: a partly-resynced body is left out of the map, never plotted at longitude 0.
    expect(result.current.has(2)).toBe(false);
  });

  it("treats a null vessel.orbit as not-arrived-yet, not as a confirmed absence", async () => {
    // View time ahead of both samples so the tombstone is the one sampled.
    const { fixture, result } = renderPhaseAngles(
      ["Mun"],
      setupStreamFixture({ pinnedUt: 10, suspendFrames: true }),
    );
    act(() => {
      fixture.emit("system.bodies", MUN_AT_90);
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
    const { fixture, result } = renderPhaseAngles(["Mun"]);
    act(() => {
      fixture.emit("system.bodies", MUN_AT_90);
      fixture.emit("vessel.orbit", noNodeElements);
    });

    // `orbit.lan?.magnitude ?? 0` gives a confident 90 degrees, exactly what an equatorial vessel produces.
    await waitFor(() => expect(result.current.get(1)).toBeCloseTo(90, 4));

    const explicitZeroes = renderPhaseAngles(["Mun"]);
    act(() => {
      explicitZeroes.fixture.emit("system.bodies", MUN_AT_90);
      explicitZeroes.fixture.emit("vessel.orbit", vesselAtLongitude(0));
    });
    await waitFor(() =>
      expect(explicitZeroes.result.current.get(1)).toBeCloseTo(90, 4),
    );
    expect(result.current.get(1)).toBe(explicitZeroes.result.current.get(1));
  });
});
