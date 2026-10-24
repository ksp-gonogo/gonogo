import { act, renderHook } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { useLandingEssentials } from "./useLandingEssentials";

const FLIGHT = {
  latitude: 0,
  longitude: 0,
  altitudeAsl: 2869,
  altitudeTerrain: 3.48,
  verticalSpeed: 0,
  surfaceSpeed: 0,
  orbitalSpeed: 0,
  atmDensity: 0,
};

function setup() {
  const stream = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  stream.client.subscribe("vessel.flight", () => {});
  stream.client.subscribe("vessel.surface", () => {});
  const hook = renderHook(() => useLandingEssentials(), {
    wrapper: stream.Provider,
  });
  return { stream, hook };
}

const heightOf = (essentials: ReturnType<typeof useLandingEssentials>) => {
  const figure = essentials.find((e) => e.label === "Alt AGL")?.value;
  const value = figure && "state" in figure ? figure.value : figure;
  return value?.magnitude;
};

describe("the landing tile's height", () => {
  it("reads the lowest point above terrain, the height the widget itself shows, not the radar altitude of the centre of mass", () => {
    const { stream, hook } = setup();
    act(() => {
      stream.emit("vessel.flight", FLIGHT);
      stream.emit("vessel.surface", {
        biome: "Midlands",
        landedAt: null,
        heightFromTerrain: 0,
      });
    });
    expect(heightOf(hook.result.current)).toBe(0);
  });

  it("falls back to the radar altitude where the vessel has no surface reading", () => {
    const { stream, hook } = setup();
    act(() => {
      stream.emit("vessel.flight", FLIGHT);
    });
    expect(heightOf(hook.result.current)).toBe(3.48);
  });
});
