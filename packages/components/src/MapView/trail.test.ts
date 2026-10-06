import { latLonToMap } from "@ksp-gonogo/core";
import { describe, expect, it, vi } from "vitest";
import { type Camera, fitCamera } from "./camera";
import {
  MAP_MARK,
  paintTrail,
  trailPoints,
  trailScreenWidth,
} from "./canvasPaint";
import type { TrajectoryPoint } from "./useTrajectoryBuffer";

/** The map's projection in the order the painters call it. */
const project = (w: number, h: number, lat: number, lon: number) =>
  latLonToMap(lat, lon, w, h);

const W = 800;
const H = 400;

function point(over: Partial<TrajectoryPoint> = {}): TrajectoryPoint {
  return {
    lat: 0,
    lon: 0,
    alt: 200_000,
    q: 0,
    mach: 0,
    speed: 100,
    vSpeed: 0,
    ...over,
  };
}

/** A context that records each stroke's width on screen: the width set, through the scale in force when the stroke was drawn. */
function recordingContext() {
  let scale = 1;
  let segments = 0;
  const widths: number[] = [];
  const ctx: Partial<CanvasRenderingContext2D> = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    lineTo: vi.fn(),
    moveTo: () => {
      segments++;
    },
    setTransform: (...m: unknown[]) => {
      scale = Number(m[0]);
    },
    stroke: () => {
      widths.push((ctx.lineWidth ?? 1) * scale);
    },
    lineWidth: 1,
    strokeStyle: "",
  };
  return {
    ctx: ctx as CanvasRenderingContext2D,
    widths,
    segments: () => segments,
  };
}

function paint(camera: Camera, points: TrajectoryPoint[]) {
  const recorded = recordingContext();
  paintTrail(recorded.ctx, {
    w: W,
    h: H,
    camera,
    points,
    adjustedMap: project,
    hasAtmosphere: true,
    maxAtmosphere: 70_000,
  });
  return recorded;
}

describe("the flown trail", () => {
  const fit = fitCamera(W, H);
  const zoomed: Camera = { ...fit, zoom: fit.zoom * 4 };
  const coast = [point({ lon: 0 }), point({ lon: 1 }), point({ lon: 2 })];

  it("draws every stretch between the points it is given", () => {
    expect(paint(fit, coast).segments()).toBe(2);
    expect(paint(fit, [point()]).segments()).toBe(0);
  });

  it("keeps one width on screen at the fit zoom and at four times it", () => {
    const atFit = paint(fit, coast).widths;
    const atZoom = paint(zoomed, coast).widths;
    expect(atFit).toHaveLength(2);
    for (let i = 0; i < atFit.length; i++) {
      expect(atZoom[i]).toBeCloseTo(atFit[i], 6);
    }
  });

  it("sits in proportion with the dashed forward track: never under two thirds of it, never over twice", () => {
    // The style thickens with height and speed: slow on the ground is the thinnest it gives, and a fast pass above the air the thickest.
    const thin = paint(fit, [
      point({ alt: 0, speed: 0 }),
      point({ alt: 0, speed: 0, lon: 1 }),
    ]).widths[0];
    const thick = paint(fit, [
      point({ speed: 2_500 }),
      point({ speed: 2_500, lon: 1 }),
    ]).widths[0];
    expect(thin).toBeGreaterThanOrEqual((MAP_MARK.trackWidth * 2) / 3 - 1e-9);
    expect(thick).toBeLessThanOrEqual(MAP_MARK.trackWidth * 2 + 1e-9);
    expect(thick).toBeGreaterThan(thin);
    expect(trailScreenWidth(1)).toBeCloseTo((MAP_MARK.trackWidth * 2) / 3, 9);
    expect(trailScreenWidth(100)).toBeCloseTo(MAP_MARK.trackWidth * 2, 9);
  });
});

describe("trailPoints", () => {
  const buffer = [point({ lon: 1 }), point({ lon: 2 }), point({ lon: 3 })];

  it("is the whole buffer while every point in it was flown over this body", () => {
    expect(trailPoints(buffer, 3, 0)).toBe(buffer);
    // Older points have been shifted out: ten taken, three kept, all since the start.
    expect(trailPoints(buffer, 10, 2)).toBe(buffer);
  });

  it("drops the points flown before the map changed body", () => {
    // Ten taken, eight of them before the switch: the two newest are this body's.
    expect(trailPoints(buffer, 10, 8).map((p) => p.lon)).toEqual([2, 3]);
    expect(trailPoints(buffer, 10, 10)).toEqual([]);
  });
});
