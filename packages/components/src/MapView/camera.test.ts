import { describe, expect, it } from "vitest";
import {
  constrainCamera,
  fitCamera,
  visibleWorldX,
  WORLD_H,
  WORLD_W,
  widestZoom,
  zoomBounds,
} from "./camera";

describe("the widest view the map allows", () => {
  it.each([
    ["the default tile", 900, 600],
    ["a wide tile", 1800, 500],
    ["a tall tile", 400, 700],
  ])("is one world across on %s", (_name, w, h) => {
    const fit = fitCamera(w, h);
    const { min } = zoomBounds(widestZoom(w));
    expect(fit.zoom).toBe(min);
    const { min: west, max: east } = visibleWorldX(fit, w);
    expect(east - west).toBeCloseTo(WORLD_W, 6);
  });

  it("pulls a camera wider than that back to one world across", () => {
    const camera = constrainCamera(
      { zoom: widestZoom(800) / 3, panX: 10, panY: WORLD_H / 2 },
      800,
      400,
    );
    expect(camera.zoom).toBe(widestZoom(800));
  });
});

describe("the map's north and south edges", () => {
  const W = 800;
  const zoom = widestZoom(W) * 4;
  const half = 200 / 2 / zoom;

  it("holds the view's top edge at the north pole", () => {
    const { panY } = constrainCamera({ zoom, panX: 0, panY: -500 }, W, 200);
    expect(panY).toBeCloseTo(half, 9);
  });

  it("holds the view's bottom edge at the south pole", () => {
    const { panY } = constrainCamera(
      { zoom, panX: 0, panY: WORLD_H + 500 },
      W,
      200,
    );
    expect(panY).toBeCloseTo(WORLD_H - half, 9);
  });

  it("centres a view taller than the world", () => {
    const { panY } = constrainCamera(
      { zoom: widestZoom(100), panX: 0, panY: 5 },
      100,
      900,
    );
    expect(panY).toBe(WORLD_H / 2);
  });

  it("leaves east and west alone, the map repeats", () => {
    const camera = { zoom, panX: WORLD_W * 3.5, panY: WORLD_H / 2 };
    expect(constrainCamera(camera, W, 200)).toBe(camera);
  });
});
