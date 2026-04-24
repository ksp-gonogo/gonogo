import type { DataKey } from "@gonogo/core";
import {
  clearRegistry,
  MockDataSource,
  registerDataSource,
} from "@gonogo/core";
import { BufferedDataSource, MemoryStore } from "@gonogo/data";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useCelestialBodies } from "./useCelestialBodies";

const KEYS: DataKey[] = [
  { key: "b.number" },
  { key: "b.name[0]" },
  { key: "b.name[1]" },
  { key: "b.name[2]" },
  { key: "b.referenceBody[0]" },
  { key: "b.referenceBody[1]" },
  { key: "b.referenceBody[2]" },
  { key: "b.radius[0]" },
  { key: "b.radius[1]" },
  { key: "b.radius[2]" },
  { key: "b.o.sma[0]" },
  { key: "b.o.sma[1]" },
  { key: "b.o.sma[2]" },
  { key: "b.o.eccentricity[0]" },
  { key: "b.o.eccentricity[1]" },
  { key: "b.o.eccentricity[2]" },
];

describe("useCelestialBodies", () => {
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

  it("returns an empty array while b.number is unknown", () => {
    const { result } = renderHook(() => useCelestialBodies());
    expect(result.current).toEqual([]);
  });

  it("stitches per-body fields once they stream in", async () => {
    const { result } = renderHook(() => useCelestialBodies());
    act(() => {
      source.emit("b.number", 2);
    });
    act(() => {
      source.emit("b.name[0]", "Kerbol");
      source.emit("b.name[1]", "Kerbin");
      source.emit("b.referenceBody[1]", "Kerbol");
      source.emit("b.radius[0]", 261_600_000);
      source.emit("b.radius[1]", 600_000);
      source.emit("b.o.sma[1]", 13_599_840_256);
      source.emit("b.o.eccentricity[1]", 0);
    });

    expect(result.current).toHaveLength(2);
    const kerbol = result.current[0];
    expect(kerbol.name).toBe("Kerbol");
    expect(kerbol.radius).toBe(261_600_000);
    const kerbin = result.current[1];
    expect(kerbin.name).toBe("Kerbin");
    expect(kerbin.referenceBody).toBe("Kerbol");
    expect(kerbin.semiMajorAxis).toBe(13_599_840_256);
  });

  it("resets when b.number shrinks — no stale body records lingering", async () => {
    const { result } = renderHook(() => useCelestialBodies());
    act(() => {
      source.emit("b.number", 3);
      source.emit("b.name[0]", "A");
      source.emit("b.name[1]", "B");
      source.emit("b.name[2]", "C");
    });
    expect(result.current).toHaveLength(3);

    act(() => {
      source.emit("b.number", 1);
    });
    // Only the first body survives; nothing else clings on.
    expect(result.current).toHaveLength(1);
  });
});
