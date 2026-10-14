import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getContributionsForSlot, registerStockBodies } from "@ksp-gonogo/core";
import type { PlotEntry, PlotLayer } from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { isRecord } from "../../scripts/gen-landing-status-fixtures";
import {
  buildCrossSectionPlot,
  type CrossSectionInputs,
} from "./crossSectionPlot";
import {
  touchdownScene,
  VEIL_HIDDEN,
  VEIL_NONE,
  VEIL_OUTSIDE,
  VIEW_FOV_FLOOR_DEG,
  viewFovDegrees,
  zoneRing,
} from "./vesselView";
// Registers the three contributions the last describe drives, as the widget's own import does.
import "./descentLayers";
import {
  ballisticDrift,
  coneFootprint,
  groundTrackDistances,
  integrate,
  MU,
  R,
  STORY_RELIEF,
  siteGridHalfExtent,
  siteGridHeights,
  trackExtent,
} from "../../scripts/landingDescentModel";
import type { TouchdownInputs as TouchdownViewInputs } from "./touchdownInputs";
import {
  buildTouchdownReticlePlot,
  dispersionRadiusMeters,
  mapFootprintShare,
} from "./touchdownReticlePlot";
import { buildVesselViewPlot } from "./vesselViewPlot";

/**
 * The two site plots as pure functions, checked without a DOM.
 * Every case is an absence case or a unit case: a plot must not build a frame from what it lacks, and its geometry must be in real units.
 */
/** The plot's own frame, asserted present: both builders own their frame, so its absence is a failure rather than a case. */
function frameOf(plot: PlotEntry | null): NonNullable<PlotEntry["frame"]> {
  if (!plot) throw new Error("expected a plot");
  if (!plot.frame) throw new Error("expected the plot to carry its own frame");
  return plot.frame;
}

/** A ground strip of the shape the mod sends: 48 samples across the ground beneath the craft, a margin behind it, the site, and where a 120 degree cone about the travel vector meets the ground, rising 5 m per 100 m toward the site from 100 m beneath the craft. By default it sinks at 50 m/s with no sideways travel, so it looks straight down. */
function strip(
  driftMeters: number,
  aglMeters = 300,
  descentRate = 50,
  along = 0,
): { groundDistances: number[]; groundElevations: number[] } {
  const footprint = coneFootprint(aglMeters, descentRate, along, 200_000);
  const extent = trackExtent(
    footprint.behind,
    footprint.ahead,
    aglMeters,
    driftMeters,
  );
  const groundDistances = groundTrackDistances(extent.behind, extent.ahead);
  return {
    groundDistances,
    groundElevations: groundDistances.map((d) => 100 + d * 0.05),
  };
}

/** A site grid of the shape the mod sends: 24 by 24 heights, rising from west to east. */
function grid(): {
  siteHeights: number[];
  siteHeightsSize: number;
  siteHeightsExtentMeters: number;
} {
  const size = 24;
  return {
    siteHeights: Array.from(
      { length: size * size },
      (_, i) => 100 + (i % size),
    ),
    siteHeightsSize: size,
    siteHeightsExtentMeters: 240,
  };
}

function crossSection(
  over: Partial<CrossSectionInputs> = {},
): CrossSectionInputs {
  const driftMeters = over.driftMeters === undefined ? 40 : over.driftMeters;
  const aglMeters = over.aglMeters === undefined ? 300 : over.aglMeters;
  return {
    ...strip(driftMeters ?? 0, aglMeters ?? 300),
    driftMeters: 40,
    aglMeters: 300,
    verticalSpeed: 8,
    horizontalSpeed: 2,
    hasAtmosphere: false,
    ...over,
  };
}

function reticle(over: Partial<TouchdownViewInputs> = {}): TouchdownViewInputs {
  return {
    driftMeters: 120,
    driftBearingDeg: 90,
    altitudeAsl: 400,
    siteElevation: 100,
    zoneRadiusMeters: 50,
    slope: value("°", 9),
    biome: "Midlands",
    hasAtmosphere: false,
    aglMeters: 300,
    ...over,
  };
}

