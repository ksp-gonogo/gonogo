import { act, renderHook } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBodyTexture } from "./useMapPainting";

class FakeImage {
  static all: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  /** Settles inside the `src` assignment, as a cached image can before React commits. */
  static settlesAtOnce = false;
  #src = "";
  get src() {
    return this.#src;
  }
  set src(value: string) {
    this.#src = value;
    if (FakeImage.settlesAtOnce) this.onload?.();
  }
  constructor() {
    FakeImage.all.push(this);
  }
}

describe("useBodyTexture", () => {
  beforeEach(() => {
    FakeImage.all = [];
    FakeImage.settlesAtOnce = false;
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

    expect(result.current.textureImage).toBeNull();
    expect(result.current.textureReady).toBe(false);

    const mun = FakeImage.all[1];
    act(() => mun.onload?.());
    expect(result.current.textureImage).toBe(mun);
    expect(result.current.textureReady).toBe(true);
  });

  it("paints a texture that loads before the body's own render commits", () => {
    const { result, rerender } = renderHook(
      ({ texture }) => useBodyTexture(texture),
      { initialProps: { texture: undefined as string | undefined } },
    );
    expect(result.current.textureReady).toBe(true);

    FakeImage.settlesAtOnce = true;
    rerender({ texture: "kerbin.png" });

    expect(result.current.textureImage).toBe(FakeImage.all[0]);
    expect(result.current.textureReady).toBe(true);
  });
});
