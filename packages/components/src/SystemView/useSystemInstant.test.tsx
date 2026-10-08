import {
  deriveTrueAnomalyDeg,
  poseAtIndex,
  useSystemInstant,
} from "@ksp-gonogo/sitrep-client";
import { act, renderHook, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";

/** `useSystemInstant` places the catalogue's bodies through a real `TelemetryProvider`, and says how each placement is known. */

const KERBOL_MU = 1.1723328e18;
const KERBIN_SMA = 13_599_840_256;
const KERBIN_ECC = 0.3;
const HORIZON_UT = 500;
const VIEW_UT = 2_000;

const UNTIL = 2;
const INTEGRATED = 2;

function catalogue(horizon?: Record<string, unknown>) {
  return {
    bodies: [
      {
        index: 0,
        name: "Kerbol",
        parentIndex: null,
        radius: 261_600_000,
        gravParameter: KERBOL_MU,
        orbit: null,
      },
      {
        index: 1,
        name: "Kerbin",
        parentIndex: 0,
        radius: 600_000,
        gravParameter: 3.5316e12,
        orbit: {
          sma: KERBIN_SMA,
          ecc: KERBIN_ECC,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 1,
          epoch: 0,
        },
        horizon,
      },
    ],
  };
}

function anomalyAt(ut: number): number | null {
  return deriveTrueAnomalyDeg({
    semiMajorAxis: KERBIN_SMA,
    eccentricity: KERBIN_ECC,
    meanAnomalyAtEpoch: 1,
    epoch: 0,
    parentGravParameter: KERBOL_MU,
    ut,
  });
}

function renderInstant() {
  const fixture = setupStreamFixture({
    pinnedUt: VIEW_UT,
    suspendFrames: true,
  });
  const { result } = renderHook(() => useSystemInstant(), {
    wrapper: fixture.Provider,
  });
  return { fixture, result };
}

describe("useSystemInstant", () => {
  it("answers nothing before the catalogue arrives", () => {
    const { result } = renderInstant();
    expect(poseAtIndex(result.current, 1)).toBeNull();
  });

  it("holds a body past its horizon at the instant its provider last vouched for", async () => {
    const { fixture, result } = renderInstant();
    act(() => {
      fixture.emit(
        "system.bodies",
        catalogue({
          kind: UNTIL,
          trajectoryKind: INTEGRATED,
          untilUt: HORIZON_UT,
        }),
      );
    });
    await waitFor(() => expect(poseAtIndex(result.current, 1)).not.toBeNull());
    const pose = poseAtIndex(result.current, 1);
    expect(pose?.currency).toBe("held");
    expect(pose?.asOfUt).toBe(HORIZON_UT);
    expect(pose?.atUt).toBe(HORIZON_UT);
    expect(pose?.untilUt).toBe(HORIZON_UT);
    expect(pose?.trueAnomaly).toBeCloseTo(
      anomalyAt(HORIZON_UT) ?? Number.NaN,
      6,
    );
    expect(pose?.trueAnomaly).not.toBeCloseTo(
      anomalyAt(VIEW_UT) ?? Number.NaN,
      1,
    );
    await act(async () => {});
  });

  it("models a body inside its horizon, at the instant on screen", async () => {
    const { fixture, result } = renderInstant();
    act(() => {
      fixture.emit(
        "system.bodies",
        catalogue({
          kind: UNTIL,
          trajectoryKind: INTEGRATED,
          untilUt: VIEW_UT + 100,
        }),
      );
    });
    await waitFor(() => expect(poseAtIndex(result.current, 1)).not.toBeNull());
    const pose = poseAtIndex(result.current, 1);
    expect(pose?.currency).toBe("modelled");
    expect(pose?.atUt).toBe(VIEW_UT);
    expect(pose?.trueAnomaly).toBeCloseTo(anomalyAt(VIEW_UT) ?? Number.NaN, 6);
    await act(async () => {});
  });

  it("holds a modelled body at the catalogue's age once the catalogue stops arriving", async () => {
    const { fixture, result } = renderInstant();
    act(() => {
      fixture.emit(
        "system.bodies",
        catalogue({
          kind: UNTIL,
          trajectoryKind: INTEGRATED,
          untilUt: VIEW_UT + 100,
        }),
        { validAt: 300 },
      );
    });
    await waitFor(() =>
      expect(poseAtIndex(result.current, 1)?.currency).toBe("modelled"),
    );
    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });
    const pose = poseAtIndex(result.current, 1);
    expect(pose?.currency).toBe("held");
    expect(pose?.atUt).toBeLessThan(VIEW_UT);
    expect(pose?.asOfUt).toBe(pose?.atUt);
    expect(pose?.trueAnomaly).toBeCloseTo(
      anomalyAt(pose?.atUt ?? Number.NaN) ?? Number.NaN,
      6,
    );
    await act(async () => {});
  });

  it("keeps a body on a fixed orbit exact however old the catalogue is", async () => {
    const { fixture, result } = renderInstant();
    act(() => {
      fixture.emit("system.bodies", catalogue(), { validAt: 300 });
    });
    await waitFor(() =>
      expect(poseAtIndex(result.current, 1)?.currency).toBe("exact"),
    );
    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });
    const pose = poseAtIndex(result.current, 1);
    expect(pose?.currency).toBe("exact");
    expect(pose?.atUt).toBe(VIEW_UT);
    await act(async () => {});
  });
});
