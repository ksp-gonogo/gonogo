import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import { decodeJpeg } from "../decode/jpegDecoder.js";
import { createCameraVideoSource } from "../peer/mediaTracks.js";

function makeSolidJpeg(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
): Buffer {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4 + 0] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }
  return jpeg.encode({ data: rgba, width, height }, 90).data;
}

describe("decodeJpeg", () => {
  it("decodes dimensions and RGBA pixel data", () => {
    const jpg = makeSolidJpeg(8, 8, 255, 0, 0);
    const out = decodeJpeg(jpg);

    expect(out.width).toBe(8);
    expect(out.height).toBe(8);
    expect(out.rgba.length).toBe(8 * 8 * 4);
    // Solid red JPEG, check a center pixel — JPEG is lossy, so allow a
    // generous tolerance for the R channel and near-zero for G/B.
    const pixelIndex = (4 * 8 + 4) * 4;
    expect(out.rgba[pixelIndex + 0]).toBeGreaterThan(200);
    expect(out.rgba[pixelIndex + 1]).toBeLessThan(60);
    expect(out.rgba[pixelIndex + 2]).toBeLessThan(60);
    expect(out.rgba[pixelIndex + 3]).toBe(255);
  });
});

describe("createCameraVideoSource", () => {
  it("produces a live MediaStreamTrack before any frames are pushed", () => {
    const src = createCameraVideoSource();
    expect(src.track).toBeDefined();
    expect(src.track.readyState).toBe("live");
    expect(src.track.kind).toBe("video");
    expect(src.frameCount).toBe(0);
    src.close();
  });

  it("accepts JPEG frames and records dimensions + frame count", () => {
    const src = createCameraVideoSource();
    const jpg = makeSolidJpeg(16, 16, 0, 255, 0);

    src.pushJpeg(jpg);
    expect(src.width).toBe(16);
    expect(src.height).toBe(16);
    expect(src.frameCount).toBe(1);

    src.pushJpeg(jpg);
    expect(src.frameCount).toBe(2);
    src.close();
  });

  it("reallocates its I420 buffer when the incoming JPEG dimensions change", () => {
    const src = createCameraVideoSource();
    src.pushJpeg(makeSolidJpeg(16, 16, 255, 255, 255));
    expect(src.width).toBe(16);
    expect(src.height).toBe(16);

    src.pushJpeg(makeSolidJpeg(32, 24, 255, 255, 255));
    expect(src.width).toBe(32);
    expect(src.height).toBe(24);
    expect(src.frameCount).toBe(2);
    src.close();
  });

  it("rejects JPEG frames with odd dimensions (I420 incompatible)", () => {
    const src = createCameraVideoSource();
    const jpg = makeSolidJpeg(15, 15, 0, 0, 255);
    expect(() => src.pushJpeg(jpg)).toThrow(/even/i);
    src.close();
  });

  it("stops the track on close() and ignores subsequent pushes", () => {
    const src = createCameraVideoSource();
    src.pushJpeg(makeSolidJpeg(16, 16, 0, 0, 0));
    expect(src.frameCount).toBe(1);

    src.close();
    expect(src.track.readyState).toBe("ended");

    src.pushJpeg(makeSolidJpeg(16, 16, 0, 0, 0));
    expect(src.frameCount).toBe(1);
  });
});
