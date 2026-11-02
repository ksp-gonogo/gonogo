import { describe, expect, it } from "vitest";
import {
  coverBox,
  pictureFocalPx,
  reticleOffset,
  reticleTravelPx,
} from "./reticleGeometry";

const LANDSCAPE = { width: 480, height: 120 };
const PORTRAIT = { width: 120, height: 480 };
const SQUARE = { width: 300, height: 300 };
const RAD = Math.PI / 180;

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
    expect(reticleTravelPx(LANDSCAPE, null, 8)).toBe(0.4 * 120);
    expect(reticleTravelPx(PORTRAIT, null, 8)).toBe(0.4 * 120);
    expect(reticleTravelPx(SQUARE, null, 8)).toBe(0.4 * 300);
  });

  it("is the pixels from the centre to maxDeg off boresight in the picture", () => {
    const picture = { aspect: 16 / 9, verticalFovDeg: 60 };
    const box = coverBox(LANDSCAPE, 16 / 9);
    const expected =
      (box.height / 2) * (Math.tan(8 * RAD) / Math.tan(30 * RAD));
    expect(reticleTravelPx(LANDSCAPE, picture, 8)).toBeCloseTo(expected, 6);
  });
});

describe("pictureFocalPx", () => {
  it("is half the cover box's height over the tangent of half the vertical field", () => {
    const frame = { width: 1568, height: 392 };
    const f = pictureFocalPx(frame, { aspect: 1024 / 400, verticalFovDeg: 60 });
    expect(f).toBeCloseTo(1568 / (1024 / 400) / 2 / Math.tan(30 * RAD), 6);
  });

  it("keeps the field vertical when the picture's shape changes", () => {
    const frame = { width: 800, height: 450 };
    const wide = pictureFocalPx(frame, { aspect: 2.56, verticalFovDeg: 60 });
    const sixteenNine = pictureFocalPx(frame, {
      aspect: 16 / 9,
      verticalFovDeg: 60,
    });
    // Both cover boxes are as tall as the frame demands, so the vertical scale is the cover box's own.
    expect(wide).toBeCloseTo(
      coverBox(frame, 2.56).height / 2 / Math.tan(30 * RAD),
    );
    expect(sixteenNine).toBeCloseTo(450 / 2 / Math.tan(30 * RAD));
  });
});

describe("reticleOffset", () => {
  it("holds the angle within maxDeg when there is no picture", () => {
    expect(reticleOffset(20, 8, null)).toBe(1);
    expect(reticleOffset(-4, 8, null)).toBe(-0.5);
  });

  it("projects the angle through a pinhole with a picture, past maxDeg too", () => {
    const picture = { aspect: 2, verticalFovDeg: 60 };
    expect(reticleOffset(8, 8, picture)).toBeCloseTo(1, 9);
    expect(reticleOffset(16, 8, picture)).toBeCloseTo(
      Math.tan(16 * RAD) / Math.tan(8 * RAD),
      9,
    );
  });
});