describe("cross-section plot", () => {
  it("states both axes in metres, not in a normalised box", () => {
    const plot = buildCrossSectionPlot(crossSection());
    expect(plot).not.toBeNull();
    expect(frameOf(plot).xUnit).toBe("m");
    expect(frameOf(plot).yUnit).toBe("m");
    // Real elevations (100..120), not a 0..1 amplitude scaled to the box.
    const [yLo] = frameOf(plot).yDomain;
    expect(yLo).toBeLessThan(100);
  });

  it("is a SPATIAL frame, SQUARE in data units, anchored on the ground", () => {
    // Square both ways, so the square box never stretches the slope.
    const plot = buildCrossSectionPlot(crossSection({ aglMeters: 300 }));
    expect(frameOf(plot).kind).toBe("spatial");
    const [xLo, xHi] = frameOf(plot).xDomain;
    const [yLo, yHi] = frameOf(plot).yDomain;
    expect(xHi - xLo).toBeCloseTo(yHi - yLo, 6);
    // The window holds the craft and the site with headroom over the craft, not the whole cone: a craft 300 m up with the site 40 m off needs about 450 m, with the cone's 1 km of ground drawn only as far as that.
    expect(yHi - yLo).toBeGreaterThan(300 * 1.12);
    expect(yHi - yLo).toBeLessThan(600);
  });

  it("opens up to hold the vessel when it fits, staying square", () => {
    const plot = buildCrossSectionPlot(crossSection({ aglMeters: 60 }));
    const [xLo, xHi] = frameOf(plot).xDomain;
    const [yLo, yHi] = frameOf(plot).yDomain;
    expect(xHi - xLo).toBeCloseTo(yHi - yLo, 6);
    expect(yHi).toBeGreaterThan(160);
  });

  it("says both speeds inside the frame, because a map has no gutter", () => {
    const plot = buildCrossSectionPlot(crossSection({ aglMeters: 60 }));
    const captions = plot?.layers.filter((l) => l.kind === "caption") ?? [];
    expect(captions.map((c) => c.id).sort()).toEqual([
      "descent-rate",
      "ground-speed",
    ]);
  });

  describe("framing a falling vessel", () => {
    const fall = (agl: number, drift = agl * 0.8) =>
      buildCrossSectionPlot(
        crossSection({ aglMeters: agl, driftMeters: drift }),
      );
    const vesselOf = (plot: PlotEntry | null) => {
      const v = plot?.layers.find((l) => l.id === "vessel");
      if (v?.kind !== "marker") throw new Error("expected a vessel marker");
      return v;
    };
    const spanOf = (plot: PlotEntry | null) => {
      const [lo, hi] = frameOf(plot).yDomain;
      // The window is centred, so its ends carry the rounding of a sum.
      return Math.round((hi - lo) * 1e6) / 1e6;
    };

    it.each([
      8000, 3000, 900, 300, 60,
    ])("holds the craft and the predicted site together at %i m, square", (agl) => {
      const plot = fall(agl);
      const [xLo, xHi] = frameOf(plot).xDomain;
      const [yLo, yHi] = frameOf(plot).yDomain;
      const v = vesselOf(plot);
      expect(v.at.x).toBeGreaterThanOrEqual(xLo);
      expect(v.at.x).toBeLessThanOrEqual(xHi);
      expect(v.at.y).toBeGreaterThanOrEqual(yLo);
      expect(v.at.y).toBeLessThanOrEqual(yHi);
      expect(xLo).toBeLessThanOrEqual(0);
      expect(xHi).toBeGreaterThanOrEqual(0);
      expect(xHi - xLo).toBeCloseTo(yHi - yLo, 6);
      expect(plot?.layers.some((l) => l.id === "vessel-edge")).toBe(false);
    });

    it("zooms smoothly: the scale never jumps between close readings, over the whole fall", () => {
      let previous = spanOf(fall(8000));
      for (let agl = 7990; agl >= 20; agl -= 10) {
        const span = spanOf(fall(agl));
        // A step of 10 m narrows the window by what the cone sees of it, twice the tangent of 60 degrees times that step at most, and never widens it.
        expect(span).toBeLessThanOrEqual(previous + 1e-6);
        expect(previous - span).toBeLessThanOrEqual(
          10 * 2 * Math.tan(Math.PI / 3) * 1.08 + 1e-6,
        );
        previous = span;
      }
    });

    /** Where the ground's average sits in the frame, 0 at the floor and 1 at the top. */
    const groundFraction = (plot: PlotEntry | null) => {
      const skyline = plot?.layers.find((l) => l.id === "skyline");
      if (skyline?.kind !== "series") throw new Error("expected the skyline");
      const mean =
        skyline.points.reduce((sum, p) => sum + p.y, 0) / skyline.points.length;
      const [lo] = frameOf(plot).yDomain;
      return (mean - lo) / spanOf(plot);
    };

    it("starts with the ground at the foot of the frame and raises it toward the craft as the craft comes down", () => {
      const steps = [8000, 5000, 3000, 1500, 700, 300, 100].map((agl) => {
        const plot = fall(agl);
        return { span: spanOf(plot), ground: groundFraction(plot) };
      });
      expect(steps[0].ground).toBeLessThan(0.12);
      for (let i = 1; i < steps.length; i++) {
        expect(steps[i].ground).toBeGreaterThan(steps[i - 1].ground);
        expect(steps[i].span).toBeLessThan(steps[i - 1].span);
      }
      // Down on the ground it sits about a third of the way up.
      expect(groundFraction(fall(2))).toBeCloseTo(0.35, 1);
    });

    it("fills the frame's width with the strip, so the ground never shrinks to a sliver while the picture closes in", () => {
      for (const agl of [8000, 3000, 900, 300]) {
        const plot = fall(agl);
        const skyline = plot?.layers.find((l) => l.id === "skyline");
        if (skyline?.kind !== "series") throw new Error("expected the skyline");
        const width =
          skyline.points[skyline.points.length - 1].x - skyline.points[0].x;
        expect(width / spanOf(plot)).toBeGreaterThan(0.92);
      }
    });

    it("carries the zoom on the dot lattice: close together at height, spreading toward the ground", () => {
      const scale = (agl: number) => frameOf(fall(agl)).gridScale as number;
      expect(scale(15_000)).toBeLessThan(0.7);
      for (const agl of [8000, 3000, 900, 200, 20]) {
        expect(scale(agl)).toBeGreaterThanOrEqual(0.5);
        expect(scale(agl)).toBeLessThanOrEqual(2);
      }
      expect(scale(3000)).toBeGreaterThan(scale(8000));
      expect(scale(20)).toBeGreaterThan(scale(3000));
      expect(scale(20)).toBeCloseTo(2, 1);
    });

    it("draws the craft as the shared vessel mark, in the state its position is known in", () => {
      const current = vesselOf(fall(3000));
      expect(current.shape).toBe("vessel");
      expect(current.markState).toBe("current");
      const held = vesselOf(
        buildCrossSectionPlot(
          crossSection({ aglMeters: 3000, vesselMarkState: "held" }),
        ),
      );
      expect(held.markState).toBe("held");
    });

    it("moves the craft downrange toward the site as it falls", () => {
      const xs = [7400, 7000, 6600].map((agl) => vesselOf(fall(agl)).at.x);
      expect(xs[0]).toBeLessThan(xs[1]);
      expect(xs[1]).toBeLessThan(xs[2]);
    });

    it("keeps the terrain at the foot of the frame once the craft is close", () => {
      expect(spanOf(fall(150))).toBeLessThanOrEqual(600);
    });
  });

  describe("the craft's place on the ground", () => {
    /** The 226 m frame of the safe landing: 3 m/s down and 5 m/s across, so the cone's far edge never meets the ground and is cut at the horizon. */
    const safe = (agl = 226.6, drift = 60) =>
      buildCrossSectionPlot(
        crossSection({
          aglMeters: agl,
          driftMeters: drift,
          ...strip(drift, agl, 3, 5),
          verticalSpeed: 3,
          horizontalSpeed: 5,
        }),
      );
    /** A shallow approach: a craft 3 km up and 30 km uprange of the site, gliding in. */
    const shallow = (agl = 3000, drift = 30_000) =>
      buildCrossSectionPlot(
        crossSection({
          aglMeters: agl,
          driftMeters: drift,
          ...strip(drift, agl, 40, 200),
          verticalSpeed: 40,
          horizontalSpeed: 200,
        }),
      );
    const marker = (plot: PlotEntry | null, id: string) => {
      const m = plot?.layers.find((l) => l.id === id);
      if (m?.kind !== "marker") throw new Error(`expected the ${id} marker`);
      return m;
    };
    /** The drawn ground's elevation at x: the skyline, interpolated. */
    const groundAt = (plot: PlotEntry | null, x: number) => {
      const sky = plot?.layers.find((l) => l.id === "skyline");
      if (sky?.kind !== "series") throw new Error("expected the skyline");
      const pts = sky.points;
      for (let i = 1; i < pts.length; i++) {
        if (x <= pts[i].x) {
          const t = (x - pts[i - 1].x) / (pts[i].x - pts[i - 1].x);
          return pts[i - 1].y + t * (pts[i].y - pts[i - 1].y);
        }
      }
      return pts[pts.length - 1].y;
    };
    /** The frame's vertical scale against its horizontal one: 1 when equal. */
    const exaggerationOf = (plot: PlotEntry | null) => {
      const [xLo, xHi] = frameOf(plot).xDomain;
      const [yLo, yHi] = frameOf(plot).yDomain;
      return (xHi - xLo) / (yHi - yLo);
    };

    it.each([
      [226.6, 60],
      [3000, 30_000],
      [5400, 30_000],
      [60, 20],
    ])("draws the craft %f m up exactly that far above the ground beneath it (drift %f m)", (agl, drift) => {
      const plot = buildCrossSectionPlot(
        crossSection({
          aglMeters: agl,
          driftMeters: drift,
          ...strip(drift, agl, 3, 5),
        }),
      );
      const v = marker(plot, "vessel");
      expect(v.at.y - groundAt(plot, v.at.x)).toBeCloseTo(agl, 6);
    });

    it("puts the craft near the middle of the frame in the 226 m safe-landing frame, not at its far left", () => {
      const plot = safe();
      const [xLo, xHi] = frameOf(plot).xDomain;
      const x = marker(plot, "vessel").at.x;
      const along = (x - xLo) / (xHi - xLo);
      expect(along).toBeGreaterThan(0.3);
      expect(along).toBeLessThan(0.7);
    });

    it("draws the craft's height at the plot's own scale where the craft and the site are close: equal scale, no exaggeration", () => {
      const plot = safe();
      expect(exaggerationOf(plot)).toBeCloseTo(1, 6);
      const [yLo, yHi] = frameOf(plot).yDomain;
      const above =
        marker(plot, "vessel").at.y -
        groundAt(plot, marker(plot, "vessel").at.x);
      // The craft's height over the ground is the same share of the frame as 226 m is of its height.
      expect(above / (yHi - yLo)).toBeGreaterThan(0.4);
      expect(plot?.layers.some((l) => l.id === "vertical-exaggeration")).toBe(
        false,
      );
    });

    it("lifts the ground smoothly with the craft's height: its average only rises as the craft falls", () => {
      const fraction = (agl: number) => {
        const plot = safe(agl);
        const sky = plot?.layers.find((l) => l.id === "skyline");
        if (sky?.kind !== "series") throw new Error("expected the skyline");
        const [xLo, xHi] = frameOf(plot).xDomain;
        const [yLo, yHi] = frameOf(plot).yDomain;
        const seen = sky.points.filter((p) => p.x >= xLo && p.x <= xHi);
        const mean = seen.reduce((sum, p) => sum + p.y, 0) / seen.length;
        return (mean - yLo) / (yHi - yLo);
      };
      let previous = fraction(8000);
      for (let agl = 7900; agl >= 0; agl -= 100) {
        const next = fraction(agl);
        expect(next).toBeGreaterThanOrEqual(previous - 0.02);
        previous = next;
      }
      expect(fraction(8000)).toBeLessThan(0.14);
      // Already well up at 226 m, not waiting for the ground.
      expect(fraction(226.6)).toBeGreaterThan(0.2);
      expect(fraction(0)).toBeGreaterThan(0.3);
      // No step between close readings.
      for (let agl = 1000; agl > 20; agl -= 10) {
        expect(Math.abs(fraction(agl) - fraction(agl - 10))).toBeLessThan(0.04);
      }
    });

    it("sits the craft on the surface where it hit, and ends the velocity line there", () => {
      const plot = buildCrossSectionPlot(
        crossSection({
          aglMeters: 0,
          driftMeters: 0,
          ...strip(0, 0, 145, 153),
          verticalSpeed: 145,
          horizontalSpeed: 153,
        }),
      );
      const v = marker(plot, "vessel");
      // The mark's point is on the ground's surface at its x, and the mark is raised by its own radius so it rests on it.
      expect(v.at.y).toBeCloseTo(groundAt(plot, v.at.x), 6);
      expect(v.offsetPx).toBeLessThanOrEqual(-4);
      // Heading down into the ground, the line has nowhere to go.
      expect(plot?.layers.some((l) => l.id === "velocity")).toBe(false);
    });

    it("never draws the velocity line below the ground", () => {
      const plot = buildCrossSectionPlot(
        crossSection({
          aglMeters: 300,
          driftMeters: 0,
          ...strip(0, 300, 40, 60),
          verticalSpeed: 40,
          horizontalSpeed: 60,
        }),
      );
      const line = plot?.layers.find((l) => l.id === "velocity");
      if (line?.kind !== "series") throw new Error("expected the line");
      for (const p of line.points) {
        expect(p.y).toBeGreaterThanOrEqual(groundAt(plot, p.x) - 1e-6);
      }
    });

    it("lifts the mark only while it is within a few pixels of the ground", () => {
      const high = marker(shallow(3000), "vessel");
      expect(high.offsetPx ?? 0).toBe(0);
    });

    it("states plainly the stretch of the height when the site is too far off for the craft's height to read at equal scale", () => {
      for (const agl of [5400, 3000]) {
        const plot = shallow(agl);
        const e = exaggerationOf(plot);
        expect(e).toBeGreaterThan(1.5);
        const [yLo, yHi] = frameOf(plot).yDomain;
        const v = marker(plot, "vessel");
        // The craft is a readable share of the frame, not a few pixels over a flat line.
        expect((v.at.y - groundAt(plot, v.at.x)) / (yHi - yLo)).toBeGreaterThan(
          0.3,
        );
        const caption = plot?.layers.find(
          (l) => l.id === "vertical-exaggeration",
        );
        if (caption?.kind !== "caption") throw new Error("expected the label");
        expect(caption.text).toContain(`×${e.toFixed(1)}`);
      }
    });
  });

  describe("where the ground was not sampled", () => {
    const hatches = (plot: PlotEntry | null) =>
      (plot?.layers ?? []).filter(
        (l) => l.kind === "region" && l.hatched === true,
      );

    it("is hatched on both sides of the strip, from exactly where the strip ends", () => {
      // A strip 100 m wide under a craft 300 m up: the window passes both its ends.
      const plot = buildCrossSectionPlot(
        crossSection({
          aglMeters: 300,
          driftMeters: 0,
          groundDistances: [-50, 0, 50],
          groundElevations: [100, 100, 100],
        }),
      );
      const skyline = plot?.layers.find((l) => l.id === "skyline");
      if (skyline?.kind !== "series") throw new Error("expected the skyline");
      const left = plot?.layers.find((l) => l.id === "unsampled-left");
      const right = plot?.layers.find((l) => l.id === "unsampled-right");
      if (left?.kind !== "region" || right?.kind !== "region") {
        throw new Error("expected two hatched regions");
      }
      expect(left.boundary.every((p) => p.x === skyline.points[0].x)).toBe(
        true,
      );
      expect(
        right.boundary.every(
          (p) => p.x === skyline.points[skyline.points.length - 1].x,
        ),
      ).toBe(true);
      expect(hatches(plot).length).toBe(2);
      const [xLo, xHi] = frameOf(plot).xDomain;
      expect(skyline.points[0].x).toBeGreaterThan(xLo);
      expect(skyline.points[skyline.points.length - 1].x).toBeLessThan(xHi);
    });

    it("has ground under a craft in a shallow approach, with no hatching beneath it", () => {
      // 10 degrees below level at 1 km: the cone meets the ground only ahead, and the strip still starts behind the craft.
      const plot = buildCrossSectionPlot(
        crossSection({
          aglMeters: 1000,
          driftMeters: 0,
          ...strip(0, 1000, 17.36, 98.48),
          verticalSpeed: 17.36,
          horizontalSpeed: 98.48,
        }),
      );
      const vessel = plot?.layers.find((l) => l.id === "vessel");
      const skyline = plot?.layers.find((l) => l.id === "skyline");
      if (vessel?.kind !== "marker" || skyline?.kind !== "series") {
        throw new Error("expected the craft and the skyline");
      }
      expect(skyline.points[0].x).toBeLessThanOrEqual(vessel.at.x - 1000);
      const [xLo, xHi] = frameOf(plot).xDomain;
      expect(vessel.at.x).toBeGreaterThanOrEqual(xLo);
      expect(vessel.at.x).toBeLessThanOrEqual(xHi);
      expect(skyline.points[0].x).toBeLessThanOrEqual(xLo);
      expect(plot?.layers.some((l) => l.id === "unsampled-left")).toBe(false);
    });

    it("keeps the frame square and holds the craft and the site whatever the footprint", () => {
      for (const [descent, along] of [
        [100, 0],
        [60, 60],
        [10, 100],
        [0, 100],
        [-30, 80],
      ] as const) {
        const plot = buildCrossSectionPlot(
          crossSection({
            aglMeters: 800,
            driftMeters: 300,
            ...strip(300, 800, descent, along),
          }),
        );
        const [xLo, xHi] = frameOf(plot).xDomain;
        const [yLo, yHi] = frameOf(plot).yDomain;
        expect(xHi - xLo).toBeCloseTo(yHi - yLo, 6);
        const vessel = plot?.layers.find((l) => l.id === "vessel");
        const site = plot?.layers.find((l) => l.id === "site");
        if (vessel?.kind !== "marker" || site?.kind !== "marker") {
          throw new Error("expected the craft and the site");
        }
        for (const mark of [vessel, site]) {
          expect(mark.at.x).toBeGreaterThanOrEqual(xLo);
          expect(mark.at.x).toBeLessThanOrEqual(xHi);
        }
        expect(vessel.at.y).toBeLessThanOrEqual(yHi);
      }
    });
  });

  describe("a vessel above the window", () => {
    const high = (over: Partial<CrossSectionInputs>) =>
      buildCrossSectionPlot(
        crossSection({ aglMeters: 90_000, driftMeters: 70_000, ...over }),
      );
    const edgeOf = (plot: PlotEntry | null) => {
      const edge = plot?.layers.find((l) => l.id === "vessel-edge");
      if (edge?.kind !== "marker") throw new Error("expected an edge marker");
      return edge;
    };

    it("is held on the top edge of the frame, inside it, so the craft is always on the plot", () => {
      const plot = high({});
      const [xLo, xHi] = frameOf(plot).xDomain;
      const [, yHi] = frameOf(plot).yDomain;
      const edge = edgeOf(plot);
      expect(edge.shape).toBe("chevron-up");
      expect(edge.at.y).toBeLessThanOrEqual(yHi);
      expect(edge.at.y).toBeGreaterThan(yHi - (xHi - xLo) / 4);
      expect(edge.at.x).toBeGreaterThanOrEqual(xLo);
      expect(edge.at.x).toBeLessThanOrEqual(xHi);
    });

    it("says how high and how far upwind it really is, and the figures follow the fall", () => {
      const caption = (plot: PlotEntry | null) => {
        const c = plot?.layers.find((l) => l.id === "vessel-range");
        if (c?.kind !== "caption") throw new Error("expected a caption");
        return `${c.text} ${c.caption ?? ""}`;
      };
      const before = caption(high({ aglMeters: 90_000, driftMeters: 70_000 }));
      const after = caption(high({ aglMeters: 80_000, driftMeters: 60_000 }));
      expect(before).not.toBe(after);
      expect(before).toMatch(/90(\.0+)? km/);
    });

    it("hands over to the real marker once the vessel is inside the window", () => {
      const plot = buildCrossSectionPlot(crossSection({ aglMeters: 60 }));
      expect(plot?.layers.some((l) => l.id === "vessel-edge")).toBe(false);
      expect(plot?.layers.some((l) => l.id === "vessel-range")).toBe(false);
    });
  });

  it("puts the vessel at its real downrange displacement, upwind of the site", () => {
    const plot = buildCrossSectionPlot(crossSection({ driftMeters: 40 }));
    const vessel = plot?.layers.find((l) => l.id === "vessel");
    expect(vessel?.kind).toBe("marker");
    // Negative: the site is the origin and the vessel has yet to reach it.
    expect(vessel?.kind === "marker" && vessel.at.x).toBe(-40);
  });

  describe("the velocity line", () => {
    const line = (verticalSpeed: number, horizontalSpeed: number) => {
      const plot = buildCrossSectionPlot(
        crossSection({ verticalSpeed, horizontalSpeed }),
      );
      const velocity = plot?.layers.find((l) => l.id === "velocity");
      if (velocity?.kind !== "series") throw new Error("expected a series");
      const [xLo, xHi] = frameOf(plot).xDomain;
      const [yLo, yHi] = frameOf(plot).yDomain;
      const [from, to] = velocity.points;
      return {
        plot,
        dx: to.x - from.x,
        dy: to.y - from.y,
        /** Its length as a share of the frame, in the units the eye sees. */
        screen: Math.hypot(
          (to.x - from.x) / (xHi - xLo),
          (to.y - from.y) / (yHi - yLo),
        ),
        description: velocity.description,
      };
    };

    it("is ten seconds of travel while that is short, not an arbitrary length", () => {
      const v = line(0.8, 0.2);
      expect(v.dx).toBeCloseTo(0.2 * 10, 1);
      expect(v.dy).toBeCloseTo(-0.8 * 10, 1);
    });

    it("saturates: a fast craft's line grows without ever running past a share of the frame", () => {
      const lengths = [10, 50, 150, 500, 5000].map((s) => line(s, 0).screen);
      for (let i = 1; i < lengths.length; i++) {
        expect(lengths[i]).toBeGreaterThan(lengths[i - 1] - 1e-12);
      }
      expect(Math.max(...lengths)).toBeLessThanOrEqual(0.5 + 1e-9);
      // Past the knee the last decades add almost nothing.
      expect(lengths[4] - lengths[3]).toBeLessThan(0.03);
    });

    it("keeps its direction whatever the curve does to its length", () => {
      const slow = line(10, 20);
      const fast = line(1000, 2000);
      expect(fast.dy / fast.dx).toBeCloseTo(slow.dy / slow.dx, 6);
    });

    it("still names the real speeds, not the drawn length", () => {
      expect(line(1000, 2000).description).toMatch(/1000 m\/s/);
    });
  });

  it("contributes NOTHING without a ground strip", () => {
    expect(
      buildCrossSectionPlot(
        crossSection({ groundDistances: null, groundElevations: null }),
      ),
    ).toBeNull();
  });

  it("contributes NOTHING from a strip it cannot read honestly", () => {
    const { groundDistances, groundElevations } = strip(40);
    const holed = [...groundElevations];
    holed[4] = Number.NaN;
    expect(
      buildCrossSectionPlot(crossSection({ groundElevations: holed })),
    ).toBeNull();
    expect(
      buildCrossSectionPlot(
        crossSection({ groundElevations: groundElevations.slice(1) }),
      ),
    ).toBeNull();
    const shuffled = [...groundDistances];
    shuffled[3] = shuffled[2];
    expect(
      buildCrossSectionPlot(crossSection({ groundDistances: shuffled })),
    ).toBeNull();
  });

  it("states the site's elevation from the strip where the site falls along it", () => {
    const plot = buildCrossSectionPlot(crossSection({ driftMeters: 100 }));
    const site = plot?.layers.find((l) => l.id === "site");
    if (site?.kind !== "marker") throw new Error("expected a marker");
    // 100 m along a strip that rises 5 m per 100 m from 100 m.
    expect(site.at.x).toBe(0);
    expect(site.at.y).toBeCloseTo(105, 6);
  });

  it("contributes NOTHING high in an atmosphere, and everything low in one", () => {
    expect(
      buildCrossSectionPlot(
        crossSection({ hasAtmosphere: true, aglMeters: 35_000 }),
      ),
    ).toBeNull();
    expect(
      buildCrossSectionPlot(
        crossSection({ hasAtmosphere: true, aglMeters: 900 }),
      ),
    ).not.toBeNull();
  });

  describe("over an ocean", () => {
    /** A strip whose ground is the sea floor, 140 m below the surface, rising to a shore at the far end. */
    const floor = {
      groundDistances: [-500, -250, 0, 250, 500, 750, 1000, 1250],
      groundElevations: [-140, -140, -140, -140, -100, -40, 10, 40],
    };
    const over = (hasOcean: boolean | undefined) =>
      buildCrossSectionPlot(
        crossSection({
          ...floor,
          aglMeters: 300,
          driftMeters: 0,
          hasOcean,
        }),
      );
    const vesselY = (plot: PlotEntry | null) => {
      const v = plot?.layers.find((l) => l.id === "vessel");
      if (v?.kind !== "marker") throw new Error("expected the vessel");
      return v.at.y;
    };

    it("puts the craft at its height above the water, not above the sea floor", () => {
      expect(vesselY(over(true))).toBeCloseTo(300, 6);
    });

    it("leaves the craft above the floor when the body is not known to have an ocean", () => {
      expect(vesselY(over(undefined))).toBeCloseTo(-140 + 300, 6);
      expect(vesselY(over(false))).toBeCloseTo(-140 + 300, 6);
    });

    it("draws the ground no lower than the surface, so the sea is a flat line at 0", () => {
      const sky = over(true)?.layers.find((l) => l.id === "skyline");
      if (sky?.kind !== "series") throw new Error("expected the skyline");
      expect(Math.min(...sky.points.map((p) => p.y))).toBeGreaterThanOrEqual(0);
      // The shore, above the surface, is untouched.
      expect(Math.max(...sky.points.map((p) => p.y))).toBeCloseTo(40, 6);
    });

    it("fills the water, only where the strip was under it", () => {
      const sea = over(true)?.layers.filter((l) => l.id.startsWith("sea"));
      expect(sea?.length).toBeGreaterThan(0);
      for (const l of sea ?? []) {
        expect(l.kind).toBe("region");
        expect(l.tone).toBe("info");
      }
      expect(
        (over(undefined)?.layers ?? []).some((l) => l.id.startsWith("sea")),
      ).toBe(false);
    });

    describe("its moving surface", () => {
      const SEA = {
        siteOnBody: { east: 98_765, north: -4_321 },
        bearingDeg: 90,
        gravity: 9.81,
      };
      const withSea = (sea: CrossSectionInputs["sea"] = SEA) =>
        buildCrossSectionPlot(
          crossSection({
            ...floor,
            aglMeters: 300,
            driftMeters: 0,
            hasOcean: true,
            sea,
          }),
        );
      const watersOf = (plot: PlotEntry | null) =>
        (plot?.layers ?? []).flatMap((l) => (l.kind === "water" ? [l] : []));

      it("draws each stretch of sea as water seen from the side, fixed to the body, on its gravity, under one name", () => {
        const plot = withSea();
        const waters = watersOf(plot);
        expect(waters.length).toBe(1);
        const [w] = waters;
        expect(w.view).toBe("section");
        expect(w.origin).toEqual(SEA.siteOnBody);
        expect(w.bearingDeg).toBe(90);
        expect(w.gravity).toBe(9.81);
        expect(w.tone).toBe("info");
        // From the shore sample behind the sea to the one at the shore, down to the frame's floor and a little above the still surface for the crests.
        expect(w.bounds.x1).toBeLessThanOrEqual(1000);
        expect(w.bounds.y0).toBe(frameOf(plot).yDomain[0]);
        expect(w.bounds.y1).toBeGreaterThan(0);
        expect(w.description).toContain("sea");
        expect(
          (plot?.layers ?? []).some(
            (l) => l.kind === "region" && l.id.startsWith("sea"),
          ),
        ).toBe(false);
      });

      it("samples its waterline at the ground strip's own points, so it steps as the ground line does", () => {
        const [w] = watersOf(withSea());
        const sky = withSea()?.layers.find((l) => l.id === "ground");
        if (sky?.kind !== "region") throw new Error("expected the ground");
        const groundXs = new Set(sky.boundary.map((p) => p.x));
        expect(w.samples?.length).toBeGreaterThan(1);
        for (const x of w.samples ?? []) expect(groundXs.has(x)).toBe(true);
        expect(w.samples?.[0]).toBe(w.bounds.x0);
        expect(w.samples?.at(-1)).toBe(w.bounds.x1);
      });

      it("runs the terrain line over the land only, so no flat line lies across the moving water", () => {
        const sky = (withSea()?.layers ?? []).filter(
          (l) => l.kind === "series" && l.id.startsWith("skyline"),
        );
        expect(sky.length).toBeGreaterThan(0);
        for (const l of sky) {
          if (l.kind !== "series") continue;
          // Only the shore sample beside the land may sit on the surface.
          expect(l.points.filter((p) => p.y === 0).length).toBeLessThanOrEqual(
            1,
          );
        }
      });

      it("takes the body's own liquid colour, and none where the body gives none", () => {
        expect(
          watersOf(withSea({ ...SEA, liquidColor: "#AD94BE" }))[0].tint,
        ).toBe("#AD94BE");
        expect(watersOf(withSea())[0].tint).toBeUndefined();
      });

      it("falls back to a flat fill when the body's gravity or the site's place is not known", () => {
        const plot = withSea(null);
        expect(watersOf(plot)).toEqual([]);
        expect(
          (plot?.layers ?? []).some(
            (l) => l.kind === "region" && l.id === "sea-1",
          ),
        ).toBe(true);
      });
    });

    it("changes nothing over land", () => {
      const land = buildCrossSectionPlot(
        crossSection({ aglMeters: 300, driftMeters: 40, hasOcean: true }),
      );
      const plain = buildCrossSectionPlot(
        crossSection({ aglMeters: 300, driftMeters: 40 }),
      );
      expect(land).toEqual(plain);
    });
  });

  describe("the burn that is lit now", () => {
    const withBurn = (burnAccel: { up: number; along: number } | null) =>
      buildCrossSectionPlot(
        crossSection({
          aglMeters: 300,
          driftMeters: 0,
          verticalSpeed: 8,
          horizontalSpeed: 2,
          burnAccel,
        }),
      );
    const flameOf = (plot: PlotEntry | null) => {
      const l = plot?.layers.find((x) => x.id === "burn");
      return l?.kind === "region" ? l : null;
    };
    /** The flame's outline as the eye sees it: each corner as a share of the frame, the craft at the origin. */
    const outline = (plot: PlotEntry | null) => {
      const flame = flameOf(plot);
      const vessel = plot?.layers.find((x) => x.id === "vessel");
      if (!flame || vessel?.kind !== "marker") throw new Error("expected both");
      const [xLo, xHi] = frameOf(plot).xDomain;
      const [yLo, yHi] = frameOf(plot).yDomain;
      const high = flame.boundaryHigh ?? [];
      return [...flame.boundary, ...high].map((p) => ({
        x: (p.x - vessel.at.x) / (xHi - xLo),
        y: (p.y - vessel.at.y) / (yHi - yLo),
      }));
    };
    const tip = (plot: PlotEntry | null) => {
      const pts = outline(plot);
      return pts.reduce((far, p) =>
        Math.hypot(p.x, p.y) > Math.hypot(far.x, far.y) ? p : far,
      );
    };
    const length = (plot: PlotEntry | null) =>
      Math.hypot(tip(plot).x, tip(plot).y);

    it("is a flame, a filled pointed shape, drawn from the craft", () => {
      const flame = flameOf(withBurn({ up: 3.6, along: 0 }));
      if (!flame) throw new Error("expected the flame");
      expect(flame.side).toBe("between");
      expect(flame.tone).toBe("warn");
      expect(flame.boundary.length).toBeGreaterThanOrEqual(3);
    });

    it("points the way the engine must fire: opposite to the burn's effect", () => {
      // The effect is up and back, so the flame goes down and forward.
      const t = tip(withBurn({ up: 3.0, along: -1.5 }));
      expect(t.y).toBeLessThan(0);
      expect(t.x).toBeGreaterThan(0);
      expect(t.y / t.x).toBeCloseTo(-2, 6);
      // Straight up effect: the flame points straight down.
      const down = tip(withBurn({ up: 3.6, along: 0 }));
      expect(down.x).toBeCloseTo(0, 6);
      expect(down.y).toBeLessThan(0);
    });

    it("is short: never longer than twice the vessel icon, and still there at its smallest", () => {
      // The icon is about 4.5% of the frame across, and the flame starts at its edge.
      const ICON = 0.045;
      const lengths = [0.01, 0.5, 3.6, 30, 3000].map(
        (a) => length(withBurn({ up: a, along: 0 })) - ICON / 2,
      );
      expect(Math.max(...lengths)).toBeLessThanOrEqual(2 * ICON + 1e-9);
      expect(Math.min(...lengths)).toBeGreaterThan(0.005);
      // It grows with the burn and saturates.
      for (let i = 1; i < lengths.length; i++) {
        expect(lengths[i]).toBeGreaterThanOrEqual(lengths[i - 1] - 1e-12);
      }
      expect(lengths[4] - lengths[3]).toBeLessThan(0.01);
    });

    it("fires along the velocity line when the burn is purely retrograde, whatever the frame's stretch", () => {
      // Moving 60 m/s ahead and 40 m/s down, a retrograde burn pushes back and up in that ratio, so its exhaust runs along the velocity.
      for (const site of [60, 6000]) {
        const plot = buildCrossSectionPlot(
          crossSection({
            aglMeters: 300,
            driftMeters: site,
            verticalSpeed: 40,
            horizontalSpeed: 60,
            burnAccel: { up: 2.4, along: -3.6 },
          }),
        );
        const velocity = plot?.layers.find((l) => l.id === "velocity");
        if (velocity?.kind !== "series") throw new Error("expected the line");
        const [xLo, xHi] = frameOf(plot).xDomain;
        const [yLo, yHi] = frameOf(plot).yDomain;
        const [from, to] = velocity.points;
        const line = {
          x: (to.x - from.x) / (xHi - xLo),
          y: (to.y - from.y) / (yHi - yLo),
        };
        const flame = tip(plot);
        // The same direction on the screen: the cross product of the two vanishes and they point the same way.
        expect(flame.x * line.y - flame.y * line.x).toBeCloseTo(0, 9);
        expect(flame.x * line.x + flame.y * line.y).toBeGreaterThan(0);
      }
    });

    it("is drawn under the velocity line, so neither hides the other", () => {
      const plot = withBurn({ up: 3.6, along: 0 });
      const ids = (plot?.layers ?? []).map((l) => l.id);
      expect(ids.indexOf("burn")).toBeLessThan(ids.indexOf("velocity"));
    });

    it("is not drawn when the burn is unknown or off", () => {
      expect(flameOf(withBurn(null))).toBeNull();
      expect(flameOf(withBurn({ up: 0, along: 0 }))).toBeNull();
      expect(
        flameOf(buildCrossSectionPlot(crossSection({ aglMeters: 300 }))),
      ).toBeNull();
    });

    it("keeps the real acceleration in its name", () => {
      const l = withBurn({ up: 3.6, along: 0 })?.layers.find(
        (x) => x.id === "burn",
      );
      expect(l?.description).toMatch(/36 m\/s/);
    });
  });

  it("omits the velocity vector rather than drawing a zero-length one", () => {
    const plot = buildCrossSectionPlot(
      crossSection({ verticalSpeed: 0, horizontalSpeed: 0 }),
    );
    expect(plot?.layers.some((l) => l.id === "velocity")).toBe(false);
  });
});

