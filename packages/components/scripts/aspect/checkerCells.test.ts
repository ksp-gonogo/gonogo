import { describe, expect, it } from "vitest";
import { measureCheckerCells, type Raster } from "./checkerCells";

/** A checkerboard raster whose cells are `cellW` by `cellH`, offset so the edges are cut. */
function checker(
  width: number,
  height: number,
  cellW: number,
  cellH: number,
  offset = 0,
): Raster {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const light =
        (Math.floor((x + offset) / cellW) + Math.floor((y + offset) / cellH)) %
          2 ===
        0;
      const i = (y * width + x) * 4;
      data.set(light ? [255, 255, 255, 255] : [0, 0, 0, 255], i);
    }
  }
  return { width, height, data };
}

describe("measureCheckerCells", () => {
  it("reads square cells as square, and counts them across and down", () => {
    const cells = measureCheckerCells(checker(320, 180, 20, 20));
    expect(cells.cellWidth).toBe(20);
    expect(cells.cellHeight).toBe(20);
    expect(cells.columns).toBe(16);
    expect(cells.rows).toBe(9);
  });

  it("reads a stretched picture as distorted", () => {
    const cells = measureCheckerCells(checker(320, 180, 30, 20));
    expect(cells.cellWidth).toBe(30);
    expect(cells.cellHeight).toBe(20);
  });

  it("reads a cropped picture as square cells with partial edge cells counted as fractions", () => {
    const cells = measureCheckerCells(checker(250, 130, 40, 40, 13));
    expect(cells.cellWidth).toBe(40);
    expect(cells.cellHeight).toBe(40);
    expect(cells.columns).toBeCloseTo(6.25);
    expect(cells.rows).toBeCloseTo(3.25);
  });

  it("refuses a raster too small to tell a cell from a crop", () => {
    expect(() => measureCheckerCells(checker(60, 60, 40, 40, 13))).toThrow(
      /fewer than two whole cells/,
    );
  });
});
