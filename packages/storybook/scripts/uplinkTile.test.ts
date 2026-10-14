import { describe, expect, it } from "vitest";
import { resolveTile } from "./uplinkTile";

const MODE = { name: "default", w: 6, h: 10, pxW: 1, pxH: 1 };

describe("resolveTile", () => {
  it("keeps the mode's own tile with no control set", () => {
    expect(resolveTile(MODE, undefined, undefined)).toBe(MODE);
  });

  it("resizes when only the width control has moved, keeping the mode's height", () => {
    const tile = resolveTile(MODE, 14, undefined);
    expect(tile.w).toBe(14);
    expect(tile.h).toBe(10);
    expect(tile.pxW).toBe(14 * 32 + 13 * 8);
  });

  it("resizes when only the height control has moved, keeping the mode's width", () => {
    const tile = resolveTile(MODE, undefined, 4);
    expect(tile.w).toBe(6);
    expect(tile.h).toBe(4);
    expect(tile.pxH).toBe(4 * 25 + 3 * 8);
  });

  it("takes both controls when both are set", () => {
    const tile = resolveTile(MODE, 14, 6);
    expect([tile.w, tile.h]).toEqual([14, 6]);
  });
});