/** The strip's distances in a committed scene, read through type guards: a scene is JSON of no declared shape. */
function trackOf(scene: unknown): number[] | null {
  if (!isRecord(scene) || !isRecord(scene._stream)) return null;
  const emits = scene._stream.emits;
  if (!Array.isArray(emits)) return null;
  for (const emit of emits) {
    if (!isRecord(emit) || emit.channel !== "vessel.landing") continue;
    const landing = emit.value;
    if (!isRecord(landing)) return null;
    const d = landing.groundTrackDistances;
    return Array.isArray(d) && d.every((n) => typeof n === "number") ? d : null;
  }
  return null;
}

describe("the craft below the readouts", () => {
  /** The corner readouts take the top fifth of the plot, so the craft must sit below it at every height, however far the site and however stretched the frame. */
  const READOUT_BAND = 0.2;
  const share = (plot: PlotEntry | null) => {
    const v = plot?.layers.find((l) => l.id === "vessel");
    if (v?.kind !== "marker") throw new Error("expected the vessel");
    const [yLo, yHi] = frameOf(plot).yDomain;
    return (v.at.y - yLo) / (yHi - yLo);
  };

  it.each([
    [8000, 0],
    [8000, 6000],
    [3000, 30_000],
    [1000, 800],
    [300, 250],
    [226.6, 60],
    [60, 20],
    [5, 0],
  ])("keeps the craft out of the top fifth at %f m up with the site %f m off", (agl, drift) => {
    const plot = buildCrossSectionPlot(
      crossSection({ aglMeters: agl, driftMeters: drift }),
    );
    expect(share(plot)).toBeLessThanOrEqual(1 - READOUT_BAND + 1e-9);
  });

  it("keeps it there over an ocean and with a burn lit", () => {
    for (const hasOcean of [true, false]) {
      const plot = buildCrossSectionPlot(
        crossSection({
          aglMeters: 3000,
          driftMeters: 1500,
          hasOcean,
          burnAccel: { up: 2, along: -2 },
        }),
      );
      expect(share(plot)).toBeLessThanOrEqual(1 - READOUT_BAND + 1e-9);
    }
  });
});

