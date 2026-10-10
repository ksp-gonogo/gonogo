import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getContributionsForSlot, registerStockBodies } from "@ksp-gonogo/core";
import type { PlotEntry, PlotLayer } from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { isRecord } from "../../scripts/gen-landing-status-fixtures";
import {
  buildCrossSectionPlot,
  type CrossSectionInputs,
} from "./crossSectionPlot";
// Registers the three contributions the last describe drives, as the widget's own import does.
import "./descentLayers";
import {
  coneFootprint,
  groundTrackDistances,
  siteGridHalfExtent,
  trackExtent,
} from "../../scripts/landingDescentModel";
import {
  buildTouchdownReticlePlot,
  dispersionRadiusMeters,
  type TouchdownReticleInputs,
} from "./touchdownReticlePlot";

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

function reticle(
  over: Partial<TouchdownReticleInputs> = {},
): TouchdownReticleInputs {
  return {
    driftMeters: 120,
    driftBearingDeg: 90,
    zoneRadiusMeters: 50,
    slopeDeg: 9,
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
  ])("keeps them off the touchdown plot's edges too", (agl, drift) => {
    const plot = buildTouchdownReticlePlot(
      reticle({ aglMeters: agl, driftMeters: drift, driftBearingDeg: 90 }),
    );
    expect(across(plot, "vessel")).toBeGreaterThanOrEqual(0.12);
    expect(across(plot, "site")).toBeLessThanOrEqual(0.88);
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

describe("touchdown reticle plot", () => {
  describe("the ground under the marks", () => {
    const relief = (over: Partial<TouchdownReticleInputs>) => {
      const plot = buildTouchdownReticlePlot(
        reticle({ driftBearingDeg: 90, driftMeters: 120, ...over }),
      );
      const layer = plot?.layers.find((l) => l.id === "terrain");
      return layer?.kind === "relief" ? layer : null;
    };

    it("is drawn from the site grid, first, under every other mark", () => {
      const plot = buildTouchdownReticlePlot(reticle({ ...grid() }));
      expect(plot?.layers[0].id).toBe("terrain");
    });

    it("lays the grid out as the mod sends it: north at the top, over the grid's own extent", () => {
      const layer = relief(grid());
      if (!layer) throw new Error("expected a relief");
      expect(layer.size).toBe(24);
      expect(layer.bounds).toEqual({ x0: -120, y0: -120, x1: 120, y1: 120 });
      expect(layer.values).toEqual(grid().siteHeights);
    });

    it("is hatched on every side the grid does not reach, from exactly where it ends", () => {
      // The vessel is 120 m out, so the window reaches 138 m and the grid only 120 m.
      const plot = buildTouchdownReticlePlot(reticle({ ...grid() }));
      const ids = (plot?.layers ?? [])
        .filter((l) => l.kind === "region" && l.hatched === true)
        .map((l) => l.id)
        .sort();
      expect(ids).toEqual([
        "unsampled-above",
        "unsampled-below",
        "unsampled-left",
        "unsampled-right",
      ]);
      const left = plot?.layers.find((l) => l.id === "unsampled-left");
      if (left?.kind !== "region") throw new Error("expected a region");
      expect(left.boundary.every((p) => p.x === -120)).toBe(true);
    });

    it("is not hatched where the grid covers the whole window", () => {
      // The grid the mod sends for this window.
      const plot = buildTouchdownReticlePlot(
        reticle({
          ...grid(),
          siteHeightsExtentMeters: 2 * siteGridHalfExtent(40, 100),
          driftMeters: 40,
          aglMeters: 100,
        }),
      );
      expect(
        (plot?.layers ?? []).some((l) => l.kind === "region" && l.hatched),
      ).toBe(false);
    });

    it("is hatched across the whole window when no ground was sampled", () => {
      const plot = buildTouchdownReticlePlot(reticle());
      const whole = plot?.layers.find((l) => l.id === "unsampled");
      expect(whole?.kind === "region" && whole.hatched).toBe(true);
    });

    it("is absent without a whole grid, and the rest of the reticle stays", () => {
      expect(relief({})).toBeNull();
      expect(relief({ ...grid(), siteHeights: [1, 2, 3] })).toBeNull();
      const holed = grid().siteHeights;
      holed[10] = Number.NaN;
      expect(relief({ ...grid(), siteHeights: holed })).toBeNull();
      expect(relief({ ...grid(), siteHeightsExtentMeters: null })).toBeNull();
      expect(buildTouchdownReticlePlot(reticle())).not.toBeNull();
    });
  });

  describe("the grid under the window", () => {
    it.each([
      [8000, 0],
      [8000, 4000],
      [3000, 1500],
      [1000, 200],
      [291, 60],
      [100, 0],
      [30, 5],
      [5, 0],
      [3000, 30_000],
    ])("covers the whole window at %f m up with the site %f m off, in cells narrow enough to read", (height, drift) => {
      const half = siteGridHalfExtent(drift, height);
      const size = 24;
      const plot = buildTouchdownReticlePlot(
        reticle({
          aglMeters: height,
          driftMeters: drift,
          driftBearingDeg: 45,
          siteHeights: Array.from({ length: size * size }, () => 100),
          siteHeightsSize: size,
          siteHeightsExtentMeters: 2 * half,
        }),
      );
      // No hatching: the grid reaches every side of the window.
      expect(
        (plot?.layers ?? []).filter((l) => l.kind === "region").length,
      ).toBe(0);
      const [lo, hi] = frameOf(plot).xDomain;
      const cell = (2 * half) / size;
      expect((hi - lo) / cell).toBeGreaterThanOrEqual(10);
    });
  });

  describe("the dispersion ring", () => {
    const ringOf = (plot: PlotEntry | null) => {
      const l = plot?.layers.find((x) => x.id === "landing-zone");
      if (l?.kind !== "series") throw new Error("expected the ring");
      return l;
    };

    it("is drawn at its real radius while it fits the window", () => {
      const plot = buildTouchdownReticlePlot(
        reticle({ zoneRadiusMeters: 50, aglMeters: 300, driftMeters: 100 }),
      );
      const top = Math.max(...ringOf(plot).points.map((p) => p.y));
      expect(top).toBeCloseTo(50, 6);
    });

    it("never outgrows the plot: a ring far wider than the window is drawn inside it and says so", () => {
      for (const radius of [400, 2000, 20_000]) {
        const plot = buildTouchdownReticlePlot(
          reticle({
            zoneRadiusMeters: radius,
            aglMeters: 300,
            driftMeters: 100,
          }),
        );
        const ring = ringOf(plot);
        const [xLo, xHi] = frameOf(plot).xDomain;
        const [yLo, yHi] = frameOf(plot).yDomain;
        for (const p of ring.points) {
          expect(p.x).toBeGreaterThan(xLo);
          expect(p.x).toBeLessThan(xHi);
          expect(p.y).toBeGreaterThan(yLo);
          expect(p.y).toBeLessThan(yHi);
        }
        // The text still carries the real figure.
        expect(ring.description).toContain("beyond the plot");
      }
    });

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
        dispersionRadiusMeters({ sampled: true, ...d }),
      );
      for (let i = 1; i < radii.length; i++) {
        expect(radii[i]).toBeLessThan(radii[i - 1] ?? 0);
      }
      const floor = dispersionRadiusMeters({
        sampled: true,
        horizontalSpeed: 0,
        timeToImpact: 0,
      });
      expect(radii.at(-1)).toBe(floor);
      expect(floor).toBeGreaterThan(0);
      // Never the terrain's sampling footprint: a 100 m roughness patch says nothing about where the legs come down.
      expect(floor).toBeLessThan(30);
    });

    it("is nothing when no site was sampled", () => {
      expect(
        dispersionRadiusMeters({
          sampled: false,
          horizontalSpeed: 10,
          timeToImpact: 10,
        }),
      ).toBeNull();
    });
  });

  describe("the site's name", () => {
    it("says how wide a patch the roughness was measured across, and nothing of it when unsent", () => {
      const siteOf = (over: Partial<TouchdownReticleInputs>) =>
        buildTouchdownReticlePlot(reticle(over))?.layers.find(
          (l) => l.id === "site",
        )?.description;
      expect(siteOf({ roughnessFootprint: value("m", 100) })).toContain(
        "roughness measured across 100 m",
      );
      expect(siteOf({})).not.toContain("roughness");
    });
  });

  describe("closing in to touchdown", () => {
    it("narrows the window with every metre of height, with no height below which it stops", () => {
      let previous = Number.POSITIVE_INFINITY;
      for (let height = 300; height >= 0; height -= 5) {
        const [lo, hi] = frameOf(
          buildTouchdownReticlePlot(
            reticle({ driftMeters: 0, aglMeters: height }),
          ),
        ).xDomain;
        expect(hi - lo, `at ${height} m`).toBeLessThan(previous);
        previous = hi - lo;
      }
    });

    it("is still wide enough at touchdown to read as a site, not a zoom artefact", () => {
      const [lo, hi] = frameOf(
        buildTouchdownReticlePlot(reticle({ driftMeters: 0, aglMeters: 0 })),
      ).xDomain;
      expect(hi - lo).toBeGreaterThanOrEqual(100);
    });
  });

  describe("over the sea", () => {
    const size = 24;
    const sea = (depth: number) => ({
      siteHeights: Array.from({ length: size * size }, () => depth),
      siteHeightsSize: size,
      siteHeightsExtentMeters: 1000,
    });
    const plotOf = (heights: ReturnType<typeof sea>, hasOcean?: boolean) =>
      buildTouchdownReticlePlot(
        reticle({ ...heights, aglMeters: 100, driftMeters: 40, hasOcean }),
      );

    it("fills the window with water when the whole grid is under it", () => {
      const water = (plotOf(sea(-140), true)?.layers ?? []).find(
        (l) => l.id === "sea",
      );
      expect(water?.kind).toBe("region");
      expect(water?.tone).toBe("info");
    });

    it("holds the ground at the surface, so the floor's shape is not drawn as terrain", () => {
      const heights = sea(-140);
      heights.siteHeights[100] = -20;
      const t = plotOf(heights, true)?.layers.find((l) => l.id === "terrain");
      if (t?.kind !== "relief") throw new Error("expected the relief");
      expect(Math.max(...t.values)).toBeLessThanOrEqual(0);
      expect(Math.min(...t.values)).toBeGreaterThanOrEqual(0);
    });

    describe("its moving surface", () => {
      const SEA = {
        siteOnBody: { east: 123_456, north: -7_890 },
        gravity: 9.81,
      };
      const withSea = (
        heights: ReturnType<typeof sea>,
        over: Partial<TouchdownReticleInputs> = {},
      ) =>
        buildTouchdownReticlePlot(
          reticle({
            ...heights,
            aglMeters: 100,
            driftMeters: 40,
            hasOcean: true,
            sea: SEA,
            ...over,
          }),
        );
      const waterOf = (plot: PlotEntry | null) => {
        const w = plot?.layers.find((l) => l.id === "sea");
        return w?.kind === "water" ? w : null;
      };

      it("draws a grid wholly under the sea as water seen from above, on the ground's own bounds, fixed to the body", () => {
        const plot = withSea(sea(-140));
        const w = waterOf(plot);
        expect(w?.view).toBe("plan");
        expect(w?.origin).toEqual(SEA.siteOnBody);
        expect(w?.gravity).toBe(9.81);
        expect(w?.sea).toBeUndefined();
        // The relief's bounds exactly, so the water is shaded on the cells the land is.
        const relief = plot?.layers.find((l) => l.id === "terrain");
        if (relief?.kind !== "relief") throw new Error("expected the relief");
        expect(w?.bounds).toEqual(relief.bounds);
      });

      it("hands a coast the ground's own heights, so the sea meets the land cell for cell", () => {
        const heights = sea(-140);
        heights.siteHeights = heights.siteHeights.map((_, i) =>
          i % size < size / 2 ? -140 : 40,
        );
        const w = waterOf(withSea(heights));
        expect(w?.sea?.size).toBe(size);
        // The heights as the mod sent them, below the surface where the sea is: the land's own relief is held at the surface.
        expect(w?.sea?.heights).toEqual(heights.siteHeights);
        expect(w?.bounds).toEqual({ x0: -500, y0: -500, x1: 500, y1: 500 });
      });

      it("is drawn in the body's own liquid colour, and in the theme's water where the body gives none", () => {
        const eve = waterOf(
          withSea(sea(-140), { sea: { ...SEA, liquidColor: "#AD94BE" } }),
        );
        expect(eve?.tint).toBe("#AD94BE");
        expect(eve?.tone).toBe("info");
        expect(waterOf(withSea(sea(-140)))?.tint).toBeUndefined();
      });

      it("draws no water over land, and a flat fill when the site's place or the gravity is not known", () => {
        expect(waterOf(withSea(sea(120)))).toBeNull();
        const flat = withSea(sea(-140), { sea: null })?.layers.find(
          (l) => l.id === "sea",
        );
        expect(flat?.kind).toBe("region");
      });

      it("draws it over the ground and under every mark", () => {
        const ids = (withSea(sea(-140))?.layers ?? []).map((l) => l.id);
        expect(ids.indexOf("sea")).toBeGreaterThan(ids.indexOf("terrain"));
        expect(ids.indexOf("sea")).toBeLessThan(ids.indexOf("site"));
      });
    });

    it("draws no water over land, or when the body is not known to have an ocean", () => {
      expect(
        (plotOf(sea(120), true)?.layers ?? []).some((l) => l.id === "sea"),
      ).toBe(false);
      expect(
        (plotOf(sea(-140), undefined)?.layers ?? []).some(
          (l) => l.id === "sea",
        ),
      ).toBe(false);
    });
  });

  describe("following the craft", () => {
    const at = (driftMeters: number, aglMeters = 1000) =>
      buildTouchdownReticlePlot(
        reticle({ driftMeters, driftBearingDeg: 90, aglMeters }),
      );
    const siteFraction = (plot: PlotEntry | null) => {
      const [lo, hi] = frameOf(plot).xDomain;
      return (0 - lo) / (hi - lo);
    };

    it("is centred between the craft and the site, so both are seen to move", () => {
      const plot = at(3000);
      const [xLo, xHi] = frameOf(plot).xDomain;
      const [yLo, yHi] = frameOf(plot).yDomain;
      expect((xLo + xHi) / 2).toBeCloseTo(-1500, 6);
      expect((yLo + yHi) / 2).toBeCloseTo(0, 6);
      expect(xHi - xLo).toBeCloseTo(yHi - yLo, 6);
    });

    it("moves the site across the frame toward its middle as the craft closes on it", () => {
      // A craft 5 km up with the site 3 km off: the window is the cone's width, not the distance, so the marks travel across it.
      const fractions = [3000, 2000, 1000, 400, 0].map((d) =>
        siteFraction(at(d, 5000)),
      );
      for (let i = 1; i < fractions.length; i++) {
        expect(fractions[i]).toBeLessThan(fractions[i - 1]);
      }
      expect(fractions[0]).toBeGreaterThan(0.65);
      expect(fractions[fractions.length - 1]).toBeCloseTo(0.5, 6);
    });

    it("holds the craft and the site inside the frame whatever the distance", () => {
      for (const d of [0, 40, 400, 4000, 40_000]) {
        const plot = at(d);
        const [xLo, xHi] = frameOf(plot).xDomain;
        for (const id of ["site", "vessel"]) {
          const m = plot?.layers.find((l) => l.id === id);
          if (m?.kind !== "marker") throw new Error("expected a marker");
          expect(m.at.x).toBeGreaterThan(xLo);
          expect(m.at.x).toBeLessThan(xHi);
        }
      }
    });

    it("zooms with the craft's height, so the window is about the cone's width", () => {
      const half = (agl: number) => {
        const [lo, hi] = frameOf(at(0, agl)).xDomain;
        return (hi - lo) / 2;
      };
      expect(half(2000)).toBeGreaterThan(half(500));
      expect(half(500)).toBeGreaterThan(half(100));
    });

    it("draws the ground track the cross-section is cut along, through the craft and the site", () => {
      const plot = buildTouchdownReticlePlot(
        reticle({
          driftMeters: 400,
          driftBearingDeg: 90,
          aglMeters: 500,
          trackBehindMeters: -500,
          trackAheadMeters: 900,
        }),
      );
      const track = plot?.layers.find((l) => l.id === "ground-track");
      if (track?.kind !== "series") throw new Error("expected the track");
      const [a, b] = [track.points[0], track.points[track.points.length - 1]];
      // Along the bearing (east), from 500 m behind the craft to 900 m ahead of it.
      expect(a.x).toBeCloseTo(-400 - 500, 6);
      expect(b.x).toBeCloseTo(-400 + 900, 6);
      expect(a.y).toBeCloseTo(0, 6);
    });
  });

  it("contributes NOTHING without a site to centre on", () => {
    expect(
      buildTouchdownReticlePlot(reticle({ driftMeters: null })),
    ).toBeNull();
    expect(
      buildTouchdownReticlePlot(reticle({ driftBearingDeg: null })),
    ).toBeNull();
  });

  it("names the slope and the biome only when it has them", () => {
    const known = buildTouchdownReticlePlot(reticle());
    const site = known?.layers.find((l) => l.id === "site");
    expect(site?.description).toContain("Midlands");
    expect(site?.description).toMatch(/9\.0°/);

    const unknown = buildTouchdownReticlePlot(
      reticle({ slopeDeg: null, biome: null }),
    );
    const bareSite = unknown?.layers.find((l) => l.id === "site");
    // An absent slope is NOT a flat site, so nothing is said about one.
    expect(bareSite?.description).toBe("predicted touchdown site");
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
    "system.bodies": { bodies: [body] },
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
    Object.fromEntries(
      Object.entries(payloads).map(([topic, payload]) => [
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
    );

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

  // With nothing reported or known, the reticle is withheld rather than drawn against an unsupplied radius.
  it("withholds the reticle when no source knows the body at all", () => {
    expect(
      compute("core:touchdown-reticle", { index: 1, name: "Erf" }),
    ).toBeNull();
  });
});
