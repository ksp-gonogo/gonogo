import { getContributionsForSlot, registerStockBodies } from "@ksp-gonogo/core";
import type { PlotEntry, PlotLayer } from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  buildCrossSectionPlot,
  type CrossSectionInputs,
} from "./crossSectionPlot";
// Registers the three contributions the last describe drives, as the widget's own import does.
import "./descentLayers";
import {
  buildTouchdownReticlePlot,
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

/** A ground strip of the shape the mod sends: 48 samples from beneath the vessel to a quarter of the way again past the site, rising 5 m per 100 m downrange from 100 m. */
function strip(driftMeters: number): {
  groundDistances: number[];
  groundElevations: number[];
} {
  const end = Math.max(200, driftMeters + Math.max(100, driftMeters * 0.25));
  const groundDistances = Array.from({ length: 48 }, (_, i) => (end * i) / 47);
  return {
    groundDistances,
    groundElevations: groundDistances.map((d) => 100 + d * 0.05),
  };
}

function crossSection(
  over: Partial<CrossSectionInputs> = {},
): CrossSectionInputs {
  const driftMeters = over.driftMeters === undefined ? 40 : over.driftMeters;
  return {
    ...strip(driftMeters ?? 0),
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
    // 200 m of patch across and a craft 300 m up: the window opens to a rung that holds the craft.
    expect(yHi - yLo).toBe(500);
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
    /** Where the vessel sits in the frame, 0 at the floor and 1 at the top. */
    const heightFraction = (plot: PlotEntry | null) => {
      const [lo] = frameOf(plot).yDomain;
      return (vesselOf(plot).at.y - lo) / spanOf(plot);
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

    it("zooms in rungs of 1, 2 and 5, so a fall changes scale a few times and not every frame", () => {
      const spans = new Set<number>();
      for (let agl = 8000; agl >= 60; agl -= 10) spans.add(spanOf(fall(agl)));
      for (const span of spans) {
        const mantissa = span / 10 ** Math.floor(Math.log10(span));
        expect([1, 2, 5]).toContain(Math.round(mantissa * 1e6) / 1e6);
      }
      expect(spans.size).toBeLessThanOrEqual(8);
    });

    it("lowers the craft in the frame as it falls while the scale holds", () => {
      const fractions = [7400, 7000, 6600, 6200, 5800].map((agl) => {
        const plot = fall(agl);
        return { span: spanOf(plot), fraction: heightFraction(plot) };
      });
      expect(new Set(fractions.map((f) => f.span)).size).toBe(1);
      for (let i = 1; i < fractions.length; i++) {
        expect(fractions[i].fraction).toBeLessThan(fractions[i - 1].fraction);
      }
    });

    it("moves the craft downrange toward the site as it falls", () => {
      const xs = [7400, 7000, 6600].map((agl) => vesselOf(fall(agl)).at.x);
      expect(xs[0]).toBeLessThan(xs[1]);
      expect(xs[1]).toBeLessThan(xs[2]);
    });

    it("keeps the terrain at the foot of the frame once the craft is close", () => {
      expect(spanOf(fall(150))).toBeLessThanOrEqual(500);
    });
  });

  describe("a vessel above the window", () => {
    const high = (over: Partial<CrossSectionInputs>) =>
      buildCrossSectionPlot(
        crossSection({ aglMeters: 40_000, driftMeters: 30_000, ...over }),
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
      const before = caption(high({ aglMeters: 40_000, driftMeters: 30_000 }));
      const after = caption(high({ aglMeters: 30_000, driftMeters: 25_000 }));
      expect(before).not.toBe(after);
      expect(before).toMatch(/40(\.0+)? km/);
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

  it("draws the velocity vector as ten seconds of travel, not an arbitrary length", () => {
    const plot = buildCrossSectionPlot(
      crossSection({ verticalSpeed: 8, horizontalSpeed: 2 }),
    );
    const velocity = plot?.layers.find((l) => l.id === "velocity");
    expect(velocity?.kind).toBe("series");
    if (velocity?.kind !== "series") throw new Error("expected a series");
    const [from, to] = velocity.points;
    expect(to.x - from.x).toBe(20); // 2 m/s for 10 s
    expect(from.y - to.y).toBe(80); // 8 m/s down for 10 s
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

  it("omits the velocity vector rather than drawing a zero-length one", () => {
    const plot = buildCrossSectionPlot(
      crossSection({ verticalSpeed: 0, horizontalSpeed: 0 }),
    );
    expect(plot?.layers.some((l) => l.id === "velocity")).toBe(false);
  });
});

describe("touchdown reticle plot", () => {
  it("puts the site at the origin and the vessel at its real bearing", () => {
    // Bearing 90 is due east, so the SITE is east of the vessel and the vessel is therefore west of the site: negative x, zero y.
    const plot = buildTouchdownReticlePlot(reticle());
    const vessel = plot?.layers.find((l) => l.id === "vessel");
    if (vessel?.kind !== "marker") throw new Error("expected a marker");
    expect(vessel.at.x).toBeCloseTo(-120, 6);
    expect(vessel.at.y).toBeCloseTo(0, 6);
  });

  it("draws the landing zone at its stated radius, as a ring in data space", () => {
    const plot = buildTouchdownReticlePlot(reticle({ zoneRadiusMeters: 50 }));
    const zone = plot?.layers.find((l) => l.id === "landing-zone");
    // An outline, never a filled disc: the zone sits over the terrain relief and a shaded one hides the bands the ground's shape is read from.
    if (zone?.kind !== "series") throw new Error("expected a series");
    for (const p of zone.points) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(50, 6);
    }
  });

  it("is a SPATIAL frame, square, padded past the vessel", () => {
    const plot = buildTouchdownReticlePlot(reticle({ driftMeters: 400 }));
    expect(frameOf(plot).kind).toBe("spatial");
    expect(frameOf(plot).xDomain[1]).toBeCloseTo(460, 6);
    expect(frameOf(plot).yDomain[0]).toBeCloseTo(-460, 6);
  });

  it("draws no terrain: the cross-section carries the ground", () => {
    const plot = buildTouchdownReticlePlot(reticle());
    expect(plot?.layers.some((l) => l.kind === "relief")).toBe(false);
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
  const topicsFor = (body: Record<string, unknown>) => ({
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
      groundTrackDistances: strip(70_000).groundDistances.map((d) =>
        value("m", d),
      ),
      groundTrackElevations: strip(70_000).groundElevations.map((e) =>
        value("m", e),
      ),
      sampleSource: "terrain",
      roughnessFootprintMeters: value("m", 40),
    },
    "vessel.orbit": { mu: value("m³/s²", 3.986004418e14) },
  });

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
    const topics = topicsFor(EARTH);
    const bare = {
      ...topics,
      "vessel.landing": {
        ...topics["vessel.landing"],
        groundTrackDistances: undefined,
        groundTrackElevations: undefined,
      },
    };
    expect(contribution?.compute(bare)).toBeNull();
  });

  it("centres the touchdown reticle for a body no table knows", () => {
    expect(layerIds("core:touchdown-reticle", EARTH)).toContain("site");
  });

  // With nothing reported or known, the reticle is withheld rather than drawn against an unsupplied radius.
  it("withholds the reticle when no source knows the body at all", () => {
    expect(
      compute("core:touchdown-reticle", { index: 1, name: "Erf" }),
    ).toBeNull();
  });
});