describe("room around the craft and the site", () => {
  /** Where a mark sits across a plot, 0 at its left edge and 1 at its right. */
  const across = (plot: PlotEntry | null, id: string) => {
    const m = plot?.layers.find((l) => l.id === id);
    if (m?.kind !== "marker") throw new Error(`expected the ${id}`);
    const [xLo, xHi] = frameOf(plot).xDomain;
    return (m.at.x - xLo) / (xHi - xLo);
  };

  it.each([
    [5000, 3000],
    [300, 5000],
    [1000, 8000],
    [3000, 30_000],
  ])("keeps the craft and the site off the cross-section's edges at %f m up with the site %f m off", (agl, drift) => {
    const plot = buildCrossSectionPlot(
      crossSection({ aglMeters: agl, driftMeters: drift }),
    );
    expect(across(plot, "vessel")).toBeGreaterThanOrEqual(0.12);
    expect(across(plot, "site")).toBeLessThanOrEqual(0.88);
  });

  it.each([
    [5000, 4000],
    [300, 5000],
    [1000, 8000],
    [3000, 30_000],
  ])("holds the site at the middle of the touchdown view at %f m up with the site %f m off", (agl, drift) => {
    const plot = buildVesselViewPlot(
      reticle({ aglMeters: agl, driftMeters: drift, driftBearingDeg: 90 }),
    );
    const site = plot?.layers.find((l) => l.id === "site");
    if (site?.kind !== "marker") throw new Error("expected the site");
    expect(site.at.x).toBeCloseTo(0, 6);
    expect(site.at.y).toBeCloseTo(0, 6);
  });
});

