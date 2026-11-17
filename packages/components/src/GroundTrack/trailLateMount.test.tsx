import { act, render, renderHook } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { emitAt, KERBIN, MUN } from "../test/bodyEmits";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { useMapTelemetry } from "./useMapTelemetry";
import { useTrajectoryBuffer } from "./useTrajectoryBuffer";

const FLOWN = 40;

/** Wires the buffer to the stream the way the widget does. */
function useWidgetTrail(trajectoryLength: number) {
  const telemetry = useMapTelemetry(undefined);
  return useTrajectoryBuffer({
    lat: telemetry.lat?.magnitude,
    lon: telemetry.lon?.magnitude,
    altSea: telemetry.altSea,
    q: telemetry.q,
    mach: telemetry.mach,
    speed: telemetry.speed,
    vSpeed: telemetry.vSpeed,
    trajectoryLength,
    track: `${telemetry.vesselId ?? ""} over ${telemetry.targetBodyId ?? ""}`,
  });
}

function flightPayload(i: number) {
  return {
    latitude: 0,
    longitude: -70 + i,
    altitudeAsl: 1000 + i,
    dynamicPressureKPa: 0,
    mach: 0,
    surfaceSpeed: 100,
    verticalSpeed: 10,
  };
}

/** A craft that has flown `count` seconds on the stream before any map is mounted. */
function flownFor(count: number, onBody = KERBIN, firstSecond = 1) {
  const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
  // The page's own provider is up and subscribed before any map mounts.
  render(<fixture.Provider>{null}</fixture.Provider>);
  fixture.client.subscribe("vessel.flight", () => {});
  fixture.client.subscribe("vessel.identity", () => {});
  fixture.client.subscribe("trackingStation.bodies", () => {});
  act(() => {
    emitAt(fixture, onBody);
    for (let i = firstSecond; i <= count; i++) {
      fixture.emit("vessel.flight", flightPayload(i), {
        validAt: i,
        deliveredAt: i * 1000,
      });
    }
    fixture.scrubTo(count);
  });
  return fixture;
}

describe("the flown trail on a map mounted after the craft took off", () => {
  it("draws the positions the stream already held", () => {
    const fixture = flownFor(FLOWN);

    const { result } = renderHook(() => useWidgetTrail(2000), {
      wrapper: fixture.Provider,
    });

    expect(result.current.trajectoryRef.current.map((p) => p.lon)).toEqual(
      Array.from({ length: FLOWN }, (_, i) => -70 + i + 1),
    );
  });

  it("keeps the newest positions when the trail length is shorter than the history", () => {
    const fixture = flownFor(FLOWN);

    const { result } = renderHook(() => useWidgetTrail(10), {
      wrapper: fixture.Provider,
    });

    expect(result.current.trajectoryRef.current.map((p) => p.lon)).toEqual(
      Array.from({ length: 10 }, (_, i) => -70 + FLOWN - 9 + i),
    );
  });

  it("appends live positions after the history", () => {
    const fixture = flownFor(FLOWN);
    const { result } = renderHook(() => useWidgetTrail(2000), {
      wrapper: fixture.Provider,
    });

    act(() => {
      fixture.emit("vessel.flight", flightPayload(FLOWN + 1), {
        validAt: FLOWN + 1,
        deliveredAt: (FLOWN + 1) * 1000,
      });
      fixture.scrubTo(FLOWN + 1);
    });

    const lons = result.current.trajectoryRef.current.map((p) => p.lon);
    expect(lons).toHaveLength(FLOWN + 1);
    expect(lons.at(-1)).toBe(-70 + FLOWN + 1);
  });

  it("carries nothing across a change of sphere of influence", () => {
    const fixture = flownFor(20, KERBIN);
    act(() => {
      emitAt(fixture, MUN, [KERBIN, MUN], 21);
      for (let i = 21; i <= FLOWN; i++) {
        fixture.emit("vessel.flight", flightPayload(i), {
          validAt: i,
          deliveredAt: i * 1000,
        });
      }
      fixture.scrubTo(FLOWN);
    });

    const { result } = renderHook(() => useWidgetTrail(2000), {
      wrapper: fixture.Provider,
    });

    const lons = result.current.trajectoryRef.current.map((p) => p.lon);
    expect(lons.at(0)).toBeGreaterThan(-70 + 20);
    expect(lons.at(-1)).toBe(-70 + FLOWN);
  });

  it("extends the trail with the older positions a station's history source answers", async () => {
    const main = flownFor(FLOWN);
    const station = flownFor(FLOWN, KERBIN, 31);
    station.store.setHistorySource({
      request: async (topic, fromUt, toUt) =>
        main.store.sampleRange(topic, fromUt, toUt) ?? [],
    });

    const { result } = renderHook(() => useWidgetTrail(2000), {
      wrapper: station.Provider,
    });
    expect(result.current.trajectoryRef.current).toHaveLength(10);

    await act(async () => {
      await Promise.resolve();
      station.emitFrame();
    });

    expect(result.current.trajectoryRef.current.map((p) => p.lon)).toEqual(
      Array.from({ length: FLOWN }, (_, i) => -70 + i + 1),
    );
  });
});
