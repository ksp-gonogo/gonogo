import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { clearRegistry, registerDataSource } from "../registry";
import { MockDataSource } from "../testing/MockDataSource";
import { useOrbitElements } from "./useOrbitElements";

let source: MockDataSource;

// `clearRegistry()` here (not in an afterEach) resets registry state ahead of
// each test; RTL auto-cleanup unmounts the previous render before it runs, so
// no source teardown fires a status callback into a still-mounted component.
beforeEach(async () => {
  clearRegistry();
  source = new MockDataSource({ id: "data", name: "Data" });
  registerDataSource(source);
  await source.connect();
});

describe("useOrbitElements", () => {
  it("returns all-undefined fields before any value is emitted", () => {
    const { result } = renderHook(() => useOrbitElements());

    expect(result.current).toEqual({
      apoapsisRadius: undefined,
      periapsisRadius: undefined,
      apoapsisAltitude: undefined,
      periapsisAltitude: undefined,
      timeToApoapsis: undefined,
      timeToPeriapsis: undefined,
    });
  });

  it("surfaces emitted values for every key", () => {
    const { result } = renderHook(() => useOrbitElements());

    act(() => {
      source.emit("o.ApR", 700_000);
      source.emit("o.PeR", 680_000);
      source.emit("o.ApA", 100_000);
      source.emit("o.PeA", 80_000);
      source.emit("o.timeToAp", 120);
      source.emit("o.timeToPe", 1_500);
    });

    expect(result.current).toEqual({
      apoapsisRadius: 700_000,
      periapsisRadius: 680_000,
      apoapsisAltitude: 100_000,
      periapsisAltitude: 80_000,
      timeToApoapsis: 120,
      timeToPeriapsis: 1_500,
    });
  });

  it("propagates updates as new values arrive", () => {
    const { result } = renderHook(() => useOrbitElements());

    act(() => {
      source.emit("o.ApA", 100_000);
      source.emit("o.PeA", 80_000);
    });

    expect(result.current.apoapsisAltitude).toBe(100_000);
    expect(result.current.periapsisAltitude).toBe(80_000);

    act(() => {
      source.emit("o.ApA", 250_000);
      source.emit("o.timeToAp", 300);
    });

    expect(result.current.apoapsisAltitude).toBe(250_000);
    expect(result.current.periapsisAltitude).toBe(80_000);
    expect(result.current.timeToApoapsis).toBe(300);
  });

  it("supports a custom data source id", () => {
    const other = new MockDataSource({ id: "other", name: "Other" });
    registerDataSource(other);

    const { result } = renderHook(() => useOrbitElements("other"));

    act(() => {
      other.emit("o.ApR", 999);
    });

    expect(result.current.apoapsisRadius).toBe(999);
  });

  it("clears all fields to undefined when the source leaves connected", () => {
    const { result } = renderHook(() => useOrbitElements());

    act(() => {
      source.emit("o.ApR", 700_000);
      source.emit("o.PeR", 680_000);
      source.emit("o.timeToAp", 120);
    });

    expect(result.current.apoapsisRadius).toBe(700_000);

    act(() => {
      source.setStatus("disconnected");
    });

    expect(result.current).toEqual({
      apoapsisRadius: undefined,
      periapsisRadius: undefined,
      apoapsisAltitude: undefined,
      periapsisAltitude: undefined,
      timeToApoapsis: undefined,
      timeToPeriapsis: undefined,
    });
  });
});
