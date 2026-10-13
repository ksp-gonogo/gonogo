import { describe, expect, it } from "vitest";
import { boxAsTrace, placeCard } from "./cardPlacement";

const plot = { x0: 40, y0: 10, x1: 340, y1: 210 };
const card = { width: 80, height: 40 };

describe("placeCard", () => {
  it("takes the top right corner when nothing is there", () => {
    expect(placeCard({ plot, card, traces: [], obstacles: [] })).toEqual({
      x: 340 - 4 - 80,
      y: 14,
    });
  });

  it("moves to the next corner when a trace crosses the first", () => {
    const fallingCurve = { cx: [40, 340], cy: [16, 60] };
    expect(
      placeCard({ plot, card, traces: [fallingCurve], obstacles: [] }),
    ).toEqual({ x: 44, y: 210 - 4 - 40 });
  });

  it("treats a scatter dot as a point, not a path to the next dot", () => {
    const dots = [
      { cx: [60], cy: [30] },
      { cx: [320], cy: [200] },
    ];
    expect(placeCard({ plot, card, traces: dots, obstacles: [] })).toEqual({
      x: 256,
      y: 14,
    });
  });

  it("keeps off a box such as a legend chip", () => {
    const placed = placeCard({
      plot,
      card,
      traces: [],
      obstacles: [{ x0: 250, y0: 10, x1: 340, y1: 40 }],
    });
    expect(placed).toEqual({ x: 44, y: 166 });
  });

  it("places nothing where every corner is crossed", () => {
    const down = { cx: [40, 340], cy: [10, 210] };
    const up = { cx: [40, 340], cy: [210, 10] };
    expect(
      placeCard({ plot, card, traces: [down, up], obstacles: [] }),
    ).toBeUndefined();
  });

  it("places nothing where the card does not fit the plot", () => {
    expect(
      placeCard({
        plot: { x0: 0, y0: 0, x1: 80, y1: 60 },
        card,
        traces: [],
        obstacles: [],
      }),
    ).toBeUndefined();
    expect(
      placeCard({
        plot,
        card: { width: 0, height: 0 },
        traces: [],
        obstacles: [],
      }),
    ).toBeUndefined();
  });
});

describe("boxAsTrace", () => {
  it("covers the box so a smaller box wholly inside it is crossed", () => {
    const trace = boxAsTrace({ x0: 100, y0: 100, x1: 200, y1: 160 });
    const inner = { x0: 130, y0: 120, x1: 150, y1: 134 };
    const touched = trace.cx.some(
      (_, i) =>
        trace.cy[i] >= inner.y0 &&
        trace.cy[i] <= inner.y1 &&
        Math.min(trace.cx[i], trace.cx[i ^ 1]) <= inner.x1 &&
        Math.max(trace.cx[i], trace.cx[i ^ 1]) >= inner.x0,
    );
    expect(touched).toBe(true);
  });
});
