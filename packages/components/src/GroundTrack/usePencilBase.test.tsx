import { renderHook } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { usePencilBase } from "./usePencilBase";

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