describe("the ground strip the mod sends", () => {
  const HERE = dirname(fileURLToPath(import.meta.url));

  it.each([
    [1000, 100, 0, 0],
    [1000, 50, 50, 800],
    [1000, 17.36, 98.48, 0],
    [1000, 0, 100, 25_000],
    [1000, -30, 80, 25_000],
    [3000, 3, 5, 40],
    [2, 3, 5, 0],
    [50_000, 200, 1000, 200_000],
  ])("holds the ground beneath the craft and a margin behind it, whatever the approach: %f m, %f down, %f across, site %f m", (height, down, along, site) => {
    const f = coneFootprint(height, down, along, 200_000);
    const e = trackExtent(f.behind, f.ahead, height, site);
    const d = groundTrackDistances(e.behind, e.ahead);
    expect(d[0]).toBeLessThanOrEqual(-Math.max(height, 120) + 1e-9);
    expect(d[d.length - 1]).toBeGreaterThanOrEqual(site * 1.1 - 1e-9);
  });

  it("starts at or behind the craft in every committed scene", () => {
    const dirs = readdirSync(HERE).filter((n) => n.startsWith("__"));
    let seen = 0;
    for (const dir of dirs) {
      for (const file of readdirSync(resolve(HERE, dir)).filter((n) =>
        n.endsWith(".json"),
      )) {
        const d = trackOf(
          JSON.parse(readFileSync(resolve(HERE, dir, file), "utf8")),
        );
        if (!d) continue;
        seen++;
        expect(d[0], `${dir}/${file}`).toBeLessThanOrEqual(-100);
        expect(d[d.length - 1], `${dir}/${file}`).toBeGreaterThan(0);
      }
    }
    expect(seen).toBeGreaterThan(15);
  });
});

