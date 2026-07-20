import { describe, expect, it } from "vitest";
import { paintBaseSurface } from "./paintBaseSurface";

// The map is a BACKGROUND with everything else drawn on top. `map-view.base`
// is a STACKABLE slot (local_docs/spec-mapview-stackable-layers.md): many
// augments may draw, in order, and the stock texture is skipped only when
// `suppressVanilla` is true — a declarative decision independent of
// whether any layer currently has something to paint. "All layers off"
// while suppression is active must NOT fall back to the stock texture
// (spec §5) — it falls through to the dark panel fill already on the
// canvas, same as an individual layer's own un-painted tiles always have.

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

function layer(id: string) {
  return { id, canvas: { __id: id } as unknown as CanvasImageSource };
}

const STOCK = { __id: "stock" } as unknown as CanvasImageSource;

describe("paintBaseSurface", () => {
  it("paints the stock texture when suppression is off and there are no layers", () => {
    const ctx = fakeCtx();
    paintBaseSurface(ctx as never, {
      textureImage: STOCK,
      bodyColor: "#ff0000",
      suppressVanilla: false,
      layers: [],
      worldW: 100,
      worldH: 50,
    });
    expect(ctx.calls).toEqual(["drawImage stock", "fillRect 0,0,100,50"]);
  });

  it("draws every active layer, in the given order, on top of the stock texture when suppression is off", () => {
    const ctx = fakeCtx();
    paintBaseSurface(ctx as never, {
      textureImage: STOCK,
      bodyColor: "#ff0000",
      suppressVanilla: false,
      layers: [layer("under"), layer("over")],
      worldW: 100,
      worldH: 50,
    });
    expect(ctx.calls).toEqual([
      "drawImage stock",
      "fillRect 0,0,100,50",
      "drawImage under",
      "drawImage over",
    ]);
  });

  it("skips the stock texture entirely when suppression is on, drawing only the layers", () => {
    const ctx = fakeCtx();
    paintBaseSurface(ctx as never, {
      textureImage: STOCK,
      bodyColor: "#ff0000",
      suppressVanilla: true,
      layers: [layer("only")],
      worldW: 100,
      worldH: 50,
    });
    expect(ctx.calls).toEqual(["drawImage only"]);
  });

  it("paints nothing at all when suppression is on and every layer is currently inactive (spec: all-off is black, never a fallback to vanilla)", () => {
    const ctx = fakeCtx();
    paintBaseSurface(ctx as never, {
      textureImage: STOCK,
      bodyColor: "#ff0000",
      suppressVanilla: true,
      layers: [],
      worldW: 100,
      worldH: 50,
    });
    expect(ctx.calls).toEqual([]);
  });

  it("skips the colour-wash fallback too when suppression is on", () => {
    const ctx = fakeCtx();
    paintBaseSurface(ctx as never, {
      textureImage: null,
      bodyColor: "#ff0000",
      suppressVanilla: true,
      layers: [layer("only")],
      worldW: 100,
      worldH: 50,
    });
    expect(ctx.calls).toEqual(["drawImage only"]);
  });

  it("falls back to the body colour wash when there is no texture, suppression is off, then draws layers on top", () => {
    const ctx = fakeCtx();
    paintBaseSurface(ctx as never, {
      textureImage: null,
      bodyColor: "#ff0000",
      suppressVanilla: false,
      layers: [layer("over")],
      worldW: 100,
      worldH: 50,
    });
    expect(ctx.calls).toEqual(["fillRect 0,0,100,50", "drawImage over"]);
  });

  it("paints nothing when there is no texture, no colour, no layers and suppression is off", () => {
    const ctx = fakeCtx();
    paintBaseSurface(ctx as never, {
      textureImage: null,
      bodyColor: undefined,
      suppressVanilla: false,
      layers: [],
      worldW: 100,
      worldH: 50,
    });
    expect(ctx.calls).toEqual([]);
  });
});
