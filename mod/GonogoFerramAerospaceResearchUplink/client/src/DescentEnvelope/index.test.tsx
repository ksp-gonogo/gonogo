import type { AnyContribution, PlotLayer } from "@ksp-gonogo/sitrep-sdk";
import {
  getContributionsForSlot,
  registerStockBodies,
} from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { aeroBadges, aeroDescentLayers } from "./index";

/**
 * The plot's own anchors, describing a Kerbin entry at 28 km whose
 * constant-drag-coefficient back-out puts terminal at 300 m/s now and 95 m/s at
 * the ground. Both curves are derived from these, so the ONLY thing that can
 * separate them is the physics, which is what the second curve exists to show.
 */
const PLOT = {
  plotTerminal: 300,
  plotTouchdown: 95,
  altitude: 28_000,
  speed: 2200,
  surfaceGravity: 9.81,
};

/** A reading from a lifting entry: high alpha, a wing partly separated. */
function entryReading(
  overrides: Partial<Parameters<typeof aeroDescentLayers>[0]> = {},
) {
  return {
    ...PLOT,
    alpha: 40.2,
    stall: 0.18,
    modelTerminal: 180,
    ballistic: 391,
    stale: false,
    noReading: false,
    ...overrides,
  };
}

const kinds = (layers: PlotLayer[]) => layers.map((l) => l.kind);
const byId = (layers: PlotLayer[], id: string) =>
  layers.find((l) => l.id === id);
const spoken = (layers: PlotLayer[]) =>
  layers
    .map((l) => l.description ?? "")
    .filter(Boolean)
    .join(" | ");

describe("aero descent layers", () => {
  it("draws its own terminal curve only where it disagrees with the plot's", () => {
    // Scaled from the plot's own curve, so the two land on the same line.
    const agreeing = aeroDescentLayers(entryReading({ modelTerminal: 300 }));
    const disagreeing = aeroDescentLayers(entryReading());

    expect(byId(agreeing, "model-terminal")).toBeUndefined();
    expect(byId(disagreeing, "model-terminal")).toBeDefined();
  });

  it("states the curve in metres per second and metres, never in pixels", () => {
    const curve = byId(aeroDescentLayers(entryReading()), "model-terminal");
    expect(curve?.kind).toBe("series");
    const points = (curve as Extract<PlotLayer, { kind: "series" }>).points;
    // The ground end of the model's curve is its terminal velocity at ground
    // density, which for a craft holding alpha is well under the plot's 95.
    expect(points[0].y).toBe(0);
    expect(points[0].x).toBeGreaterThan(0);
    expect(points[0].x).toBeLessThan(PLOT.plotTouchdown);
    expect(points[points.length - 1].y).toBe(PLOT.altitude);
  });

  it("names the ballistic coefficient on its own settle tick", () => {
    const layers = aeroDescentLayers(entryReading());
    const tick = byId(layers, "model-settle");
    expect(tick?.kind).toBe("annotation");
    expect(
      (tick as Extract<PlotLayer, { kind: "annotation" }>).label,
    ).toContain("391");
    expect(spoken(layers)).toContain("ballistic coefficient");
  });

  it("says NO AERO DATA and adds no marks at all, with no reading", () => {
    const layers = aeroDescentLayers(
      entryReading({
        noReading: true,
        alpha: null,
        stall: null,
        modelTerminal: null,
        ballistic: null,
      }),
    );
    expect(kinds(layers)).toEqual(["caption"]);
    expect((layers[0] as Extract<PlotLayer, { kind: "caption" }>).text).toBe(
      "NO AERO DATA",
    );
  });

  it("says MODEL STALE and draws every mark it still adds faintly", () => {
    const layers = aeroDescentLayers(entryReading({ stale: true }));
    expect(
      layers.some((l) => l.kind === "caption" && l.text === "MODEL STALE"),
    ).toBe(true);
    expect(byId(layers, "model-terminal")?.emphasis).toBe("faint");
    expect(byId(layers, "model-settle")?.emphasis).toBe("faint");
  });

  it("has no STALL word at all on a craft with no stall fraction", () => {
    // A rocket has no wing to separate, and that is not a stall reading of
    // nought: the word simply is not contributed.
    const rocket = aeroDescentLayers(entryReading({ stall: null }));
    const winged = aeroDescentLayers(entryReading({ stall: 0.45 }));
    expect(byId(rocket, "stall")).toBeUndefined();
    expect(byId(winged, "stall")?.tone).toBe("nogo");
  });

  it("keeps a wing working hard clear of the wing departing", () => {
    expect(
      byId(aeroDescentLayers(entryReading({ stall: 0.02 })), "stall"),
    ).toBe(undefined);
    expect(
      byId(aeroDescentLayers(entryReading({ stall: 0.2 })), "stall")?.tone,
    ).toBe("warn");
  });

  it("adds nothing beyond the words when the body's gravity is unknown", () => {
    // The integration cannot run without it, so there is no settle tick rather
    // than a tick placed against a guessed body. The two curves stay: the
    // parting they show needs no gravity, and the reference one is drawn here
    // now rather than by the host, since a plot cannot draw into another plot.
    const layers = aeroDescentLayers(
      entryReading({ surfaceGravity: null, stall: null }),
    );
    expect(kinds(layers)).toEqual(["series", "series"]);
  });
});

