import { latLonToMap } from "@ksp-gonogo/core";
import { describe, expect, it, vi } from "vitest";
import {
  type Camera,
  fitCamera,
  WORLD_H,
  WORLD_W,
  worldToScreen,
} from "./camera";
import { paintPrediction } from "./canvasPaint";

const W = 800;
const H = 400;
/** A point on the forward track, and so a point on the map. */
const POINT = { lat: 12, lon: -132 };

/**
 * A context that records what a painter draws, as screen points: each `moveTo`
 * and `lineTo` through the transform in force when it was called, which is
 * where the pixel lands.
 */
function recordingContext() {
  let matrix: number[] = [1, 0, 0, 1, 0, 0];
  const points: { x: number; y: number }[] = [];
  const widths: number[] = [];
  const dashes: number[][] = [];
  const toScreen = (x: number, y: number) => ({
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  });
  const ctx: Partial<CanvasRenderingContext2D> = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    setTransform: (...m: unknown[]) => {
      matrix = m.map(Number);
    },
    setLineDash: (dash: Iterable<number>) => {
      dashes.push([...dash].map((d) => d * matrix[0]));
    },
    moveTo: (x: number, y: number) => {
      points.push(toScreen(x, y));
    },
    lineTo: (x: number, y: number) => {
      points.push(toScreen(x, y));
    },
    stroke: () => {
      widths.push((ctx.lineWidth ?? 1) * matrix[0]);
    },
    lineWidth: 1,
    strokeStyle: "",
    fillStyle: "",
  };
  return { ctx: ctx as CanvasRenderingContext2D, points, widths, dashes };
}

/** The track as the painter draws it, at `camera`: its first drawn point, and the stroke and dash it was drawn with, all in screen pixels. */
function drawnTrack(camera: Camera) {
  const recorded = recordingContext();
  paintPrediction(recorded.ctx, {
    w: W,
    h: H,
    camera,
    predictionSegments: [
      [
        { ut: 0, alt: 80_000, patchIndex: 0, ...POINT },
        { ut: 10, alt: 80_000, patchIndex: 0, lat: 12, lon: -120 },
      ],
    ],
    maneuverSegments: [],
    adjustedMap: latLonToMap,
    encounterKind: null,
    impactLat: undefined,
    impactLon: undefined,
  });
  return recorded;
}

/** Where that map point is on screen at `camera`: where the marker is drawn, and where the map's own pixel for it lands. */
function mapPointOnScreen(camera: Camera) {
  const world = latLonToMap(WORLD_W, WORLD_H, POINT.lat, POINT.lon);
  return worldToScreen(world.x, world.y, camera, W, H);
}

describe("MapView on zoom", () => {
  const fit = fitCamera(W, H);
  const world = latLonToMap(WORLD_W, WORLD_H, POINT.lat, POINT.lon);
  // Zoomed four times, and panned so the point is off centre: both terms of the transform are in play.
  const zoomed: Camera = {
    zoom: fit.zoom * 4,
    panX: world.x + 20,
    panY: world.y - 10,
  };

  it("draws a track point on its own map point at the fit zoom and zoomed in", () => {
    for (const camera of [fit, zoomed]) {
      const [first] = drawnTrack(camera).points;
      const onMap = mapPointOnScreen(camera);
      expect(first.x).toBeCloseTo(onMap.x, 6);
      expect(first.y).toBeCloseTo(onMap.y, 6);
    }
  });

  it("moves the track with the map: four times the zoom is four times the distance between two track points", () => {
    const span = (camera: Camera) => {
      const [a, b] = drawnTrack(camera).points;
      return Math.hypot(b.x - a.x, b.y - a.y);
    };
    expect(span(zoomed)).toBeCloseTo(span(fit) * 4, 6);
  });

  it("keeps the track's line and its dashes one size on screen, so only the shape grows", () => {
    const atFit = drawnTrack(fit);
    const atZoom = drawnTrack(zoomed);
    expect(atZoom.widths[0]).toBeCloseTo(atFit.widths[0], 6);
    expect(atZoom.dashes[0][0]).toBeCloseTo(atFit.dashes[0][0], 6);
    expect(atFit.widths[0]).toBeCloseTo(1.5, 6);
  });
});
