import { describe, expect, it } from "vitest";
import { coverBox, reticleTravelPx } from "./reticleGeometry";

const LANDSCAPE = { width: 480, height: 120 };
const PORTRAIT = { width: 120, height: 480 };
const SQUARE = { width: 300, height: 300 };

describe("coverBox", () => {
  it("covers a wide frame edge to edge and crops the picture top and bottom", () => {
    expect(coverBox(LANDSCAPE, 16 / 9)).toEqual({ width: 480, height: 270 });
  });

  it("covers a tall frame top to bottom and crops the picture's sides", () => {
    const box = coverBox(PORTRAIT, 16 / 9);
    expect(box.height).toBe(480);
    expect(box.width).toBeCloseTo((480 * 16) / 9);
  });
});

describe("reticleTravelPx", () => {
  it("keeps a square in the frame with no picture behind it", () => {
    expect(reticleTravelPx(LANDSCAPE, null)).toBe(0.4 * 120);
    expect(reticleTravelPx(PORTRAIT, null)).toBe(0.4 * 120);
    expect(reticleTravelPx(SQUARE, null)).toBe(0.4 * 300);
  });

  it("follows the picture's cover box when a camera paints one", () => {
    // A 16:9 feed covering a tall frame is 480 high, so the scale is the camera's, not the frame's width.
    expect(reticleTravelPx(PORTRAIT, 16 / 9)).toBe(0.4 * 480);
    expect(reticleTravelPx(LANDSCAPE, 16 / 9)).toBe(0.4 * 270);
  });
});