describe("touchdown view plot", () => {
  /** A flat grid at `ground` with a wall of `wall` metres more across it at east `at`. */
  const gridWith = (ground: number, wall = 0, at = -150, half = 400) => {
    const size = 24;
    const cell = (2 * half) / size;
    return {
      siteHeights: Array.from({ length: size * size }, (_, i) => {
        const x = -half + ((i % size) + 0.5) * cell;
        return ground + (Math.abs(x - at) < cell ? wall : 0);
      }),
      siteHeightsSize: size,
      siteHeightsExtentMeters: 2 * half,
    };
  };
  /** A craft 60 m up and 300 m west of the site, looking east at it. */
  const low = (over: Partial<TouchdownViewInputs> = {}) =>
    reticle({
      driftMeters: 300,
      driftBearingDeg: 90,
      aglMeters: 60,
      altitudeAsl: 160,
      siteElevation: 100,
      ...gridWith(100),
      ...over,
    });
  const ids = (plot: PlotEntry | null) => (plot?.layers ?? []).map((l) => l.id);

  it("places every point of the ring at its true ground position and projects it through the camera", () => {
    // A wall across the ring: the ring rides up it, so a flat circle nudged would not match.
    const inputs = low({ ...gridWith(100, 40, 20, 400), aglMeters: 120 });
    const scene = touchdownScene(inputs);
    if (!scene) throw new Error("expected a scene");
    const radius = inputs.zoneRadiusMeters ?? 0;
    const expected = zoneRing(scene, radius, 72).flatMap(([x, y]) => {
      const at = scene.camera.project(scene.groundAt(x, y));
      return at ? [at] : [];
    });
    const drawn = (buildVesselViewPlot(inputs)?.layers ?? [])
      .filter((l) => l.id.startsWith("landing-zone"))
      .flatMap((l) => (l.kind === "series" ? l.points : []));
    expect(drawn.length).toBeGreaterThan(30);
    for (const p of drawn) {
      expect(
        expected.some((e) => Math.hypot(e.x - p.x, e.y - p.y) < 1e-9),
      ).toBe(true);
    }
    // The wall lifts part of the ring: its points do not all lie at the site's height.
    const heights = zoneRing(scene, radius, 72).map(
      ([x, y]) => scene.groundAt(x, y)[2],
    );
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(5);
  });

  it("is a screen: both axes the same, from one edge to the other", () => {
    const frame = frameOf(buildVesselViewPlot(low()));
    expect(frame.kind).toBe("spatial");
    expect(frame.xDomain).toEqual([-1, 1]);
    expect(frame.yDomain).toEqual([-1, 1]);
  });

  it("narrows its field of view as the craft comes down", () => {
    const fov = (agl: number) => viewFovDegrees(agl);
    expect(fov(8000)).toBeGreaterThan(fov(1000));
    expect(fov(1000)).toBeGreaterThan(fov(100));
    expect(fov(0)).toBe(VIEW_FOV_FLOOR_DEG);
    const caption = buildVesselViewPlot(low())?.layers.find(
      (l) => l.id === "fov",
    );
    expect(caption?.kind === "caption" && caption.text).toContain("FOV");
  });

  it("draws the ground, the ring, the site and the track when nothing stands in the way", () => {
    const plot = buildVesselViewPlot(low());
    expect(ids(plot)).toEqual(
      expect.arrayContaining(["terrain", "landing-zone", "drift", "site"]),
    );
    expect(ids(plot).filter((id) => id.includes("hidden"))).toEqual([]);
  });

  it("draws what a ridge between the craft and the site hides faint, not left out", () => {
    const plot = buildVesselViewPlot(low(gridWith(100, 200, -150)));
    expect(ids(plot)).toContain("landing-zone-hidden");
    const site = plot?.layers.find((l) => l.id === "site");
    expect(site?.kind === "marker" && site.tone).toBe("neutral");
    const hidden = plot?.layers.find((l) => l.id === "landing-zone-hidden");
    expect(hidden?.kind === "series" && hidden.dashed).toBe(true);
  });

  it("shows the site again once the craft has risen clear of the ridge", () => {
    const plot = buildVesselViewPlot(
      low({ ...gridWith(100, 200, -150), altitudeAsl: 900, aglMeters: 800 }),
    );
    const site = plot?.layers.find((l) => l.id === "site");
    expect(site?.kind === "marker" && site.tone).toBe("info");
  });

  it("draws the skyline without letting a mountain beyond the site hide the site", () => {
    // Terrain at 12 degrees above the level on every bearing is farther than anything the plot marks.
    const sky = Array.from({ length: 72 }, () => 12);
    const plot = buildVesselViewPlot(low({ horizonAngles: sky }));
    const site = plot?.layers.find((l) => l.id === "site");
    expect(site?.kind === "marker" && site.tone).toBe("info");
    expect(ids(plot)).toContain("skyline");
  });

  it("puts the horizon and sky in the top half and the near ground in the bottom half of the view", () => {
    // A craft 600 m up looking obliquely at a site 2 km away, over ground with a mountain beyond the site: far ground and sky lie ahead, the near ground below.
    const size = 24;
    const half = 3000;
    const plot = buildVesselViewPlot(
      reticle({
        driftMeters: 2000,
        driftBearingDeg: 90,
        aglMeters: 600,
        altitudeAsl: 700,
        siteElevation: 100,
        horizonAngles: Array.from({ length: 72 }, () => -2),
        siteHeights: Array.from({ length: size * size }, (_, i) => {
          const x = -half + ((i % size) + 0.5) * ((2 * half) / size);
          return x > 500 ? 600 : 100;
        }),
        siteHeightsSize: size,
        siteHeightsExtentMeters: 2 * half,
      }),
    );
    const terrain = plot?.layers.find((l) => l.id === "terrain");
    if (terrain?.kind !== "relief" || !terrain.veil) {
      throw new Error("expected a veiled relief");
    }
    const veil = terrain.veil;
    const n = terrain.size;
    // The relief's first row is the foot of the plot, so a larger row is higher in the view.
    const meanRow = (veiled: boolean) => {
      const rows = veil
        .map((v, i) => ({ v, row: Math.floor(i / n) }))
        .filter((c) => (c.v !== 0) === veiled)
        .map((c) => c.row);
      return rows.reduce((a, b) => a + b, 0) / Math.max(1, rows.length);
    };
    expect(meanRow(true)).toBeGreaterThan(n / 2);
    expect(meanRow(false)).toBeLessThan(n / 2);
    // The site is ahead and below the craft, on the way to the horizon: its cross sits in the middle of the view, the mountain's skyline above it.
    const skyline = plot?.layers.find((l) => l.id === "skyline");
    if (skyline?.kind !== "series") throw new Error("expected the skyline");
    expect(Math.max(...skyline.points.map((p) => p.y))).toBeGreaterThan(0);
  });

  it("draws no skyline without a profile", () => {
    expect(ids(buildVesselViewPlot(low()))).not.toContain("skyline");
  });

  it("holds the ground at the surface over the sea", () => {
    const plot = buildVesselViewPlot(
      low({ ...gridWith(-80), siteElevation: -80, hasOcean: true }),
    );
    // Every cell of the raster is the same height: the sea's surface, whatever the floor.
    const terrain = plot?.layers.find((l) => l.id === "terrain");
    const values = terrain?.kind === "relief" ? terrain.values : [];
    const hit = values.filter((v) => v === 0);
    expect(hit.length).toBeGreaterThan(0);
  });

  it("draws no plot without a site to look at or a height to look from", () => {
    expect(buildVesselViewPlot(low({ driftMeters: null }))).toBeNull();
    expect(
      buildVesselViewPlot(
        low({ altitudeAsl: null, siteElevation: null, siteHeights: null }),
      ),
    ).toBeNull();
  });

  it("marks where a crashed craft came down, with the unknown stretch dashed", () => {
    const plot = buildVesselViewPlot(
      low({ impact: { distanceMeters: 250, bearingDeg: 90 } }),
    );
    expect(ids(plot)).toEqual(
      expect.arrayContaining(["unknown-path", "impact"]),
    );
  });

  it("opens the touchdown map wide enough to hold the crash site beside the prediction", () => {
    // A craft a few metres up has a small map, and the crash site lies well outside it.
    const grounded = {
      aglMeters: 12,
      altitudeAsl: 112,
      siteElevation: 100,
      driftMeters: 8,
    };
    const near = buildTouchdownReticlePlot(low(grounded));
    const crashed = buildTouchdownReticlePlot(
      low({ ...grounded, impact: { distanceMeters: 90, bearingDeg: 90 } }),
    );
    const impactAt = crashed?.layers.find((l) => l.id === "impact");
    if (impactAt?.kind !== "marker" || !crashed?.frame || !near?.frame) {
      throw new Error("expected the impact marker and both maps");
    }
    const [x0, x1] = crashed.frame.xDomain;
    const [y0, y1] = crashed.frame.yDomain;
    expect(impactAt.at.x).toBeGreaterThan(x0);
    expect(impactAt.at.x).toBeLessThan(x1);
    expect(impactAt.at.y).toBeGreaterThan(y0);
    expect(impactAt.at.y).toBeLessThan(y1);
    expect(x1 - x0).toBeGreaterThan(
      near.frame.xDomain[1] - near.frame.xDomain[0],
    );
  });

  describe("the dispersion ring", () => {
    it("is the prediction's uncertainty: it narrows as the sideways travel still to come is spent, to a floor at touchdown", () => {
      // A coasting craft 100 m/s sideways, its fall time falling as it comes down, then the speed spent on the last stretch.
      const descent = [
        { horizontalSpeed: 100, timeToImpact: 60 },
        { horizontalSpeed: 100, timeToImpact: 30 },
        { horizontalSpeed: 40, timeToImpact: 20 },
        { horizontalSpeed: 2, timeToImpact: 10 },
        { horizontalSpeed: 0, timeToImpact: 5 },
      ];
      const radii = descent.map((d) =>
        dispersionRadiusMeters({ sampled: true, heightMeters: null, ...d }),
      );
      for (let i = 1; i < radii.length; i++) {
        expect(radii[i]).toBeLessThan(radii[i - 1] ?? 0);
      }
      const floor = dispersionRadiusMeters({
        sampled: true,
        heightMeters: 0,
        horizontalSpeed: 0,
        timeToImpact: 0,
      });
      expect(radii.at(-1)).toBe(floor);
      expect(floor).toBeGreaterThan(0);
      // Never the terrain's sampling footprint: a 100 m roughness patch says nothing about where the legs come down.
      expect(floor).toBeLessThan(30);
    });

    it("keeps narrowing with the height still to fall when nothing moves sideways", () => {
      const radius = (heightMeters: number) =>
        dispersionRadiusMeters({
          sampled: true,
          heightMeters,
          horizontalSpeed: 0,
          timeToImpact: null,
        });
      expect(radius(2000) ?? 0).toBeGreaterThan(radius(500) ?? 0);
      expect(radius(500) ?? 0).toBeGreaterThan(radius(50) ?? 0);
      expect(radius(50)).toBeGreaterThan(radius(0) ?? 0);
    });

    it("is nothing when no site was sampled", () => {
      expect(
        dispersionRadiusMeters({
          sampled: false,
          heightMeters: 100,
          horizontalSpeed: 10,
          timeToImpact: 10,
        }),
      ).toBeNull();
    });
  });

  it("names the slope and the biome only when it has them", () => {
    const known = buildVesselViewPlot(reticle());
    const site = known?.layers.find((l) => l.id === "site");
    expect(site?.description).toContain("Midlands");
    expect(site?.description).toMatch(/9\.0°/);

    const unknown = buildVesselViewPlot(reticle({ slope: null, biome: null }));
    const bareSite = unknown?.layers.find((l) => l.id === "site");
    // An absent slope is NOT a flat site, so nothing is said about one.
    expect(bareSite?.description).toBe("predicted touchdown site");
  });
});

