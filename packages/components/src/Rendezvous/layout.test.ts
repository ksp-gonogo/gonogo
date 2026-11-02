import { describe, expect, it } from "vitest";
import {
  COMPACT_BELOW_W,
  CUE_PAD,
  DOTS_HEIGHT,
  figureRooms,
  layoutFor,
  MIN_DIAMETER,
  ROW_HEIGHT,
  rowTop,
} from "./layout";

describe("layoutFor", () => {
  it("takes the box's shorter side, less the room the cue keeps", () => {
    const tall = layoutFor({ w: 192, h: 244 });
    expect(tall.diameter).toBe(192 - 2 * CUE_PAD);
    const wide = layoutFor({ w: 400, h: 200 });
    expect(wide.diameter).toBe(200 - 2 * CUE_PAD);
  });

  it("centres the large circle in the box above the dots", () => {
    const l = layoutFor({ w: 192, h: 244 });
    expect(l.large).toEqual({ x: 96, y: 122 });
    const dotted = layoutFor({ w: 400, h: 400 });
    expect(dotted.dotsHeight).toBe(DOTS_HEIGHT);
    expect(dotted.large.y).toBe((400 - DOTS_HEIGHT) / 2);
  });

  it("sits the small circle in the bottom left corner of the large circle's square", () => {
    const l = layoutFor({ w: 192, h: 244 });
    const half = l.diameter / 2;
    expect(l.small.x - l.small.diameter / 2).toBeCloseTo(l.large.x - half);
    expect(l.small.y + l.small.diameter / 2).toBeCloseTo(l.large.y + half);
  });

  it("keeps the circle at the box's shorter side in a narrow box, the figures laid over it", () => {
    const l = layoutFor({ w: 110, h: 104 });
    expect(l.overlay).toBe(true);
    expect(l.diameter).toBe(104 - 2 * CUE_PAD);
  });

  it("gives the name and range a row above the circle in a box too narrow to lay them over it", () => {
    const l = layoutFor({ w: 90, h: 104 });
    expect(l.compact).toBe(true);
    expect(l.overlay).toBe(false);
    expect(l.large.y - l.diameter / 2).toBeGreaterThanOrEqual(ROW_HEIGHT);
  });

  it("draws no circle where there is no room for one", () => {
    expect(layoutFor({ w: 40, h: 40 }).diameter).toBe(0);
    expect(layoutFor({ w: 70, h: 111 }).diameter).toBeGreaterThanOrEqual(
      MIN_DIAMETER,
    );
  });

  it("leaves the dots out of a small box and keeps only name and range in a narrow one", () => {
    expect(layoutFor({ w: 359, h: 400 }).dots).toBe(false);
    expect(layoutFor({ w: 360, h: 300 }).dots).toBe(true);
    expect(layoutFor({ w: COMPACT_BELOW_W - 1, h: 300 }).compact).toBe(true);
    expect(layoutFor({ w: COMPACT_BELOW_W, h: 300 }).compact).toBe(false);
  });
});

describe("figureRooms", () => {
  const box = { w: 192, h: 244 };

  it("gives a row in the slack above and below the circle the box's half width", () => {
    const l = layoutFor(box);
    const top = figureRooms(l, box, "top");
    expect(top.left.width).toBeCloseTo(96 - 6);
    expect(top.right.width).toBeCloseTo(96 - 6);
    const bottom = figureRooms(l, box, "bottom");
    expect(bottom.left.inset).toBe(0);
    expect(bottom.left.width).toBeGreaterThan(80);
  });

  it("narrows a row the circle reaches into to the room beside its edge", () => {
    const square = { w: 200, h: 200 };
    const l = layoutFor(square);
    const top = figureRooms(l, square, "top");
    expect(top.left.width).toBeLessThan(100 - 6);
    expect(top.left.width).toBeGreaterThan(0);
  });

  it("starts the bottom left figure past the small circle where that circle rises into the row", () => {
    const square = { w: 200, h: 200 };
    const l = layoutFor(square);
    const bottom = figureRooms(l, square, "bottom");
    expect(bottom.left.inset).toBeGreaterThan(l.small.diameter);
    expect(rowTop(l, "bottom") + ROW_HEIGHT).toBe(l.lane);
  });
});
