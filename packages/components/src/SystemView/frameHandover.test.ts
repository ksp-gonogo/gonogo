import { describe, expect, it } from "vitest";
import { handoverView } from "./frameHandover";

/** Where a point in plot units lands on a `width` by `height` picture under a view, as a fraction of the picture. */
function onScreen(
  point: { x: number; y: number },
  view: { zoom: number; pan: { x: number; y: number } },
  size = { width: 400, height: 300 },
) {
  return {
    x: 0.5 + ((point.x - view.pan.x) * view.zoom) / size.width,
    y: 0.5 + ((point.y - view.pan.y) * view.zoom) / size.height,
  };
}

describe("handoverView", () => {
  // Kerbin frame at 4 px per Mm, then a Mun frame at 80 px per Mm: a twentyfold change of scale.
  const KERBIN_SCALE = 4e-6;
  const MUN_SCALE = 80e-6;
  // The Mun, in metres from Kerbin.
  const MUN = { x: -9_000_000, y: 8_000_000 };
  // A craft just inside the Mun's sphere of influence, in metres from Kerbin.
  const CRAFT = { x: -7_000_000, y: 7_000_000 };

  it.each([
    ["the view as mounted", { zoom: 1, pan: { x: 0, y: 0 } }],
    [
      "a zoomed view panned onto the craft",
      { zoom: 5.35, pan: { x: -28, y: 28 } },
    ],
  ])("leaves the craft, the body entered and the body left where they were on screen, from %s", (_name, before) => {
    const after = handoverView({
      view: before,
      previousScale: KERBIN_SCALE,
      scale: MUN_SCALE,
      // Kerbin, in metres from the Mun.
      previousFrameBodyAt: { x: -MUN.x, y: -MUN.y },
    });
    const kerbinFrame = (p: { x: number; y: number }) => ({
      x: p.x * KERBIN_SCALE,
      y: p.y * KERBIN_SCALE,
    });
    const munFrame = (p: { x: number; y: number }) => ({
      x: (p.x - MUN.x) * MUN_SCALE,
      y: (p.y - MUN.y) * MUN_SCALE,
    });
    for (const point of [CRAFT, MUN, { x: 0, y: 0 }]) {
      const was = onScreen(kerbinFrame(point), before);
      const is = onScreen(munFrame(point), after);
      expect(is.x).toBeCloseTo(was.x, 9);
      expect(is.y).toBeCloseTo(was.y, 9);
    }
    // The same metres per pixel: nothing was rescaled.
    expect(after.zoom * MUN_SCALE).toBeCloseTo(before.zoom * KERBIN_SCALE, 12);
  });

  it("is its own inverse on the way back out", () => {
    const start = { zoom: 2, pan: { x: 30, y: -10 } };
    const inMunFrame = handoverView({
      view: start,
      previousScale: KERBIN_SCALE,
      scale: MUN_SCALE,
      previousFrameBodyAt: { x: -MUN.x, y: -MUN.y },
    });
    const back = handoverView({
      view: inMunFrame,
      previousScale: MUN_SCALE,
      scale: KERBIN_SCALE,
      previousFrameBodyAt: MUN,
    });
    expect(back.zoom).toBeCloseTo(start.zoom, 9);
    expect(back.pan.x).toBeCloseTo(start.pan.x, 6);
    expect(back.pan.y).toBeCloseTo(start.pan.y, 6);
  });
});
