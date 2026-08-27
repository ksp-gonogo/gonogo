import type { PlotLayer } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  buildDescentLayers,
  classifyUrgency,
  descentFrame,
} from "./descentLayers";

/**
 * The descent envelope's own marks, tested as the DATA they now are.
 *
 * These assertions used to be read back out of rendered SVG attributes: a
 * `points` string, a `stroke-dasharray`, a `cx`. That was always testing the
 * shadow rather than the claim, and it is why so much of the old file was about
 * pixel arithmetic the shared chart now owns. What the widget actually decides
 * is WHICH layers exist and what they say, and that is what is checked here.
 * How a layer is drawn belongs to `packages/ui/src/plotLayers.tsx`, and whether
 * they reach the chart at all to `DescentEnvelope.test.tsx`.
 */

const KERBIN_G = 9.81;

/** A Kerbin entry at 28 km, still far above terminal. */
const ENTRY = {
  currentSpeed: 2200,
  currentAltitude: 28_000,
  terminalVelocity: 300,
  projectedTouchdownSpeed: 95,
  surfaceGravity: KERBIN_G,
};

const byId = (layers: PlotLayer[], id: string) =>
  layers.find((l) => l.id === id);
const ids = (layers: PlotLayer[]) => layers.map((l) => l.id);
const spoken = (layers: PlotLayer[]) =>
  layers
    .map((l) => l.description ?? "")
    .filter(Boolean)
    .join(" | ");

describe("descentFrame", () => {
  it("needs both terminal anchors and a positive altitude span", () => {
    expect(descentFrame(ENTRY)).not.toBeNull();
    expect(descentFrame({ ...ENTRY, terminalVelocity: null })).toBeNull();
    expect(
      descentFrame({ ...ENTRY, projectedTouchdownSpeed: null }),
    ).toBeNull();
    expect(descentFrame({ ...ENTRY, currentAltitude: 0 })).toBeNull();
    expect(descentFrame({ ...ENTRY, currentAltitude: Number.NaN })).toBeNull();
  });

  it("does not require a current speed: the curve stands without the mark", () => {
    expect(descentFrame({ ...ENTRY, currentSpeed: null })).not.toBeNull();
  });

  it("spans the ground to a little above the vessel, and zero to past the fastest", () => {
    const frame = descentFrame(ENTRY);
    expect(frame?.yDomain[0]).toBe(0);
    expect(frame?.yDomain[1]).toBeGreaterThan(28_000);
    expect(frame?.xDomain[0]).toBe(0);
    // The vessel is the fastest thing in play here, so it sets the span, and
    // it must not end up sat on the frame.
    expect(frame?.xDomain[1]).toBeGreaterThan(2200);
  });
});

describe("action urgency", () => {
  it("is SAFE whenever the do-nothing touchdown is survivable, at any altitude", () => {
    expect(classifyUrgency(5, 50)).toBe("safe");
    expect(classifyUrgency(12, 100_000)).toBe("safe");
  });

  it("is URGENT only when the touchdown is lethal AND altitude is critically low", () => {
    expect(classifyUrgency(60, 900)).toBe("urgent");
    expect(classifyUrgency(60, 9_000)).toBe("caution");
  });

  it("is CAUTION for a hard-but-not-lethal touchdown at any altitude", () => {
    expect(classifyUrgency(30, 100)).toBe("caution");
    expect(classifyUrgency(30, 40_000)).toBe("caution");
  });

  it("names a tone rather than a colour, and carries the word to a reader", () => {
    const urgent = buildDescentLayers({
      ...ENTRY,
      projectedTouchdownSpeed: 60,
      currentAltitude: 900,
    });
    expect(byId(urgent, "vessel")?.tone).toBe("nogo");
    expect(byId(urgent, "urgency")).toMatchObject({
      kind: "caption",
      text: "URGENT",
      tone: "nogo",
    });
    // Colour is never the only channel carrying urgency (WCAG 1.4.1).
    expect(spoken(urgent)).toContain("URGENT, slow now");
  });
});