describe("aero badges", () => {
  it("carries alpha and stall as numbers, with the tone escalating", () => {
    const badges = aeroBadges({
      angleOfAttack: { magnitude: 40.2, unit: "°" },
      stallFraction: { magnitude: 0.45, unit: "ratio" },
      aeroModelValid: true,
    } as never);
    expect(badges?.map((b) => b.id)).toEqual(["alpha", "stall"]);
    expect(badges?.[0].label).toContain("40");
    expect(badges?.[1].tone).toBe("nogo");
  });

  it("reports nothing at all rather than a zero, with no reading", () => {
    expect(aeroBadges(undefined)).toBeNull();
    expect(aeroBadges({ aeroModelValid: true } as never)).toBeNull();
  });
});

// The registrations run at module load, off this file's own import of
// `./index` above, exactly as they do in the app.
describe("registration", () => {
  it("contributes a whole plot to `plots`, and the widget's badge slot", () => {
    const ids = (slot: string) =>
      getContributionsForSlot(slot).map((c: AnyContribution) => c.id);
    // Namespaced by the client handle, which is what stops two Uplinks
    // colliding on an id somebody picked independently. Note the plot names no
    // host: `plots` is one slot for the app, and this Uplink could not name
    // `landing-status` here even if it wanted to.
    expect(ids("plots")).toContain("aero:descent-envelope");
    expect(ids("landing-status.badges")).toContain(
      "aero:descent-envelope-badges",
    );
  });

  it("gates both on the aerodynamics Domain being present", () => {
    for (const slot of ["plots", "landing-status.badges"]) {
      for (const c of getContributionsForSlot(slot)) {
        if (c.id.startsWith("aero:")) expect(c.requires).toBe("aero");
      }
    }
  });
});

/**
 * The body's own gravity, read where the stream reports it.
 *
 * <p>These go through the registered contribution rather than
 * `aeroDescentLayers`, because the layer builder takes gravity as an argument
 * and so cannot see where it came from. Every test above hands it 9.81
 * directly, which is why the resolution step had no coverage at all.</p>
 */
describe("surface gravity", () => {
  /*
   * The app registers these at startup, so a test without them cannot tell a
   * body resolved from the static table apart from one that resolved nowhere:
   * both come back empty and a comparison between them passes saying nothing.
   */
  registerStockBodies();

  const descentPlot = () =>
    getContributionsForSlot("plots").find(
      (c: AnyContribution) => c.id === "aero:descent-envelope",
    );

  /** The PLOT entry above, as the topics a live stream would carry. */
  const topicsForBody = (name: string, gees: number | null) => ({
    "aero.state": {
      angleOfAttack: { magnitude: 40.2, unit: "deg" },
      stallFraction: { magnitude: 0.18, unit: "ratio" },
      terminalVelocity: { magnitude: 180, unit: "m/s" },
      ballisticCoefficient: { magnitude: 391, unit: "kg/m^2" },
      aeroModelValid: true,
    },
    "vessel.landing": {
      terminalVelocity: { magnitude: PLOT.plotTerminal, unit: "m/s" },
      projectedTouchdownSpeed: { magnitude: PLOT.plotTouchdown, unit: "m/s" },
    },
    "vessel.flight": {
      surfaceSpeed: { magnitude: PLOT.speed, unit: "m/s" },
    },
    "vessel.surface": {
      heightFromTerrain: { magnitude: PLOT.altitude, unit: "m" },
    },
    "vessel.identity": { parentBodyIndex: 1 },
    "system.bodies": {
      bodies: [
        {
          index: 1,
          name,
          ...(gees === null
            ? {}
            : { surfaceGravity: { magnitude: gees, unit: "g" } }),
        },
      ],
    },
  });

  const layerIds = (name: string, gees: number | null) => {
    const plot = descentPlot();
    if (!plot) throw new Error("the descent-envelope contribution is missing");
    const out = plot.compute(topicsForBody(name, gees)) as
      | { layers: PlotLayer[] }[]
      | null;
    return (out?.[0]?.layers ?? []).map((l) => l.id);
  };

  /*
   * The same body under two planet packs. RSS renames Kerbin to Earth and
   * changes nothing the plot depends on, because the stream reports the
   * gravity either way. A rename that moves the plot means the gravity is not
   * being read from the stream at all.
   */
  it("draws the same plot whatever the pack calls the body", () => {
    expect(layerIds("Earth", 1)).toEqual(layerIds("Kerbin", 1));
  });

  it("projects the descent for a body no static table knows", () => {
    expect(layerIds("Earth", 1)).toContain("model-settle");
  });

  /* Nothing to read and nothing to guess from: the projection is withheld
   * rather than drawn against a gravity we made up. */
  it("draws no projection when the stream omits the gravity", () => {
    expect(layerIds("Gilly", null)).not.toContain("model-settle");
  });
});
