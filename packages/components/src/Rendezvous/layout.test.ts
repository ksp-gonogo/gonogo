import { describe, expect, it } from "vitest";
import {
  COMPACT_BELOW_W,
  CUE_PAD,
  DOTS_HEIGHT,
  FRAME_BLOCK,
  figureRooms,
  frameBlockRoom,
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

describe("layoutFor with bands", () => {
  it("gives the circle the room left between a band above and a band below", () => {
    const flat = layoutFor({ w: 300, h: 300 });
    const banded = layoutFor({ w: 300, h: 300 }, { top: 36, bottom: 18 });
    expect(banded.topBand).toBe(36);
    expect(banded.bottomBand).toBe(18);
    expect(banded.diameter).toBeLessThan(flat.diameter);
    expect(banded.large.y - banded.diameter / 2).toBeGreaterThanOrEqual(36);
    expect(banded.large.y + banded.diameter / 2).toBeLessThanOrEqual(300 - 18);
  });

  it("costs a tall narrow box nothing, since its circle is as wide as it can be", () => {
    const flat = layoutFor({ w: 110, h: 500 });
    const banded = layoutFor({ w: 110, h: 500 }, { top: 36, bottom: 36 });
    expect(banded.diameter).toBe(flat.diameter);
  });

  it("gives up the bottom band before the circle where the two cannot both fit", () => {
    const l = layoutFor({ w: 150, h: 150 }, { top: 36, bottom: 40 });
    expect(l.bottomBand).toBe(0);
    expect(l.diameter).toBeGreaterThanOrEqual(MIN_DIAMETER);
  });

  it("keeps the name and range over the circle only where the box is too short for a band", () => {
    expect(layoutFor({ w: 110, h: 104 }).overlay).toBe(true);
    expect(layoutFor({ w: 110, h: 500 }).overlay).toBe(false);
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
});

describe("layoutFor small circle placement", () => {
  it("never covers the large circle or the bottom row, at any box size", () => {
    for (const w of [120, 300, 600, 926, 1240, 1800]) {
      for (const h of [150, 400, 774, 838]) {
        const l = layoutFor({ w, h }, { top: 48, bottom: 48 });
        if (l.small.diameter === 0) continue;
        expect(l.small.x + l.small.diameter / 2).toBeLessThanOrEqual(
          l.large.x - l.diameter / 2,
        );
        expect(l.small.y + l.small.diameter / 2).toBeLessThanOrEqual(
          rowTop(l, "bottom"),
        );
      }
    }
  });

  it("keeps its usual size in a wide box", () => {
    const l = layoutFor({ w: 1240, h: 838 }, { top: 48, bottom: 48 });
    expect(l.small.diameter).toBe(Math.floor(l.diameter * 0.3));
  });

  it("grows into the margin of a very wide, short box", () => {
    const l = layoutFor({ w: 1272, h: 424 }, { top: 24, bottom: 24 });
    expect(l.small.diameter).toBeGreaterThan(Math.floor(l.diameter * 0.3));
    expect(l.small.diameter).toBeLessThanOrEqual(Math.floor(l.diameter * 0.55));
  });

  it("shrinks to the margin in a tile whose picture is limited by its height", () => {
    const l = layoutFor({ w: 926, h: 774 }, { top: 46, bottom: 46 });
    expect(l.small.diameter).toBeGreaterThanOrEqual(72);
    expect(l.small.diameter).toBeLessThan(Math.floor(l.diameter * 0.3));
  });

  it("is left out where the margin cannot hold a readable circle", () => {
    expect(layoutFor({ w: 300, h: 300 }).small.diameter).toBe(0);
  });
});

describe("frameBlockRoom", () => {
  const room = (w: number, h: number) => {
    const box = { w, h };
    const layout = layoutFor(box);
    return { box, layout, rect: frameBlockRoom(layout, box) };
  };

  it("takes no room in a box the circle and figures already fill", () => {
    for (const [w, h] of [
      [372, 400],
      [616, 752],
      [300, 300],
      [240, 280],
    ]) {
      expect(room(w, h).rect).toBeNull();
    }
  });

  it("takes none in a compact or overlaid box", () => {
    expect(room(120, 600).rect).toBeNull();
    expect(room(110, 104).rect).toBeNull();
  });

  it("takes the empty strip below the circle of a tall box, clear of the circle and the foot row", () => {
    const { layout, rect } = room(372, 1100);
    expect(rect).not.toBeNull();
    if (rect === null) return;
    expect(rect.w).toBe(FRAME_BLOCK.w);
    expect(rect.y).toBeGreaterThan(layout.large.y + layout.diameter / 2);
    expect(rect.y + rect.h).toBeLessThanOrEqual(layout.lane - ROW_HEIGHT);
  });

  it("takes the margin beside the circle of a wide box, between the corner figures", () => {
    const { layout, box, rect } = room(900, 400);
    expect(rect).not.toBeNull();
    if (rect === null) return;
    expect(rect.x).toBeGreaterThanOrEqual(layout.large.x + layout.diameter / 2);
    expect(rect.x + rect.w).toBeLessThanOrEqual(box.w);
    expect(rect.y).toBeGreaterThanOrEqual(ROW_HEIGHT);
    expect(rect.y + rect.h).toBeLessThanOrEqual(layout.lane - ROW_HEIGHT);
  });

  it("never leaves the box", () => {
    for (const [w, h] of [
      [372, 1100],
      [900, 400],
      [520, 900],
      [700, 360],
    ]) {
      const { box, rect } = room(w, h);
      if (rect === null) continue;
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.w).toBeLessThanOrEqual(box.w);
      expect(rect.y + rect.h).toBeLessThanOrEqual(box.h);
    }
  });
});
