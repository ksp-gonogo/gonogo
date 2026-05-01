import type { DataKey } from "@gonogo/core";
import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@gonogo/core";
import { BufferedDataSource, MemoryStore } from "@gonogo/data";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CelestialBody } from "./useCelestialBodies";
import { usePhaseAngles } from "./usePhaseAngles";

const KEYS: DataKey[] = [
  { key: "b.o.phaseAngle[0]" },
  { key: "b.o.phaseAngle[1]" },
  { key: "b.o.phaseAngle[2]" },
];

const MUN: CelestialBody = makeBody(0, "Mun");
const MINMUS: CelestialBody = makeBody(1, "Minmus");
const DUNA: CelestialBody = makeBody(2, "Duna");

function makeBody(index: number, name: string): CelestialBody {
  return {
    index,
    name,
    referenceBody: null,
    radius: null,
    soi: null,
    hasAtmosphere: null,
    maxAtmosphere: null,
    semiMajorAxis: null,
    eccentricity: null,
    inclination: null,
    period: null,
    lan: null,
    argumentOfPeriapsis: null,
    trueAnomaly: null,
    mass: null,
    geeASL: null,
    rotationPeriod: null,
    tidallyLocked: null,
    hasOxygen: null,
    hasOcean: null,
  };
}

describe("usePhaseAngles", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;

  beforeEach(async () => {
    clearRegistry();
    source = new MockDataSource({ keys: KEYS });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
  });

  afterEach(() => {
    cleanup();
    buffered.disconnect();
  });

  it("starts empty and populates as samples arrive", () => {
    const { result } = renderHook(() => usePhaseAngles([MUN, MINMUS]));
    expect(result.current.size).toBe(0);

    act(() => {
      source.emit("b.o.phaseAngle[0]", 12.5);
    });
    expect(result.current.get(0)).toBe(12.5);

    act(() => {
      source.emit("b.o.phaseAngle[1]", 47.2);
    });
    expect(result.current.get(1)).toBe(47.2);
  });

  it("rebuilds the subscription set when the body list changes", () => {
    const { result, rerender } = renderHook(
      ({ bodies }: { bodies: CelestialBody[] }) => usePhaseAngles(bodies),
      { initialProps: { bodies: [MUN, MINMUS] } },
    );
    act(() => {
      source.emit("b.o.phaseAngle[0]", 10);
      source.emit("b.o.phaseAngle[1]", 20);
    });
    expect(result.current.size).toBe(2);

    rerender({ bodies: [DUNA] });
    // Switching frame resets the cache so leftover values from the
    // previous frame don't bleed into the new one.
    expect(result.current.size).toBe(0);

    act(() => {
      source.emit("b.o.phaseAngle[2]", 99);
    });
    expect(result.current.get(2)).toBe(99);
  });

  it("ignores non-numeric / non-finite samples", () => {
    const { result } = renderHook(() => usePhaseAngles([MUN]));
    act(() => {
      source.emit("b.o.phaseAngle[0]", null);
      source.emit("b.o.phaseAngle[0]", Number.NaN);
      source.emit("b.o.phaseAngle[0]", "12");
    });
    expect(result.current.size).toBe(0);
  });
});
