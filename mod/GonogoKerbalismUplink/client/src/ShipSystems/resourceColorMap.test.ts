import { renderHook } from "@ksp-gonogo/test-utils";
import { resourceColor } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { useResourceColorMap } from "./resourceColorMap";

describe("useResourceColorMap", () => {
  it("maps every name to the same colour ui-kit's resourceColor would give it directly", () => {
    const { result } = renderHook(() =>
      useResourceColorMap(["Water", "ElectricCharge", "LiquidFuel"]),
    );
    expect(result.current.get("Water")).toBe(resourceColor("Water"));
    expect(result.current.get("ElectricCharge")).toBe(
      resourceColor("ElectricCharge"),
    );
    expect(result.current.get("LiquidFuel")).toBe(resourceColor("LiquidFuel"));
  });

  it("returns an empty map for an empty resource list", () => {
    const { result } = renderHook(() => useResourceColorMap([]));
    expect(result.current.size).toBe(0);
  });

  it("dedupes repeated names in the input", () => {
    const { result } = renderHook(() =>
      useResourceColorMap(["Water", "Water", "Oxygen"]),
    );
    expect(result.current.size).toBe(2);
  });

  it("gives an unrecognised (uplink-custom) resource a stable colour too", () => {
    const { result } = renderHook(() => useResourceColorMap(["ExoticGoo"]));
    expect(result.current.get("ExoticGoo")).toBe(resourceColor("ExoticGoo"));
  });

  it("stays referentially stable across a re-render with the same resource SET, even from a fresh array", () => {
    const { result, rerender } = renderHook(
      ({ names }: { names: readonly string[] }) => useResourceColorMap(names),
      { initialProps: { names: ["Water", "Oxygen"] } },
    );
    const first = result.current;
    // A brand new array reference, same members: the whole point of the
    // memoisation is that this does NOT force a fresh map.
    rerender({ names: ["Water", "Oxygen"] });
    expect(result.current).toBe(first);
  });

  it("recomputes once the resource SET actually changes", () => {
    const { result, rerender } = renderHook(
      ({ names }: { names: readonly string[] }) => useResourceColorMap(names),
      { initialProps: { names: ["Water"] } },
    );
    const first = result.current;
    rerender({ names: ["Water", "Oxygen"] });
    expect(result.current).not.toBe(first);
    expect(result.current.has("Oxygen")).toBe(true);
  });
});
