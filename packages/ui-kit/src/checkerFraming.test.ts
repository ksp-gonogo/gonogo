import { describe, expect, it } from "vitest";
import { fitOf, framingFaults, paintChecker } from "./checkerFraming";

/** A 16:9 camera's own picture, one cell per 64px of a 1024x576 frame. */
const FEED = { cols: 16, rows: 9 };

describe("paintChecker", () => {
  it("keeps cells square under cover and reports what the box cuts off", () => {
    const paint = paintChecker(FEED, { width: 400, height: 200 }, "cover");
    expect(paint.cellWidth).toBe(25);
    expect(paint.cellHeight).toBe(25);
    expect(paint.visible).toEqual({ cols: 16, rows: 8 });
    expect(paint.painted).toEqual({ width: 400, height: 225 });
  });

  it("keeps cells square under contain and shows the whole grid", () => {
    const paint = paintChecker(FEED, { width: 400, height: 400 }, "contain");
    expect(paint.cellWidth).toBe(25);
    expect(paint.cellHeight).toBe(25);
    expect(paint.visible).toEqual(FEED);
    expect(paint.painted).toEqual({ width: 400, height: 225 });
  });

  it("stretches cells under fill", () => {
    const paint = paintChecker(FEED, { width: 400, height: 400 }, "fill");
    expect(paint.cellWidth).toBe(25);
    expect(paint.cellHeight).toBeCloseTo(44.44, 2);
    expect(paint.visible).toEqual(FEED);
  });

  it("refuses an empty box rather than painting infinite cells", () => {
    expect(() =>
      paintChecker(FEED, { width: 0, height: 200 }, "cover"),
    ).toThrow(/positive grid and box/);
  });
});

describe("framingFaults tells the three faults apart", () => {
  const tile = { width: 400, height: 400 };

  it("distortion: the cell stops being square", () => {
    expect(framingFaults(paintChecker(FEED, tile, "fill"), FEED)).toEqual([
      "distortion",
    ]);
  });

  it("cropping: cells stay square and some are lost off the edge", () => {
    const paint = paintChecker(FEED, tile, "cover");
    expect(paint.visible.cols).toBeCloseTo(9, 6);
    expect(framingFaults(paint, FEED)).toEqual(["cropping"]);
  });

  it("field of view: cells stay square, nothing is cut, and the grid is not the one intended", () => {
    // A camera asked to render at the tile's own shape shows a square scene where a 16:9 one was meant.
    const reshaped = paintChecker({ cols: 9, rows: 9 }, tile, "contain");
    expect(reshaped.cellWidth).toBe(reshaped.cellHeight);
    expect(reshaped.visible).toEqual({ cols: 9, rows: 9 });
    expect(framingFaults(reshaped, FEED)).toEqual(["field-of-view"]);
  });

  it("a feed fitted to its own aspect and floored to whole pixels shows none", () => {
    // A 500x300 box fitted to 16:9: width 500, height floor(500 / (16/9)) = 281.
    const floored = { width: 500, height: 281 };
    expect(framingFaults(paintChecker(FEED, floored, "contain"), FEED)).toEqual(
      [],
    );
    expect(framingFaults(paintChecker(FEED, floored, "fill"), FEED)).toEqual(
      [],
    );
  });

  it("never reports a field-of-view change without an intended grid", () => {
    expect(
      framingFaults(paintChecker({ cols: 9, rows: 9 }, tile, "contain")),
    ).toEqual([]);
  });
});

describe("fitOf", () => {
  function svg(attrs: Record<string, string>): SVGSVGElement {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  it("reads an element's object-fit, defaulting as the browser does", () => {
    expect(fitOf(document.createElement("img"))).toBe("fill");
    const video = document.createElement("video");
    expect(fitOf(video)).toBe("contain");
    video.style.objectFit = "cover";
    expect(fitOf(video)).toBe("cover");
  });

  it("refuses a pixel-sized object-fit", () => {
    const img = document.createElement("img");
    img.style.objectFit = "none";
    expect(() => fitOf(img)).toThrow(/by its pixels/);
  });

  it("reads an svg's preserveAspectRatio", () => {
    expect(fitOf(svg({ viewBox: "0 0 16 9" }))).toBe("contain");
    expect(
      fitOf(
        svg({ viewBox: "0 0 16 9", preserveAspectRatio: "xMidYMid slice" }),
      ),
    ).toBe("cover");
    expect(
      fitOf(svg({ viewBox: "0 0 16 9", preserveAspectRatio: "none" })),
    ).toBe("fill");
  });

  it("refuses an svg with no viewBox", () => {
    expect(() => fitOf(svg({}))).toThrow(/without a viewBox/);
  });
});
