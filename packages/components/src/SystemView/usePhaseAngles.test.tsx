import {
  poseAtIndex,
  useSystemInstant,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, renderHook, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { integratedHorizon, UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import {
  MUN_SMA,
  renderPhaseAngles,
  systemBodies,
  vesselAtLongitude,
} from "../test/phaseAngleRig";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { normalizePhaseAngle } from "./transferWindow";
import { useCelestialBodies } from "./useCelestialBodies";
import { usePhaseAngleReading, usePhaseAngles } from "./usePhaseAngles";

/** `usePhaseAngles` derives each body's phase angle to the active vessel from the body poses and the streamed orbit, read through a real `TelemetryProvider`. */

describe("usePhaseAngles", () => {
  it("computes 90° when the body leads the vessel by a quarter turn", async () => {
    const { fixture, result } = renderPhaseAngles(["Mun"]);
    act(() => {
      fixture.emit(
        "system.bodies",
        systemBodies([{ index: 1, name: "Mun", lan: 90 }]),
      );
      fixture.emit("vessel.orbit", vesselAtLongitude(0));
    });
    await waitFor(() => expect(result.current.get(1)).toBeCloseTo(90, 4));
  });

  it("computes 180° for a body diametrically opposite the vessel", async () => {
    const { fixture, result } = renderPhaseAngles(["Mun"]);
    act(() => {
      fixture.emit(
        "system.bodies",
        systemBodies([{ index: 1, name: "Mun", anomalyDeg: 180 }]),
      );
      fixture.emit("vessel.orbit", vesselAtLongitude(0));
    });
    await waitFor(() => expect(result.current.get(1)).toBeCloseTo(180, 4));
  });

  it("wraps the seam: vessel at 350°, body at 10° → 20°", async () => {
    const { fixture, result } = renderPhaseAngles(["Mun"]);
    act(() => {
      fixture.emit(
        "system.bodies",
        systemBodies([{ index: 1, name: "Mun", lan: 10 }]),
      );
      fixture.emit("vessel.orbit", vesselAtLongitude(350));
    });
    await waitFor(() => expect(result.current.get(1)).toBeCloseTo(20, 4));
  });

  it("places a body by its node, periapsis and anomaly together", async () => {
    // body lon = 30 + 40 + 20 = 90; vessel lon = 0 → phase 90.
    const { fixture, result } = renderPhaseAngles(["Mun"]);
    act(() => {
      fixture.emit(
        "system.bodies",
        systemBodies([
          { index: 1, name: "Mun", lan: 30, argPe: 40, anomalyDeg: 20 },
        ]),
      );
      fixture.emit("vessel.orbit", vesselAtLongitude(0));
    });
    await waitFor(() => expect(result.current.get(1)).toBeCloseTo(90, 4));
  });

  it("keys every body that has full elements", async () => {
    const { fixture, result } = renderPhaseAngles(["Mun", "Minmus"]);
    act(() => {
      fixture.emit(
        "system.bodies",
        systemBodies([
          { index: 1, name: "Mun", lan: 45 },
          { index: 2, name: "Minmus", lan: 135, sma: 47_000_000 },
        ]),
      );
      fixture.emit("vessel.orbit", vesselAtLongitude(0));
    });
    await waitFor(() => expect(result.current.size).toBe(2));
    expect(result.current.get(1)).toBeCloseTo(45, 4);
    expect(result.current.get(2)).toBeCloseTo(135, 4);
  });

  it("skips a body missing orbital elements, keeps the rest", async () => {
    const { fixture, result } = renderPhaseAngles(["Mun", "Root"]);
    act(() => {
      fixture.emit(
        "system.bodies",
        systemBodies([
          { index: 1, name: "Mun", lan: 90 },
          { index: 2, name: "Root", noElements: true },
        ]),
      );
      fixture.emit("vessel.orbit", vesselAtLongitude(0));
    });
    await waitFor(() => expect(result.current.get(1)).toBeCloseTo(90, 4));
    expect(result.current.has(2)).toBe(false);
  });

  it("is empty (stable identity) until the vessel orbit arrives", () => {
    const { fixture, result, rerender } = renderPhaseAngles(["Mun"]);
    act(() => {
      fixture.emit(
        "system.bodies",
        systemBodies([{ index: 1, name: "Mun", lan: 90 }]),
      );
    });
    const first = result.current;
    expect(first.size).toBe(0);
    rerender({ n: ["Minmus"] });
    expect(result.current).toBe(first); // no consumer churn while data-less
    expect(result.current.size).toBe(0);
  });

  it("is empty for a hyperbolic vessel orbit (ecc ≥ 1, no phase reference)", async () => {
    const { fixture, result } = renderPhaseAngles(["Mun"]);
    act(() => {
      fixture.emit(
        "system.bodies",
        systemBodies([{ index: 1, name: "Mun", lan: 90 }]),
      );
      fixture.emit("vessel.orbit", {
        ...vesselAtLongitude(0),
        sma: -8_000_000,
        ecc: 1.3,
      });
    });
    // Give the stream a beat; the map must stay empty.
    await waitFor(() => expect(result.current.size).toBe(0));
  });

  it("measures an inclined body in the plane of the vessel's motion, not as a difference of longitudes", async () => {
    // The Mun sits 90 degrees on from the node on an orbit tilted 60 degrees; its longitude is 90 + atan(cos 60 * tan 90) = 90, but it stands off the vessel's plane.
    const { fixture, result } = renderPhaseAngles(["Mun"]);
    act(() => {
      fixture.emit(
        "system.bodies",
        systemBodies([{ index: 1, name: "Mun", inc: 60, anomalyDeg: 45 }]),
      );
      fixture.emit("vessel.orbit", vesselAtLongitude(0));
    });
    await waitFor(() => expect(result.current.has(1)).toBe(true));
    // In-plane bearing of a point at true anomaly 45 on a 60 degree orbit: atan2(sin45 * cos60, cos45).
    const expected =
      (Math.atan2(
        Math.sin(Math.PI / 4) * Math.cos(Math.PI / 3),
        Math.cos(Math.PI / 4),
      ) *
        180) /
      Math.PI;
    expect(result.current.get(1)).toBeCloseTo(expected, 4);
    // The old longitude difference would have said 45.
    expect(result.current.get(1)).not.toBeCloseTo(45, 1);
  });

  /** A phase angle is the elements propagated to the instant on screen, so the provider's horizon bounds it; shape is not consulted, as the last case shows. */
  describe("asks the provider before propagating to the view instant", () => {
    const mun = systemBodies([{ index: 1, name: "Mun", lan: 90 }]);

    it("is empty when no horizon was stated at all", async () => {
      const { fixture, result } = renderPhaseAngles(["Mun"]);
      act(() => {
        fixture.emit("system.bodies", mun);
        // No `horizon` at all is not a licence to extrapolate.
        const { horizon: _dropped, ...noHorizon } = vesselAtLongitude(0);
        fixture.emit("vessel.orbit", noHorizon);
      });
      await waitFor(() => expect(result.current.size).toBe(0));
    });

    it("is empty once the view instant runs past the integrator's horizon", async () => {
      const { fixture, result } = renderPhaseAngles(["Mun"]);
      act(() => {
        fixture.emit("system.bodies", mun);
        // The clock is pinned at UT 0, so a horizon at -100 is already behind it.
        fixture.emit(
          "vessel.orbit",
          vesselAtLongitude(0, integratedHorizon(-100)),
        );
      });
      await waitFor(() => expect(result.current.size).toBe(0));
    });

    it("answers for an integrating provider inside its horizon, shape or no shape", async () => {
      const { fixture, result } = renderPhaseAngles(["Mun"]);
      act(() => {
        fixture.emit("system.bodies", mun);
        fixture.emit(
          "vessel.orbit",
          vesselAtLongitude(0, integratedHorizon(5000)),
        );
      });
      await waitFor(() => expect(result.current.get(1)).toBeCloseTo(90, 4));
    });

    it("answers when reach is stated and shape is not", async () => {
      // Where the craft is does not depend on whether a conic is the right renderer for its path.
      const { fixture, result } = renderPhaseAngles(["Mun"]);
      act(() => {
        fixture.emit("system.bodies", mun);
        fixture.emit("vessel.orbit", vesselAtLongitude(0, UNBOUNDED_HORIZON));
      });
      await waitFor(() => expect(result.current.get(1)).toBeCloseTo(90, 4));
    });
  });

  describe("when the vessel's reckoner declines to carry its elements forward", () => {
    it("draws nothing at an instant later than the observation rather than advancing the elements", async () => {
      const fixture = setupStreamFixture({
        pinnedUt: 100,
        suspendFrames: true,
      });
      const { result } = renderPhaseAngles(["Mun"], fixture);
      act(() => {
        fixture.emit(
          "system.bodies",
          systemBodies([{ index: 1, name: "Mun", lan: 90 }]),
        );
        // Unbounded reach with an integrated shape is a producer the conic reckoner will not extend.
        fixture.emit(
          "vessel.orbit",
          vesselAtLongitude(0, { kind: 1, trajectoryKind: 2 }),
          { validAt: 0 },
        );
      });
      await act(async () => {});
      expect(result.current.size).toBe(0);
    });
  });

  describe("a body that is not on a fixed orbit", () => {
    const HORIZON = 500;
    const VIEW = 2_000;

    it("is left off the live map once past its horizon, and shown held with its age in the reading", async () => {
      const fixture = setupStreamFixture({
        pinnedUt: VIEW,
        suspendFrames: true,
      });
      const { result } = renderHook(
        () => {
          const poses = useSystemInstant();
          const bodies = useCelestialBodies();
          const mun = bodies.find((b) => b.name === "Mun") ?? null;
          return {
            map: usePhaseAngles(mun ? [mun] : [], poses),
            reading: usePhaseAngleReading(mun, poses, useViewUt()?.magnitude),
          };
        },
        { wrapper: fixture.Provider },
      );
      act(() => {
        fixture.emit(
          "system.bodies",
          systemBodies([{ index: 1, name: "Mun", lan: 90, untilUt: HORIZON }]),
        );
        fixture.emit("vessel.orbit", vesselAtLongitude(0), { validAt: VIEW });
      });
      await waitFor(() => expect(result.current.reading).toBeDefined());
      expect(result.current.map.has(1)).toBe(false);
      expect(result.current.reading?.state).toBe("held");
      expect(result.current.reading?.asOfUt?.magnitude).toBe(HORIZON);
      await act(async () => {});
    });
  });
});

describe("phase angles under signal delay", () => {
  const UT_NOW = 1_000;
  const MUN = systemBodies([{ index: 1, name: "Mun", lan: 90 }]);

  async function phasesAtLightTime(owlt: number) {
    const fixture = setupStreamFixture({
      delaySeconds: owlt,
      suspendFrames: true,
    });
    const { result } = renderHook(
      () => {
        const poses = useSystemInstant();
        const bodies = useCelestialBodies();
        const mun = bodies.find((b) => b.name === "Mun") ?? null;
        return {
          observed: usePhaseAngles(mun ? [mun] : [], poses),
          reading: usePhaseAngleReading(mun, poses, useViewUt()?.magnitude),
        };
      },
      { wrapper: fixture.Provider },
    );
    act(() => {
      fixture.emit("system.bodies", MUN);
      fixture.emit("vessel.orbit", vesselAtLongitude(0), {
        validAt: UT_NOW - owlt,
        deliveredAt: UT_NOW,
        quality: Quality.OnRails,
      });
      fixture.emitFrame();
    });
    await waitFor(() => expect(result.current.observed.get(1)).toBeDefined());
    return result.current;
  }

  it("measures the observation at the received edge, not at the craft's present", async () => {
    const atCraft = await phasesAtLightTime(0);
    const delayed = await phasesAtLightTime(240);
    expect(delayed.observed.get(1)).not.toBeCloseTo(
      atCraft.observed.get(1) ?? Number.NaN,
      1,
    );
    expect(delayed.reading?.value?.magnitude).toBeCloseTo(
      normalizePhaseAngle(delayed.observed.get(1) ?? Number.NaN),
      6,
    );
  });

  it("draws the craft's present only as the reckoning, with both objects placed at it", async () => {
    const atCraft = await phasesAtLightTime(0);
    const delayed = await phasesAtLightTime(240);
    const reckoning = delayed.reading?.reckoning;
    expect(reckoning?.status).toBe("available");
    if (reckoning?.status !== "available") return;
    expect(reckoning.beyondReceived).toBe(true);
    expect(reckoning.modelled.magnitude).toBeCloseTo(
      normalizePhaseAngle(atCraft.observed.get(1) ?? Number.NaN),
      4,
    );
  });

  it("does not count the catalogue against a body on a fixed orbit once it has stopped arriving", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: UT_NOW,
      suspendFrames: true,
    });
    const { result } = renderHook(
      () => {
        const poses = useSystemInstant();
        const bodies = useCelestialBodies();
        const mun = bodies.find((b) => b.name === "Mun") ?? null;
        return {
          pose: poseAtIndex(poses, 1),
          reading: usePhaseAngleReading(mun, poses, useViewUt()?.magnitude),
        };
      },
      { wrapper: fixture.Provider },
    );
    act(() => {
      fixture.emit("system.bodies", MUN, { validAt: 100 });
      fixture.emit("vessel.orbit", vesselAtLongitude(0), { validAt: UT_NOW });
    });
    await waitFor(() => expect(result.current.reading?.state).toBe("observed"));
    const before = result.current.reading?.value?.magnitude;
    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });
    // Only the vessel's own reading went held: the Mun is a fixed conic, exact at the instant on screen however old the catalogue is.
    expect(result.current.pose?.currency).toBe("exact");
    expect(result.current.reading?.value?.magnitude).toBeCloseTo(
      before ?? Number.NaN,
      9,
    );
    await act(async () => {});
  });

  it("is held as of the catalogue's instant for a body whose place is a model, once the catalogue stops arriving", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: UT_NOW,
      suspendFrames: true,
    });
    const { result } = renderHook(
      () => {
        const poses = useSystemInstant();
        const bodies = useCelestialBodies();
        const mun = bodies.find((b) => b.name === "Mun") ?? null;
        return usePhaseAngleReading(mun, poses, useViewUt()?.magnitude);
      },
      { wrapper: fixture.Provider },
    );
    act(() => {
      fixture.emit(
        "system.bodies",
        systemBodies([
          { index: 1, name: "Mun", lan: 90, untilUt: UT_NOW + 500 },
        ]),
        { validAt: 100 },
      );
      fixture.emit("vessel.orbit", vesselAtLongitude(0), { validAt: UT_NOW });
    });
    await waitFor(() => expect(result.current?.state).toBe("observed"));
    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });
    expect(result.current?.state).toBe("held");
    expect(result.current?.asOfUt?.magnitude).toBeLessThanOrEqual(UT_NOW);
    await act(async () => {});
    void MUN_SMA;
  });
});
