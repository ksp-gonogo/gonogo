import { describe, expect, it } from "vitest";
import { baseSurfacePainted, paintBaseSurface } from "./paintBaseSurface";

// Suppression withholds the real texture and never the sketch: a suppressing layer's data composites over the sketch however much it has drawn.

const SKETCH = namedSource("sketch");

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
  return { id, canvas: namedSource(id) };
}

const STOCK = namedSource("stock");

/** A drawable stand-in the assertions can tell apart by name; the fake context records `drawImage` rather than drawing. */
function namedSource(id: string): CanvasImageSource {
  return { __id: id } as unknown as CanvasImageSource;
}

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

  it("paints the sketch at its own brightness in place of the stock texture", () => {
    const ctx = fakeCtx();
    paintBaseSurface(ctx as never, {
      textureImage: STOCK,
      sketch: SKETCH,
      bodyColor: undefined,
      suppressVanilla: false,
      layers: [],
      worldW: 100,
      worldH: 50,
    });
    expect(ctx.calls).toEqual(["drawImage sketch"]);
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

  it("paints nothing when suppression is on, there is no sketch and no layer, never falling back to the stock texture", () => {
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

// A suppressed and empty map with a stock texture loaded is not painted, so it takes the dark grid.
describe("paintBaseSurface under a suppressing base layer", () => {
  const under = (layers: ReturnType<typeof layer>[]) => {
    const ctx = fakeCtx();
    paintBaseSurface(ctx as never, {
      textureImage: STOCK,
      sketch: SKETCH,
      bodyColor: "#ff0000",
      suppressVanilla: true,
      layers,
      worldW: 100,
      worldH: 50,
    });
    return ctx.calls;
  };

  it("live with no data (locked scanner): the sketch alone, never the stock texture", () => {
    expect(under([])).toEqual(["drawImage sketch"]);
  });

  it("part scanned: the layer's data composites over the sketch", () => {
    expect(under([layer("partial")])).toEqual([
      "drawImage sketch",
      "drawImage partial",
    ]);
  });

  it("fully scanned: the layer's data composites over the sketch, still no stock texture", () => {
    expect(under([layer("full")])).toEqual([
      "drawImage sketch",
      "drawImage full",
    ]);
  });

  it("layer switched off by the operator: the sketch alone", () => {
    expect(under([])).toEqual(["drawImage sketch"]);
  });

  it("no suppressing layer on a visited body: the stock texture, dimmed, unchanged", () => {
    const ctx = fakeCtx();
    paintBaseSurface(ctx as never, {
      textureImage: STOCK,
      sketch: null,
      bodyColor: undefined,
      suppressVanilla: false,
      layers: [],
      worldW: 100,
      worldH: 50,
    });
    expect(ctx.calls).toEqual(["drawImage stock", "fillRect 0,0,100,50"]);
  });
});

describe("baseSurfacePainted", () => {
  it("true when suppressed with the sketch as the base and no layer", () => {
    expect(
      baseSurfacePainted({
        textureImage: STOCK,
        sketch: SKETCH,
        bodyColor: undefined,
        suppressVanilla: true,
        layers: [],
      }),
    ).toBe(true);
  });

  it("true when the stock texture paints (no suppression)", () => {
    expect(
      baseSurfacePainted({
        textureImage: STOCK,
        bodyColor: undefined,
        suppressVanilla: false,
        layers: [],
      }),
    ).toBe(true);
  });

  it("true when a body-colour wash paints (no suppression, no texture)", () => {
    expect(
      baseSurfacePainted({
        textureImage: null,
        bodyColor: "#334455",
        suppressVanilla: false,
        layers: [],
      }),
    ).toBe(true);
  });

  it("FALSE when vanilla is suppressed and no layer contributes, even with a stock texture loaded", () => {
    expect(
      baseSurfacePainted({
        textureImage: STOCK,
        bodyColor: "#334455",
        suppressVanilla: true,
        layers: [],
      }),
    ).toBe(false);
  });

  it("true when suppressed but a layer contributes a canvas", () => {
    expect(
      baseSurfacePainted({
        textureImage: null,
        bodyColor: undefined,
        suppressVanilla: true,
        layers: [layer("only")],
      }),
    ).toBe(true);
  });

  it("false on a bare canvas: no texture, no colour, no layers, no suppression", () => {
    expect(
      baseSurfacePainted({
        textureImage: null,
        bodyColor: undefined,
        suppressVanilla: false,
        layers: [],
      }),
    ).toBe(false);
  });
});
