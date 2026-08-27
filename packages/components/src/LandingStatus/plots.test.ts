import { describe, expect, it } from "vitest";
import {
  buildCrossSectionPlot,
  type CrossSectionInputs,
} from "./crossSectionPlot";
import {
  buildTouchdownReticlePlot,
  type TouchdownReticleInputs,
} from "./touchdownReticlePlot";

/**
 * The two site plots, as the pure functions they now are.
 *
 * The altitude rail is not here because it is not a plot. It was one for a day,
 * and a chart of a single scalar came out as one chevron on a ladder next to a
 * widget that already stated the same height. It is a `Tape` again; its own
 * spec is `AltitudeRail.test.tsx`.
 *
 * This spec exists because the migration moved these readings OUT of a rendered
 * SVG and into data, and a reading stated as data can be checked without a DOM,
 * a size, a resize observer or a contribution registry. The widget spec next
 * door proves the plots reach the screen; this one proves they say the right
 * thing, which used to be verifiable only by matching a regex against an
 * accessible name three layers down.
 *
 * Every case here is an ABSENCE case or a UNIT case, because those are the two
 * the conversion put at risk: the old components rendered a frame whatever they
 * were handed, and their geometry was in normalised box coordinates that no
 * assertion could have caught being wrong.
 */

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
    expect(plot?.frame.xUnit).toBe("m");
    expect(plot?.frame.yUnit).toBe("m");
    // The Y domain spans the real elevations (100..120) plus the vessel at
    // 300 above the ground under it, not a 0..1 amplitude scaled to the box.
    const [yLo, yHi] = plot?.frame.yDomain ?? [0, 0];
    expect(yLo).toBeLessThan(100);
    expect(yHi).toBeGreaterThan(400);
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
    // The case that used to "work": the old component drew the profile across
    // the box at whatever scale the box happened to be, so the slope it showed
    // was a picture rather than a reading.
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
    // Bearing 90 is due east, so the SITE is east of the vessel and the vessel
    // is therefore west of the site: negative x, zero y.
    const plot = buildTouchdownReticlePlot(reticle());
    const vessel = plot?.layers.find((l) => l.id === "vessel");
    if (vessel?.kind !== "marker") throw new Error("expected a marker");
    expect(vessel.at.x).toBeCloseTo(-120, 6);
    expect(vessel.at.y).toBeCloseTo(0, 6);
  });

  it("draws the landing zone at its stated radius, as a ring in data space", () => {
    const plot = buildTouchdownReticlePlot(reticle({ zoneRadiusMeters: 50 }));
    const zone = plot?.layers.find((l) => l.id === "landing-zone");
    // An outline, never a filled disc: the zone sits over the terrain relief
    // and a shaded one hides the bands the ground's shape is read from.
    if (zone?.kind !== "series") throw new Error("expected a series");
    for (const p of zone.points) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(50, 6);
    }
  });

  it("carries the terrain as a relief over its real footprint", () => {
    const plot = buildTouchdownReticlePlot(reticle({ patchExtentMeters: 200 }));
    const relief = plot?.layers.find((l) => l.id === "terrain");
    if (relief?.kind !== "relief") throw new Error("expected a relief");
    expect(relief.bounds).toEqual({ x0: -100, y0: -100, x1: 100, y1: 100 });
    expect(relief.size).toBe(3);
  });

  it("keeps the plot but drops the relief when the patch has no footprint", () => {
    // The marks are metric without it; the grid is not, so the grid goes and
    // the reticle stays. Dropping the whole plot would lose a reading it can
    // still state honestly.
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
