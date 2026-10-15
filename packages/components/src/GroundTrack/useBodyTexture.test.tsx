import { act, renderHook } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBodyTexture } from "./useMapPainting";

class FakeImage {
  static all: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = "";
  constructor() {
    FakeImage.all.push(this);
  }
}

describe("useBodyTexture", () => {
  beforeEach(() => {
    FakeImage.all = [];
    vi.stubGlobal("Image", FakeImage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("does not install a texture that finishes loading after the body changed", () => {
    const { result, rerender } = renderHook(
      ({ texture }) => useBodyTexture(texture),
      { initialProps: { texture: "kerbin.png" } },
    );
    const [kerbin] = FakeImage.all;

    rerender({ texture: "mun.png" });
    act(() => kerbin.onload?.());

    expect(result.current.textureImageRef.current).toBeNull();
    expect(result.current.textureReady).toBe(false);

    const mun = FakeImage.all[1];
    act(() => mun.onload?.());
    expect(result.current.textureImageRef.current).toBe(mun);
    expect(result.current.textureReady).toBe(true);
  });
});
