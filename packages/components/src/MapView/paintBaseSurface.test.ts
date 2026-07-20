import { describe, expect, it } from "vitest";
import { paintBaseSurface } from "./paintBaseSurface";

// The map is a BACKGROUND with everything else drawn on top. A `map-view.base`
// augment is a REPLACEMENT background, not an overlay: when one is active it
// owns the whole background. MapView must therefore skip its own stock-texture
// paint entirely, so whatever the augment leaves untouched falls through to the
// dark panel fill underneath. Painting the stock texture first and compositing
// the augment over it (the pre-fix behaviour) meant an unsurveyed region showed
// the stock texture through the augment's transparent pixels, so the background
// could never be withheld.

function fakeCtx() {
  const calls: string[] = [];
  return {
    calls,
    fillStyle: "",
    drawImage: (src: { __id?: string }) =>
      calls.push(`drawImage ${src.__id ?? "?"}`),
    fillRect: (...a: number[]) => calls.push(`fillRect ${a.join(",")}`),
  };
}

const STOCK = { __id: "stock" } as unknown as CanvasImageSource;
const AUGMENT = { __id: "augment" } as unknown as CanvasImageSource;

describe("paintBaseSurface", () => {
  it("paints the stock texture when no base augment is active", () => {
    const ctx = fakeCtx();
    paintBaseSurface(ctx as never, {
      textureImage: STOCK,
      bodyColor: "#ff0000",
      augmentCanvas: null,
      worldW: 100,
      worldH: 50,
    });
    expect(ctx.calls).toContain("drawImage stock");
    expect(ctx.calls).not.toContain("drawImage augment");
  });

  it("does NOT paint the stock texture when a base augment supplies a canvas", () => {
    const ctx = fakeCtx();
    paintBaseSurface(ctx as never, {
      textureImage: STOCK,
      bodyColor: "#ff0000",
      augmentCanvas: AUGMENT,
      worldW: 100,
      worldH: 50,
    });
    // The whole point: the replacement augment owns the base surface.
    expect(ctx.calls).not.toContain("drawImage stock");
    expect(ctx.calls).toContain("drawImage augment");
  });

  it("skips the colour-wash fallback too when a base augment is active", () => {
    const ctx = fakeCtx();
    paintBaseSurface(ctx as never, {
      textureImage: null,
      bodyColor: "#ff0000",
      augmentCanvas: AUGMENT,
      worldW: 100,
      worldH: 50,
    });
    // No fillRect for the colour wash -- only the augment is drawn.
    expect(ctx.calls).toEqual(["drawImage augment"]);
  });

  it("falls back to the body colour wash when there is no texture and no augment", () => {
    const ctx = fakeCtx();
    paintBaseSurface(ctx as never, {
      textureImage: null,
      bodyColor: "#ff0000",
      augmentCanvas: null,
      worldW: 100,
      worldH: 50,
    });
    expect(ctx.calls).toEqual(["fillRect 0,0,100,50"]);
  });

  it("paints nothing when there is no texture, no colour and no augment", () => {
    const ctx = fakeCtx();
    paintBaseSurface(ctx as never, {
      textureImage: null,
      bodyColor: undefined,
      augmentCanvas: null,
      worldW: 100,
      worldH: 50,
    });
    expect(ctx.calls).toEqual([]);
  });
});
