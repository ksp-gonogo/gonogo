import { describe, expect, it } from "vitest";
import { firstFreeSlot } from "../components/Dashboard/layoutNormalization";

const tile = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe("firstFreeSlot", () => {
  it("takes the origin on an empty grid", () => {
    expect(firstFreeSlot([], { w: 8, h: 6 }, 36)).toEqual(tile(0, 0, 8, 6));
  });

  it("places beside an existing tile when the row has room, not below it", () => {
    expect(firstFreeSlot([tile(0, 0, 12, 6)], { w: 12, h: 6 }, 36)).toEqual(
      tile(12, 0, 12, 6),
    );
  });

  it("drops to the next row when the first row is too narrow for the tile", () => {
    const placed = [tile(0, 0, 20, 6)];
    expect(firstFreeSlot(placed, { w: 20, h: 4 }, 36)).toEqual(
      tile(0, 6, 20, 4),
    );
  });

  it("fills a gap left under a short tile before opening a new row", () => {
    const placed = [tile(0, 0, 18, 10), tile(18, 0, 18, 4)];
    expect(firstFreeSlot(placed, { w: 18, h: 4 }, 36)).toEqual(
      tile(18, 4, 18, 4),
    );
  });

  it("clamps a tile wider than the grid to the column count", () => {
    expect(firstFreeSlot([], { w: 40, h: 3 }, 12)).toEqual(tile(0, 0, 12, 3));
  });
});
