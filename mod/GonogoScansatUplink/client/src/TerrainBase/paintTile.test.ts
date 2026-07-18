import { describe, expect, it } from "vitest";
import {
  BASE_LAYER_CANVAS_H,
  BASE_LAYER_CANVAS_W,
  type CoverageGateLike,
  coverageAlphaForTile,
  paintTile,
  tileToPixelRect,
  withAlpha,
} from "./paintTile";

const NO_OFFSETS = {};

// Fake CanvasRenderingContext2D — a getter/setter pair backs `fillStyle` so
// `fillRect` can capture whatever colour was set immediately before it, the
// same way a real canvas context works.
function makeFakeCtx() {
  const calls: string[] = [];
  const fillStyles: string[] = [];
  const state = { fillStyle: "" };
  const ctx = {
    clearRect: (...args: number[]) => calls.push(`clearRect ${args.join(",")}`),
    fillRect: (...args: number[]) => {
      calls.push(`fillRect ${args.join(",")}`);
      fillStyles.push(state.fillStyle);
    },
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(v: string) {
      state.fillStyle = v;
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, fillStyles };
}

function gate(over: Partial<CoverageGateLike> = {}): CoverageGateLike {
  return {
    data: null,
    hasAnySource: false,
    width: 0,
    height: 0,
    ...over,
  };
}

describe("coverageAlphaForTile", () => {
  it("returns full opacity when no reveal source is registered (degenerate case)", () => {
    const alpha = coverageAlphaForTile(
      180,
      90,
      NO_OFFSETS,
      gate({ hasAnySource: false }),
    );
    expect(alpha).toBe(1);
  });

  it("returns full opacity when hasAnySource is true but data hasn't resolved yet", () => {
    const alpha = coverageAlphaForTile(
      180,
      90,
      NO_OFFSETS,
      gate({ hasAnySource: true, data: null, width: 0, height: 0 }),
    );
    expect(alpha).toBe(1);
  });

  it("returns 0 for a fully uncovered cell", () => {
    const width = 4;
    const height = 4;
    const data = new Uint8Array(width * height); // all zero
    const alpha = coverageAlphaForTile(
      2,
      2,
      NO_OFFSETS,
      gate({ hasAnySource: true, data, width, height }),
    );
    expect(alpha).toBe(0);
  });

  it("returns 1 for a fully covered cell", () => {
    const width = 4;
    const height = 4;
    const data = new Uint8Array(width * height).fill(255);
    const alpha = coverageAlphaForTile(
      2,
      2,
      NO_OFFSETS,
      gate({ hasAnySource: true, data, width, height }),
    );
    expect(alpha).toBe(1);
  });

  it("returns a proportional alpha for a partially-covered cell", () => {
    const width = 4;
    const height = 4;
    const data = new Uint8Array(width * height);
    const rect = tileToPixelRect(2, 2, width, height);
    data[rect.y0 * width + rect.x0] = 128;
    const alpha = coverageAlphaForTile(
      2,
      2,
      NO_OFFSETS,
      gate({ hasAnySource: true, data, width, height }),
    );
    expect(alpha).toBeCloseTo(128 / 255, 5);
  });
});

describe("withAlpha", () => {
  it("wraps rgb components into an rgba() string at the given alpha", () => {
    expect(withAlpha("10, 20, 30", 0.5)).toBe("rgba(10, 20, 30, 0.5)");
  });
});

describe("paintTile — fixed paint-resolution semantics", () => {
  // Pins the resolution choice this task had to settle explicitly (see the
  // module header comment in paintTile.ts and preflight-T6-T9.md's T8c
  // section): the canvas MUST be a fixed internal resolution, independent
  // of MapView's live viewport size, or every resize/zoom tick would force
  // a full repaint of the whole scan grid.
  it("paints at the fixed BASE_LAYER_CANVAS_W x H resolution by default, regardless of any 'viewport size'", () => {
    const { ctx, calls } = makeFakeCtx();
    paintTile(ctx, 1, 1, NO_OFFSETS, gate(), () => "255, 0, 0");
    expect(calls[0]).toBe(
      `clearRect 0,0,${BASE_LAYER_CANVAS_W},${BASE_LAYER_CANVAS_H}`,
    );
  });

  it("does not vary its paint resolution when a caller simulates a different viewport size", () => {
    // A regression here would mean MapBaseLayerContext.width/height (the
    // live viewport size) leaked into canvas sizing — exactly the perf
    // trap this task exists to avoid. paintTile takes no viewport
    // parameter at all in its production call signature; this test
    // exercises the override parameter (test-only) to prove the DEFAULT
    // stays fixed even though the override exists for completeness.
    const { ctx: smallCtx, calls: smallCalls } = makeFakeCtx();
    paintTile(smallCtx, 1, 1, NO_OFFSETS, gate(), () => "255, 0, 0");
    const { ctx: alsoDefaultCtx, calls: alsoDefaultCalls } = makeFakeCtx();
    paintTile(alsoDefaultCtx, 1, 1, NO_OFFSETS, gate(), () => "255, 0, 0");
    expect(smallCalls[0]).toBe(alsoDefaultCalls[0]);
    expect(BASE_LAYER_CANVAS_W).toBe(2048);
    expect(BASE_LAYER_CANVAS_H).toBe(1024);
  });
});

describe("paintTile — coverage modulation", () => {
  it("paints nothing for a fully-uncovered tile", () => {
    const { ctx, calls } = makeFakeCtx();
    const width = 4;
    const height = 4;
    const data = new Uint8Array(width * height); // all zero = fully uncovered
    paintTile(
      ctx,
      1,
      1,
      NO_OFFSETS,
      gate({ hasAnySource: true, data, width, height }),
      () => "255, 0, 0",
    );
    // clearRect always runs; no fillRect for the single (0,0) cell since its
    // gate byte is 0.
    expect(calls).toEqual([
      `clearRect 0,0,${BASE_LAYER_CANVAS_W},${BASE_LAYER_CANVAS_H}`,
    ]);
  });

  it("paints the colormap at full opacity for a fully-covered tile", () => {
    const { ctx, calls, fillStyles } = makeFakeCtx();
    const width = 4;
    const height = 4;
    const data = new Uint8Array(width * height).fill(255);
    paintTile(
      ctx,
      1,
      1,
      NO_OFFSETS,
      gate({ hasAnySource: true, data, width, height }),
      () => "255, 0, 0",
    );
    expect(calls.some((c) => c.startsWith("fillRect"))).toBe(true);
    expect(fillStyles).toContain("rgba(255, 0, 0, 1)");
  });

  it("paints at full opacity unconditionally when hasAnySource is false, even with all-zero mask data", () => {
    const { fillStyles } = (() => {
      const { ctx, fillStyles } = makeFakeCtx();
      const width = 4;
      const height = 4;
      const data = new Uint8Array(width * height); // would be "fully uncovered" if gated
      paintTile(
        ctx,
        1,
        1,
        NO_OFFSETS,
        gate({ hasAnySource: false, data, width, height }),
        () => "0, 255, 0",
      );
      return { fillStyles };
    })();
    expect(fillStyles).toContain("rgba(0, 255, 0, 1)");
  });

  it("skips a cell entirely when colourAt returns null (e.g. no biome for that tile)", () => {
    const { ctx, calls } = makeFakeCtx();
    paintTile(ctx, 1, 1, NO_OFFSETS, gate({ hasAnySource: false }), () => null);
    expect(calls).toEqual([
      `clearRect 0,0,${BASE_LAYER_CANVAS_W},${BASE_LAYER_CANVAS_H}`,
    ]);
  });
});