describe("touchdown map, the projection of the view", () => {
  const size = 24;
  const half = 400;
  const cell = (2 * half) / size;
  const gridWith = (wall = 0, at = -150) => ({
    siteHeights: Array.from({ length: size * size }, (_, i) => {
      const x = -half + ((i % size) + 0.5) * cell;
      return 100 + (Math.abs(x - at) < cell ? wall : 0);
    }),
    siteHeightsSize: size,
    siteHeightsExtentMeters: 2 * half,
  });
  const low = (over: Partial<TouchdownViewInputs> = {}) =>
    reticle({
      driftMeters: 300,
      driftBearingDeg: 90,
      aglMeters: 60,
      altitudeAsl: 160,
      siteElevation: 100,
      ...gridWith(),
      ...over,
    });
  const ids = (plot: PlotEntry | null) => (plot?.layers ?? []).map((l) => l.id);

  const relief = (plot: PlotEntry | null) => {
    const layer = plot?.layers.find((l) => l.id === "terrain");
    if (layer?.kind !== "relief") throw new Error("expected the relief");
    return layer;
  };

  it("outlines the frame's footprint and veils the ground outside it, keeping the relief and its colours under it", () => {
    const plot = buildTouchdownReticlePlot(low());
    expect(ids(plot)).toContain("frame");
    const terrain = relief(plot);
    expect(terrain.veil?.some((v) => v === VEIL_OUTSIDE)).toBe(true);
    expect(terrain.veil?.some((v) => v === VEIL_NONE)).toBe(true);
    // The heights are untouched by the veil: the ground keeps the colour its height gives it.
    expect(new Set(terrain.values).size).toBeGreaterThan(0);
  });

  it("darkens the ground behind a ridge as hidden, and none when nothing is in the way", () => {
    const hidden = (plot: PlotEntry | null) =>
      relief(plot).veil?.filter((v) => v === VEIL_HIDDEN).length ?? 0;
    expect(hidden(buildTouchdownReticlePlot(low()))).toBe(0);
    expect(
      hidden(buildTouchdownReticlePlot(low(gridWith(45, -150)))),
    ).toBeGreaterThan(0);
  });

  it("colours by absolute height in the same bands as the view, whatever else the grid holds", () => {
    const bandOf = (l: PlotLayer | undefined) =>
      l?.kind === "relief" ? l.bandMetres : undefined;
    const withRidge = low(gridWith(200, -150));
    const flat = low();
    for (const inputs of [withRidge, flat]) {
      const map = relief(buildTouchdownReticlePlot(inputs));
      const view = buildVesselViewPlot(inputs)?.layers.find(
        (l) => l.id === "terrain",
      );
      expect(bandOf(view)).toBeGreaterThan(0);
      expect(bandOf(view)).toBe(map.bandMetres);
    }
  });

  it("draws the ring, the site and the track as the view does", () => {
    const mark = (plot: PlotEntry | null, id: string) =>
      plot?.layers.find((l) => l.id === id);
    const map = buildTouchdownReticlePlot(low());
    const view = buildVesselViewPlot(low());
    for (const id of ["landing-zone", "drift"]) {
      const a = mark(map, id);
      const b = mark(view, id);
      expect(a?.kind === "series" && b?.kind === "series").toBe(true);
      if (a?.kind === "series" && b?.kind === "series") {
        expect([a.tone, a.dashed ?? false, a.weight]).toEqual([
          b.tone,
          b.dashed ?? false,
          b.weight,
        ]);
      }
    }
    const a = mark(map, "site");
    const b = mark(view, "site");
    expect(a?.kind === "marker" && a.tone).toBe(b?.kind === "marker" && b.tone);
  });

  it("points the map the way the craft looks, with the site ahead, and marks bearings in degrees", () => {
    const plot = buildTouchdownReticlePlot(low());
    const at = (id: string) => {
      const m = plot?.layers.find((l) => l.id === id);
      if (m?.kind !== "marker") throw new Error(`expected the ${id}`);
      return m.at;
    };
    // Heading east: the craft is behind the site on the same line, so on the map the site is straight above it.
    expect(at("site").x).toBeCloseTo(at("vessel").x, 6);
    expect(at("site").y).toBeGreaterThan(at("vessel").y);
    // North is to the left of a map that points east, and 090 is straight up.
    expect(at("bearing-0").x).toBeLessThan(0);
    expect(at("bearing-90").x).toBeCloseTo(0, 6);
    expect(at("bearing-90").y).toBeGreaterThan(0);
    const label = plot?.layers.find((l) => l.id === "bearing-90");
    expect(label?.kind === "marker" && label.label).toBe("090°");
    // The numbers stand alone: no ring or dot is drawn round a bearing.
    expect(label?.kind === "marker" && label.shape).toBe("none");
    const heading = plot?.layers.find((l) => l.id === "heading");
    expect(heading?.kind === "caption" && heading.text).toBe("HDG 090°");
  });

  it("draws ground to the north at the top of a map that points north, not mirrored", () => {
    const size = 24;
    // The grid's first rows are its northern edge: high ground to the north, low to the south.
    const siteHeights = Array.from({ length: size * size }, (_, i) =>
      Math.floor(i / size) < size / 2 ? 200 : 100,
    );
    const plot = buildTouchdownReticlePlot(
      reticle({
        driftBearingDeg: 0,
        driftMeters: 100,
        altitudeAsl: 300,
        siteElevation: 150,
        aglMeters: 150,
        siteHeights,
        siteHeightsSize: size,
        siteHeightsExtentMeters: 400,
      }),
    );
    const relief = plot?.layers.find((l) => l.id === "terrain");
    if (relief?.kind !== "relief") throw new Error("expected the ground");
    const n = relief.size;
    const row = (r: number) => relief.values.slice(r * n, (r + 1) * n);
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    // The relief layer's first row is the foot of the map.
    expect(mean(row(n - 1))).toBeGreaterThan(mean(row(0)));
  });

  it("fills the map's set share with the frame's footprint at each height, more of it near the ground", () => {
    for (const agl of [60, 200, 600]) {
      const plot = buildTouchdownReticlePlot(
        low({ aglMeters: agl, altitudeAsl: 100 + agl, driftMeters: 100 }),
      );
      const frame = plot?.layers.find((l) => l.id === "frame");
      if (frame?.kind !== "series") throw new Error("expected the frame");
      const xs = frame.points.map((p) => p.x);
      const ys = frame.points.map((p) => p.y);
      const across = Math.max(
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
      );
      const [x0, x1] = frameOf(plot).xDomain;
      expect(across / (x1 - x0), `at ${agl} m`).toBeCloseTo(
        mapFootprintShare(agl),
        2,
      );
    }
  });

  it("closes in with the field of view through the whole descent, never zooming out", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const f of integrate({})) {
      if (f.landed) continue;
      const g = MU / (R + f.aglMeters) ** 2;
      const drift = ballisticDrift(f.aglMeters, f.vDown, f.vHoriz, g);
      const fall =
        (-f.vDown + Math.sqrt(f.vDown ** 2 + 2 * g * f.aglMeters)) / g;
      const halfExtent = siteGridHalfExtent(drift, f.aglMeters);
      const plot = buildTouchdownReticlePlot(
        reticle({
          zoneRadiusMeters: dispersionRadiusMeters({
            sampled: true,
            heightMeters: f.aglMeters,
            horizontalSpeed: f.vHoriz,
            timeToImpact: fall,
          }),
          aglMeters: f.aglMeters,
          altitudeAsl: 120 + f.aglMeters,
          siteElevation: 120,
          driftMeters: Math.max(drift, 0.01),
          driftBearingDeg: 90,
          siteHeights: siteGridHeights(halfExtent, 120, STORY_RELIEF),
          siteHeightsSize: 24,
          siteHeightsExtentMeters: 2 * halfExtent,
        }),
      );
      const [x0, x1] = frameOf(plot).xDomain;
      expect(x1 - x0, `at ${f.aglMeters.toFixed(0)} m`).toBeLessThanOrEqual(
        previous * 1.02,
      );
      previous = Math.min(previous, x1 - x0);
    }
    expect(previous).toBeLessThan(60);
  });
});

