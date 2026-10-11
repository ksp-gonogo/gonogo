import { describe, expect, it } from "vitest";
import {
  bearingLabel,
  cameraAt,
  cellCentre,
  groundPointVisible,
  heightField,
  latticePitch,
  renderTerrain,
  skylineAt,
  touchdownScene,
  viewFovDegrees,
  zoneRing,
} from "./vesselView";

/** A 24 by 24 grid 800 m across at `ground`, with a wall of `wall` more at east `at`. */
function field(ground: number, wall = 0, at = -150) {
  const size = 24;
  const half = 400;
  const cell = (2 * half) / size;
  return heightField(
    Array.from({ length: size * size }, (_, i) => {
      const x = -half + ((i % size) + 0.5) * cell;
      return ground + (Math.abs(x - at) < cell ? wall : 0);
    }),
    size,
    2 * half,
    false,
  );
}

describe("the view from the vessel", () => {
  it("opens wide high up and closes toward a floor at the ground", () => {
    expect(viewFovDegrees(0)).toBe(20);
    expect(viewFovDegrees(1500)).toBeCloseTo(45, 6);
    expect(viewFovDegrees(100_000)).toBeLessThan(70);
    expect(viewFovDegrees(8000)).toBeGreaterThan(viewFovDegrees(1000));
  });

  it("puts the point it is aimed at in the middle of the screen, however steep", () => {
    for (const eye of [
      [-3000, 0, 500],
      [-100, 0, 500],
      [0, 0, 500],
    ] as const) {
      const cam = cameraAt(eye, [0, 0, 100], 90, 40);
      const at = cam.project([0, 0, 100]);
      expect(at?.x).toBeCloseTo(0, 9);
      expect(at?.y).toBeCloseTo(0, 9);
    }
  });

  it("puts the way the craft travels up the screen when it looks straight down", () => {
    const cam = cameraAt([0, 0, 500], [0, 0, 100], 90, 40);
    const ahead = cam.project([100, 0, 100]);
    expect(ahead?.y).toBeGreaterThan(0);
    expect(Math.abs(ahead?.x ?? 1)).toBeLessThan(1e-9);
  });

  it("does not project what is behind the eye", () => {
    const cam = cameraAt([0, 0, 500], [0, 0, 100], 90, 40);
    expect(cam.project([0, 0, 900])).toBeNull();
  });

  it("reads the grid between its points and nowhere outside it", () => {
    const f = field(100);
    expect(f?.at(0, 0)).toBeCloseTo(100, 9);
    expect(f?.at(1000, 0)).toBeNull();
  });

  it("sees a point of ground with nothing in the way, and not one behind a wall", () => {
    const eye = [-300, 0, 160] as const;
    const site = [0, 0, 100] as const;
    expect(groundPointVisible(eye, site, field(100))).toBe(true);
    expect(groundPointVisible(eye, site, field(100, 200))).toBe(false);
  });

  it("sees the same point once it is above the wall", () => {
    expect(
      groundPointVisible([-300, 0, 900], [0, 0, 100], field(100, 200)),
    ).toBe(true);
  });

  it("veils a ray that leaves the grid and leaves ground it hits plain", () => {
    const f = field(100);
    if (!f) throw new Error("expected a field");
    const cam = cameraAt([-300, 0, 160], [0, 0, 100], 90, 60);
    const raster = renderTerrain(cam, f, null, 16, 10);
    if (!raster) throw new Error("expected a raster");
    // A ray that leaves the grid is under a veil; one that meets ground keeps all its colour.
    expect(Math.max(...raster.values)).toBeCloseTo(100, 6);
    expect(Math.max(...raster.veil)).toBeGreaterThan(0);
    expect(Math.min(...raster.veil)).toBe(0);
  });

  it("makes every cell the height of the ground cell it falls in, so heights change only on the lattice's lines", () => {
    const f = field(100, 200);
    if (!f) throw new Error("expected a field");
    const cam = cameraAt([-300, 0, 160], [0, 0, 100], 90, 60);
    const raster = renderTerrain(cam, f, null, 24, 40);
    if (!raster) throw new Error("expected a raster");
    expect(cellCentre(59, 40)).toBe(40);
    expect(cellCentre(-19, 40)).toBe(0);
    expect(cellCentre(21, 40)).toBe(40);
    // One cell wider than the whole grid: every ground ray lands in it, so all of them read its one height.
    const one = renderTerrain(cam, f, null, 24, 5000);
    const seen = new Set(one?.values.filter((_, i) => one.veil[i] === 0));
    expect(seen.size).toBe(1);
    expect(
      new Set(
        renderTerrain(cam, f, null, 24, 1)?.values.filter(
          (_, i) => renderTerrain(cam, f, null, 24, 1)?.veil[i] === 0,
        ),
      ).size,
    ).toBeGreaterThan(1);
  });

  it("interpolates the skyline between bearings and wraps at north", () => {
    const sky = Array.from({ length: 72 }, (_, i) => i);
    expect(skylineAt(sky, 0)).toBe(0);
    expect(skylineAt(sky, 2.5)).toBeCloseTo(0.5, 9);
    expect(skylineAt(sky, 357.5)).toBeCloseTo(35.5, 9);
    expect(skylineAt(null, 10)).toBeNull();
  });
});

describe("the marks drawn on the ground", () => {
  const scene = (slopePerMetre: number) => {
    const size = 24;
    const half = 400;
    const cell = (2 * half) / size;
    return touchdownScene({
      driftMeters: 100,
      driftBearingDeg: 90,
      altitudeAsl: 400,
      siteElevation: 100,
      aglMeters: 300,
      siteHeights: Array.from(
        { length: size * size },
        (_, i) => 100 + slopePerMetre * (-half + ((i % size) + 0.5) * cell),
      ),
      siteHeightsSize: size,
      siteHeightsExtentMeters: 2 * half,
    });
  };

  it("draws the ring a circle on level ground", () => {
    const s = scene(0);
    if (!s) throw new Error("expected a scene");
    for (const [x, y] of zoneRing(s, 50, 36)) {
      expect(Math.hypot(x, y)).toBeCloseTo(50, 3);
    }
  });

  it("draws the ring shorter along a slope, so it follows the ground it lies on", () => {
    const s = scene(0.5);
    if (!s) throw new Error("expected a scene");
    const ring = zoneRing(s, 50, 72);
    const east = ring.reduce((a, p) => (p[0] > a[0] ? p : a));
    const north = ring.reduce((a, p) => (p[1] > a[1] ? p : a));
    expect(east[0]).toBeLessThan(north[1] - 5);
    expect(north[1]).toBeCloseTo(50, 1);
  });

  it("lays about eight lines across a footprint on a round pitch", () => {
    for (const across of [30, 180, 900, 7000]) {
      const pitch = latticePitch(across);
      expect([1, 2, 5]).toContain(pitch / 10 ** Math.floor(Math.log10(pitch)));
      expect(across / pitch).toBeGreaterThan(4);
      expect(across / pitch).toBeLessThan(16);
    }
  });

  it("writes a bearing as three digits", () => {
    expect(bearingLabel(7)).toBe("007°");
    expect(bearingLabel(-90)).toBe("270°");
    expect(bearingLabel(359.6)).toBe("000°");
  });
});
