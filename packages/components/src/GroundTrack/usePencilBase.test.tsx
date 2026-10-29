import { renderHook } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { baseIsSketch, usePencilBase } from "./usePencilBase";

describe("usePencilBase", () => {
  it("has no sketch without a texture", () => {
    const { result } = renderHook(() => usePencilBase(null, undefined, 1, 800));
    expect(result.current).toBeNull();
  });

  it("hands the texture back to the caller where the platform cannot draw a sketch", () => {
    // jsdom has no 2D canvas, which is the same failure a tainted cross-origin texture raises.
    const texture = document.createElement("img");
    const { result } = renderHook(() =>
      usePencilBase(texture, "bodies/Duna_Color.png", 0.3, 800),
    );
    expect(result.current).toBeNull();
  });
});

describe("baseIsSketch", () => {
  it("draws the body's texture for a visited stock body", () => {
    expect(baseIsSketch(true, false)).toBe(false);
  });

  it("draws the sketch for a body the save has never reached", () => {
    expect(baseIsSketch(false, false)).toBe(true);
  });

  it("keeps the sketch as the base wherever a base layer is active, visited or not", () => {
    expect(baseIsSketch(true, true)).toBe(true);
    expect(baseIsSketch(false, true)).toBe(true);
    expect(baseIsSketch(undefined, true)).toBe(true);
  });

  it("draws the texture while the visit state has not arrived", () => {
    expect(baseIsSketch(undefined, false)).toBe(false);
  });
});