describe("buildDescentLayers", () => {
  it("contributes NOTHING at all when the plot cannot be drawn", () => {
    // Not an empty plot with zeroed marks: no layers, so nothing is drawn and
    // nothing is spoken.
    expect(buildDescentLayers({ ...ENTRY, terminalVelocity: null })).toEqual(
      [],
    );
  });

  it("draws the terminal curve from the ground to above the vessel", () => {
    const curve = byId(buildDescentLayers(ENTRY), "terminal-curve");
    expect(curve?.kind).toBe("series");
    const points = (curve as Extract<PlotLayer, { kind: "series" }>).points;
    expect(points[0]).toEqual({ x: 95, y: 0 });
    expect(points[points.length - 1].y).toBeGreaterThan(28_000);
    // Bold, so it reads at a glance against the trace laid over it.
    expect(
      (curve as Extract<PlotLayer, { kind: "series" }>).weight,
    ).toBeGreaterThan(1);
  });

  it("keeps the curve's tone off the SAFE mark's, so the two never blend", () => {
    const safe = buildDescentLayers({ ...ENTRY, projectedTouchdownSpeed: 8 });
    expect(byId(safe, "vessel")?.tone).toBe("go");
    expect(byId(safe, "terminal-curve")?.tone).toBe("neutral");
  });

  it("shades the DECELERATING half-plane to the right of the curve", () => {
    const region = byId(buildDescentLayers(ENTRY), "decelerating");
    expect(region).toMatchObject({ kind: "region", side: "right" });
    // The wash is named rather than left as an unexplained tone: it is the
    // boundary the whole plot is built around.
    expect((region as Extract<PlotLayer, { kind: "region" }>).label).toBe(
      "DECELERATING",
    );
  });

  it("washes the plot with THIS body's sky, and a neutral one when unknown", () => {
    const duna = buildDescentLayers({ ...ENTRY, atmosphereColor: "#c1440e" });
    expect(byId(duna, "atmosphere-bands")?.kind).toBe("field");
    expect(
      (byId(duna, "atmosphere-bands") as Extract<PlotLayer, { kind: "field" }>)
        .tint,
    ).toBe("#c1440e");
    const unknown = buildDescentLayers(ENTRY);
    expect(
      (
        byId(unknown, "atmosphere-bands") as Extract<
          PlotLayer,
          { kind: "field" }
        >
      ).tint,
    ).toContain("var(--color");
  });

  it("makes the haze thickest at the ground and fades it toward nothing high up", () => {
    const field = byId(
      buildDescentLayers(ENTRY),
      "atmosphere-bands",
    ) as Extract<PlotLayer, { kind: "field" }>;
    const at = (alt: number) =>
      field.stops.reduce((best, s) =>
        Math.abs(s.at - alt) < Math.abs(best.at - alt) ? s : best,
      ).intensity;
    expect(at(0)).toBe(1);
    expect(at(14_000)).toBeLessThan(1);
    expect(at(31_000)).toBeLessThan(at(14_000));
  });

  it("fades the haze to NOTHING once the plot spans thin enough air", () => {
    // The bands are density halvings and stop below a floor rather than
    // stepping forever, so a plot whose two anchors are far apart (a steep
    // density column) ends in clear air rather than a permanent faint tint.
    // The span that decides this is the RATIO of the anchors, not the
    // altitude: a taller plot of the same column is the same column.
    const field = byId(
      buildDescentLayers({ ...ENTRY, terminalVelocity: 600 }),
      "atmosphere-bands",
    ) as Extract<PlotLayer, { kind: "field" }>;
    expect(field.stops[field.stops.length - 1].intensity).toBe(0);
  });

  it("draws NO trace at all without the body's surface gravity", () => {
    // The one input the integration cannot do without. An absent body renders
    // as an absent trace, never as a trace against a guessed one.
    const layers = buildDescentLayers({ ...ENTRY, surfaceGravity: null });
    expect(ids(layers)).not.toContain("trace-estimate");
    expect(ids(layers)).not.toContain("settle");
    // And the curve is still there: the plot loses the projection, not itself.
    expect(byId(layers, "terminal-curve")).toBeDefined();
  });

  it("draws no trace and no mark without a current speed to leave from", () => {
    const layers = buildDescentLayers({ ...ENTRY, currentSpeed: null });
    expect(ids(layers)).not.toContain("trace-estimate");
    expect(ids(layers)).not.toContain("vessel");
    expect(byId(layers, "terminal-curve")).toBeDefined();
  });

  it("runs the trace from the vessel down to the ground", () => {
    const trace = [
      byId(buildDescentLayers(ENTRY), "trace-estimate"),
      byId(buildDescentLayers(ENTRY), "trace-settled"),
    ].filter(Boolean) as Extract<PlotLayer, { kind: "series" }>[];
    const points = trace.flatMap((t) => t.points);
    expect(points.length).toBeGreaterThan(10);
    expect(Math.min(...points.map((p) => p.y))).toBe(0);
    expect(Math.max(...points.map((p) => p.y))).toBe(28_000);
  });

  it("dashes the part of the trace still to cross the transonic region", () => {
    const supersonic = buildDescentLayers({ ...ENTRY, mach: 7 });
    const subsonic = buildDescentLayers({
      currentSpeed: 105,
      currentAltitude: 900,
      terminalVelocity: 88,
      projectedTouchdownSpeed: 84,
      surfaceGravity: KERBIN_G,
      mach: 0.31,
    });
    expect(
      (
        byId(supersonic, "trace-estimate") as Extract<
          PlotLayer,
          { kind: "series" }
        >
      ).dashed,
    ).toBe(true);
    expect(
      (
        byId(subsonic, "trace-estimate") as Extract<
          PlotLayer,
          { kind: "series" }
        >
      ).dashed,
    ).toBe(false);
  });

  it("marks and names the height the descent settles at", () => {
    const layers = buildDescentLayers(ENTRY);
    const settle = byId(layers, "settle");
    expect(settle?.kind).toBe("annotation");
    expect(
      (settle as Extract<PlotLayer, { kind: "annotation" }>).label,
    ).toMatch(/^SETTLES /);
    // And to a reader, so the shape is never the only channel.
    expect(spoken(layers)).toContain("settles onto the terminal curve");
  });

  it("says so when the descent never settles before the ground", () => {
    // A vessel that arrives still slowing is the reading the plot exists for,
    // and an absent tick must not be the only way to learn it.
    const layers = buildDescentLayers({
      currentSpeed: 2200,
      currentAltitude: 900,
      terminalVelocity: 1800,
      projectedTouchdownSpeed: 900,
      surfaceGravity: KERBIN_G,
    });
    expect(byId(layers, "settle")).toBeUndefined();
    expect(spoken(layers)).toContain("never settles onto the terminal curve");
  });

  it("puts exactly one vessel mark on the plot, as a dot", () => {
    const marks = buildDescentLayers(ENTRY).filter(
      (l) => l.kind === "marker" && l.id === "vessel",
    );
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ shape: "dot" });
  });

  describe("the drag chevron", () => {
    const withRatio = (dragToWeight: number | null) =>
      byId(buildDescentLayers({ ...ENTRY, dragToWeight }), "drag") as
        | Extract<PlotLayer, { kind: "marker" }>
        | undefined;

    it("is absent without a positive, finite ratio", () => {
      expect(withRatio(null)).toBeUndefined();
      expect(withRatio(0)).toBeUndefined();
      expect(withRatio(Number.NaN)).toBeUndefined();
    });

    it("is an OPEN chevron above the mark, never a filled arrow through it", () => {
      const chevron = withRatio(1.6);
      expect(chevron).toMatchObject({ shape: "chevron-up" });
      // Drag pulls the vessel back, the opposite intuition from a shaft
      // growing out of the mark, so it sits above rather than trailing.
      expect(chevron?.offsetPx).toBeLessThan(0);
    });

    it("scales with the ratio and clamps, so a huge reading never runs away", () => {
      const small = withRatio(0.2)?.scale as number;
      const mid = withRatio(1.5)?.scale as number;
      expect(mid).toBeGreaterThan(small);
      expect(withRatio(3)?.scale).toBe(withRatio(50)?.scale);
    });

    it("never carries the ratio by size alone", () => {
      expect(
        spoken(buildDescentLayers({ ...ENTRY, dragToWeight: 2.4 })),
      ).toContain("drag 2.4× weight");
    });
  });

  it("labels the touchdown readout in full, not a cryptic abbreviation", () => {
    const readout = byId(buildDescentLayers(ENTRY), "touchdown") as Extract<
      PlotLayer,
      { kind: "caption" }
    >;
    expect(readout.caption).toBe("TOUCHDOWN SPEED");
    expect(readout.text).toContain("m/s");
  });

  it("puts the readouts in the plot's four corners, never over the marks", () => {
    const anchors = buildDescentLayers(ENTRY)
      .filter(
        (l): l is Extract<PlotLayer, { kind: "caption" }> =>
          l.kind === "caption",
      )
      .map((l) => l.anchor);
    expect(new Set(anchors).size).toBe(anchors.length);
    expect(anchors).toContain("bottom-left");
    expect(anchors).toContain("bottom-right");
    // NOT the altitude: the chart labels its own Y axis and the vessel mark
    // sits against it, so a corner readout would be the same number a third
    // time, printed where the terminal curve passes.
    expect(anchors).not.toContain("top-left");
  });
});