/** The three plots driven through the contributions the widget mounts, where the body's radius and gravity are actually resolved. */
describe("the body a contribution resolves", () => {
  // Without the stock table registered, a table hit and a table miss both come back empty and the comparison proves nothing.
  registerStockBodies();

  /** RSS's name for Kerbin, and the physical facts the stream reports for it. */
  const EARTH = {
    index: 1,
    name: "Earth",
    radius: value("m", 6_371_000),
    gravParameter: value("m³/s²", 3.986004418e14),
    surfaceGravity: value("g", 1),
    atmosphere: {
      depth: value("m", 140_000),
      seaLevelPressure: value("kPa", 101.325),
    },
  };

  // Low enough that the atmospheric gate is open either way, so the case measures the radius and not the gate.
  const payloadsFor = (body: Record<string, unknown>) => ({
    "vessel.identity": { parentBodyIndex: 1 },
    "trackingStation.bodies": { bodies: [body] },
    "vessel.flight": {
      latitude: value("°", 0.2),
      longitude: value("°", 12),
      altitudeAsl: value("m", 3200),
      altitudeTerrain: value("m", 3000),
      verticalSpeed: value("m/s", -180),
      surfaceSpeed: value("m/s", 240),
      mach: value("1", 0.7),
    },
    "vessel.surface": { heightFromTerrain: value("m", 3000) },
    "vessel.landing": {
      predictedLatitude: value("°", 0.4),
      predictedLongitude: value("°", 12.6),
      terminalVelocity: value("m/s", 90),
      projectedTouchdownSpeed: value("m/s", 95),
      dragToWeightRatio: value("1", 1.4),
      groundTrackDistances: strip(70_000, 3000).groundDistances.map((d) =>
        value("m", d),
      ),
      groundTrackElevations: strip(70_000, 3000).groundElevations.map((e) =>
        value("m", e),
      ),
      sampleSource: "terrain",
      roughnessFootprintMeters: value("m", 40),
    },
    "vessel.orbit": { mu: value("m³/s²", 3.986004418e14) },
  });

  /** What a contribution's `compute` is handed: each Topic as a reading, current unless `held` names it. */
  const topicsFor = (
    body: Record<string, unknown>,
    held: readonly string[] = [],
    payloads: Record<string, unknown> = payloadsFor(body),
  ) =>
    Object.fromEntries([
      ["crash.lastCrash", { state: "absent", atUt: value("ut", 100) }],
      ["crash.hasRecent", { state: "absent", atUt: value("ut", 100) }],
      ...Object.entries(payloads).map(([topic, payload]) => [
        topic,
        held.includes(topic)
          ? {
              state: "held",
              value: payload,
              asOfUt: value("ut", 100),
              grade: "disconnected",
              reckoning: { status: "none" },
            }
          : {
              state: "observed",
              value: payload,
              atUt: value("ut", 100),
              reckoning: { status: "none" },
            },
      ]),
    ]);

  const compute = (id: string, body: Record<string, unknown>) => {
    const contribution = getContributionsForSlot("plots").find(
      (c) => c.id === id,
    );
    if (!contribution) throw new Error(`the ${id} contribution is missing`);
    return contribution.compute(topicsFor(body)) as
      | { layers: PlotLayer[] }[]
      | null;
  };

  const layerIds = (id: string, body: Record<string, unknown>) =>
    (compute(id, body)?.[0]?.layers ?? []).map((l) => l.id);

  // The projected trace needs a gravity, so it says whether the body resolved.
  it("projects the descent for a body no table knows", () => {
    expect(layerIds("core:descent-envelope", EARTH)).toContain(
      "trace-estimate",
    );
  });

  // The downrange displacement is a great-circle arc on the body's radius; without one the mark would sit on the site.
  it("places the vessel downrange using the reported radius", () => {
    const out = compute("core:cross-section", EARTH);
    const vessel = out?.[0]?.layers.find((l) => l.id === "vessel");
    expect(vessel?.kind).toBe("marker");
    expect((vessel as { at?: { x: number } } | undefined)?.at?.x).toBeLessThan(
      0,
    );
  });

  it("draws the ground from the strip on vessel.landing, and nothing without it", () => {
    const withStrip = compute("core:cross-section", EARTH);
    expect(withStrip?.[0]?.layers.map((l) => l.id)).toContain("skyline");

    const contribution = getContributionsForSlot("plots").find(
      (c) => c.id === "core:cross-section",
    );
    const payloads = payloadsFor(EARTH);
    const bare = topicsFor(EARTH, [], {
      ...payloads,
      "vessel.landing": {
        ...payloads["vessel.landing"],
        groundTrackDistances: undefined,
        groundTrackElevations: undefined,
      },
    });
    expect(contribution?.compute(bare)).toBeNull();
  });

  it("centres the touchdown reticle for a body no table knows", () => {
    expect(layerIds("core:touchdown-reticle", EARTH)).toContain("site");
  });

  it("marks every landing plot held while the flight it was drawn from is held, and none while it is current", () => {
    for (const id of [
      "core:descent-envelope",
      "core:cross-section",
      "core:touchdown-reticle",
    ]) {
      const contribution = getContributionsForSlot("plots").find(
        (c) => c.id === id,
      );
      const plotHeld = (held: readonly string[]) =>
        (
          contribution?.compute(topicsFor(EARTH, held)) as
            | { held?: { state: string } }[]
            | null
        )?.[0]?.held?.state;
      expect(plotHeld([])).toBe("observed");
      expect(plotHeld(["vessel.flight"])).toBe("held");
    }
  });

  describe("a crash on record", () => {
    const crashed = (held: readonly string[]) => {
      const payloads = {
        ...payloadsFor(EARTH),
        "vessel.identity": { parentBodyIndex: 1, vesselId: "doomed" },
        "crash.lastCrash": {
          vesselId: "doomed",
          // Ahead of the vessel along its track, at ground level.
          latitude: value("°", 0.3),
          longitude: value("°", 12.3),
          altitude: value("m", 200),
        },
      };
      return topicsFor(EARTH, held, payloads);
    };
    const run = (id: string, topics: ReturnType<typeof crashed>) =>
      (
        getContributionsForSlot("plots")
          .find((c) => c.id === id)
          ?.compute(topics) as { layers: PlotLayer[] }[] | null
      )?.[0]?.layers ?? [];

    it("sets the vessel on the ground and draws the stretch from its last reading as unknown, once the flight has stopped arriving", () => {
      const layers = run("core:cross-section", crashed(["vessel.flight"]));
      const ids = layers.map((l) => l.id);
      expect(ids).toEqual(
        expect.arrayContaining(["unknown-path", "last-seen", "impact"]),
      );
      const path = layers.find((l) => l.id === "unknown-path");
      expect((path as { dashed?: boolean }).dashed).toBe(true);
      const at = (id: string) =>
        (layers.find((l) => l.id === id) as { at: { x: number; y: number } })
          .at;
      expect(at("vessel")).toEqual(at("impact"));
      expect(at("last-seen").y).toBeGreaterThan(at("impact").y);
      // A projection of where a lost craft would go says nothing of a crash.
      expect(ids).not.toContain("velocity");
    });

    it("marks the crash site on the touchdown plot as well", () => {
      const ids = run("core:touchdown-reticle", crashed(["vessel.flight"])).map(
        (l) => l.id,
      );
      expect(ids).toEqual(expect.arrayContaining(["unknown-path", "impact"]));
    });

    it("draws nothing of a crash while the vessel is still reporting", () => {
      const ids = run("core:cross-section", crashed([])).map((l) => l.id);
      expect(ids).not.toContain("impact");
    });

    it("ignores the crash of another vessel", () => {
      const topics = crashed(["vessel.flight"]);
      Object.assign(topics, {
        "vessel.identity": {
          state: "observed",
          value: { parentBodyIndex: 1, vesselId: "someone-else" },
          atUt: value("ut", 100),
          reckoning: { status: "none" },
        },
      });
      expect(run("core:cross-section", topics).map((l) => l.id)).not.toContain(
        "impact",
      );
    });
  });

  // With nothing reported or known, the reticle is withheld rather than drawn against an unsupplied radius.
  it("withholds the reticle when no source knows the body at all", () => {
    expect(
      compute("core:touchdown-reticle", { index: 1, name: "Erf" }),
    ).toBeNull();
  });
});
