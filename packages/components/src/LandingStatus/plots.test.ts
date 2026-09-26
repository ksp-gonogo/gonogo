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

const FLAT_PATCH = Array.from({ length: 9 }, () => 100);
const SLOPED_PATCH = [100, 100, 100, 110, 110, 110, 120, 120, 120];

function crossSection(
  over: Partial<CrossSectionInputs> = {},
): CrossSectionInputs {
  return {
    patch: SLOPED_PATCH,
    patchSize: 3,
    patchExtentMeters: 200,
    bearingDeg: 0,
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
    patch: FLAT_PATCH,
    patchSize: 3,
    patchExtentMeters: 200,
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
    // 200 m of patch across and a craft 300 m up: past the tallness limit, so the window stays the ground's and the craft is off the top.
    expect(yHi - yLo).toBe(200);
  });

  it("opens up to hold the vessel when it fits, staying square", () => {
    const plot = buildCrossSectionPlot(crossSection({ aglMeters: 60 }));
    const [xLo, xHi] = frameOf(plot).xDomain;
    const [yLo, yHi] = frameOf(plot).yDomain;
    expect(xHi - xLo).toBeCloseTo(yHi - yLo, 6);
    expect(yHi).toBeGreaterThan(160);
  });

  it("says both speeds inside the frame, because a map has no gutter", () => {
    const plot = buildCrossSectionPlot(crossSection());
    const captions = plot?.layers.filter((l) => l.kind === "caption") ?? [];
    expect(captions.map((c) => c.id).sort()).toEqual([
      "descent-rate",
      "ground-speed",
    ]);
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

  it("contributes NOTHING without a ground extent to state the X axis in", () => {
    // Without a ground extent the profile would be drawn at an unknown scale.
    expect(
      buildCrossSectionPlot(crossSection({ patchExtentMeters: null })),
    ).toBeNull();
  });

  it("contributes NOTHING with a hole in the patch", () => {
    const holed = [...SLOPED_PATCH];
    holed[4] = Number.NaN;
    expect(buildCrossSectionPlot(crossSection({ patch: holed }))).toBeNull();
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

  it("is a SPATIAL frame that BLEEDS: the relief fills it edge to edge", () => {
    // The patch footprint is the window: no inset ring of empty ground.
    const plot = buildTouchdownReticlePlot(reticle({ patchExtentMeters: 200 }));
    expect(frameOf(plot).kind).toBe("spatial");
    expect(frameOf(plot).xDomain).toEqual([-100, 100]);
    expect(frameOf(plot).yDomain).toEqual([-100, 100]);
  });

  it("carries the terrain as a relief over its real footprint", () => {
    const plot = buildTouchdownReticlePlot(reticle({ patchExtentMeters: 200 }));
    const relief = plot?.layers.find((l) => l.id === "terrain");
    if (relief?.kind !== "relief") throw new Error("expected a relief");
    expect(relief.bounds).toEqual({ x0: -100, y0: -100, x1: 100, y1: 100 });
    expect(relief.size).toBe(3);
  });

  it("keeps the plot but drops the relief when the patch has no footprint", () => {
    // Without an extent the grid goes and the metric reticle stays.
    const plot = buildTouchdownReticlePlot(
      reticle({ patchExtentMeters: null }),
    );
    expect(plot).not.toBeNull();
    expect(plot?.layers.some((l) => l.id === "terrain")).toBe(false);
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
      terrainPatch: FLAT_PATCH.map((h) => value("m", h)),
      terrainPatchSize: value("count", 3),
      terrainPatchExtentMeters: value("m", 200),
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
