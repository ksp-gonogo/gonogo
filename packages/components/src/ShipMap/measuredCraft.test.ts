import type { VesselTopology } from "@ksp-gonogo/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import lfv2Wave from "./__fixtures__/lfv2-wave-19parts.json";
import lfv2WavePower from "./__fixtures__/lfv2-wave-power-23parts.json";
import lfv2WaveProbe from "./__fixtures__/lfv2-wave-probe-14parts.json";
import { renderPartShape } from "./partShape";
import { type ProjectedPart, project } from "./shipLayout";
import { buildShipMapPart, pickLateralAxis } from "./shipTopology";

/*
 * Craft whose mesh boxes and rotations were measured in the game. The probe is
 * the craft the drawing was matched against; the other two are checked by the
 * same rules with nothing tuned for them.
 */
interface Fixture {
  "v.topology": VesselTopology;
  _comment: string;
}

const CRAFT: [string, Fixture][] = [
  ["lfv2-wave-probe", lfv2WaveProbe as Fixture],
  ["lfv2-wave", lfv2Wave as Fixture],
  ["lfv2-wave-power", lfv2WavePower as Fixture],
];

/* The power craft's Communotron sits above the top of the tank it is attached to and clear of it in the game as well, so contact is checked on the other two. */
const BUILT_IN_CONTACT = CRAFT.slice(0, 2);

/** A touch closer than this counts as contact: rounding in the fixtures and the gap KSP leaves at an attach node. */
const CONTACT_TOLERANCE_M = 0.02;

function layout(fixture: Fixture): ProjectedPart[] {
  const topo = fixture["v.topology"];
  const { useX } = pickLateralAxis(topo.parts);
  return project(
    topo.parts.map((p) => buildShipMapPart(p, undefined, undefined, useX)),
  ).projected;
}

/** The diagram-space box a part covers once its upright box is turned by its rotation. */
function drawnBox(p: ProjectedPart) {
  const halfW = (p.body.latMax - p.body.latMin) / 2;
  const halfH = (p.body.axialMax - p.body.axialMin) / 2;
  const c = Math.abs(Math.cos(p.rotationRad));
  const s = Math.abs(Math.sin(p.rotationRad));
  const lat = halfW * c + halfH * s;
  const axial = halfW * s + halfH * c;
  return {
    latMin: p.lat - lat,
    latMax: p.lat + lat,
    axialMin: p.axial - axial,
    axialMax: p.axial + axial,
  };
}

function gapBetween(a: ProjectedPart, b: ProjectedPart): number {
  const ba = drawnBox(a);
  const bb = drawnBox(b);
  const latGap = Math.max(ba.latMin - bb.latMax, bb.latMin - ba.latMax, 0);
  const axialGap = Math.max(
    ba.axialMin - bb.axialMax,
    bb.axialMin - ba.axialMax,
    0,
  );
  return Math.hypot(latGap, axialGap);
}

describe.each(BUILT_IN_CONTACT)("measured craft %s", (_name, fixture) => {
  const parts = layout(fixture);
  const byId = new Map(parts.map((p) => [p.flightId, p]));

  it("draws every part touching the part it is attached to", () => {
    const apart = parts
      .filter((p) => p.parentFlightId != null)
      .map((p) => {
        const parent = byId.get(p.parentFlightId as number) as ProjectedPart;
        return {
          part: p.name,
          parent: parent.name,
          gap: gapBetween(p, parent),
        };
      })
      .filter((g) => g.gap > CONTACT_TOLERANCE_M);
    expect(apart).toEqual([]);
  });
});

describe.each(CRAFT)("measured craft %s", (_name, fixture) => {
  const parts = layout(fixture);

  it("draws the stack with no gap between neighbours", () => {
    const stack = parts
      .filter((p) => Math.abs(p.lat) < 0.05 && Math.abs(p.depth) < 0.05)
      .sort((a, b) => a.body.axialMin - b.body.axialMin);
    for (let i = 1; i < stack.length; i++) {
      expect(
        stack[i].body.axialMin - stack[i - 1].body.axialMax,
        `${stack[i - 1].name} to ${stack[i].name}`,
      ).toBeLessThanOrEqual(CONTACT_TOLERANCE_M);
    }
  });

  it("draws each radial part on its own side, no wider than its mesh", () => {
    for (const p of parts) {
      if (Math.abs(p.lat) < 0.05) continue;
      const box = drawnBox(p);
      const largest = Math.hypot(p.size.x, p.size.y, p.size.z);
      expect(box.latMax - box.latMin, p.name).toBeLessThanOrEqual(largest);
      expect(Math.sign((box.latMin + box.latMax) / 2), p.name).toBe(
        Math.sign(p.lat),
      );
    }
  });
});

describe("measured craft lfv2-wave-probe", () => {
  const parts = layout(lfv2WaveProbe as Fixture);

  it("draws the radial chutes at their mesh size beside the tank", () => {
    const tank = parts.find(
      (p) => p.name === "fuelTankSmallFlat",
    ) as ProjectedPart;
    const chutes = parts.filter((p) => p.name === "parachuteRadial");
    expect(chutes).toHaveLength(2);
    for (const chute of chutes) {
      const box = drawnBox(chute);
      expect(box.latMax - box.latMin).toBeLessThan(0.25);
      expect(box.axialMax - box.axialMin).toBeCloseTo(0.84, 2);
      expect(Math.abs(chute.lat)).toBeGreaterThan(tank.body.latMax - 0.1);
    }
  });
});

describe("measured craft lfv2-wave", () => {
  const parts = layout(lfv2Wave as Fixture);

  it("draws a fin across the view at its mesh span, turned by its yaw", () => {
    // The fin at yaw 345 degrees: its 1.497 m span and 0.097 m thickness seen 15 degrees off face-on.
    const fin = parts
      .filter((p) => p.name === "winglet")
      .reduce((a, b) => (a.lat < b.lat ? a : b));
    const yaw = (15 * Math.PI) / 180;
    expect(fin.latHalfExtent * 2).toBeCloseTo(
      1.4971 * Math.cos(yaw) + 0.097 * Math.sin(yaw),
      3,
    );
    expect(fin.axialHalfExtent * 2).toBeCloseTo(2.11, 3);
  });

  it("draws the decoupler as a disc the width of the stack", () => {
    const decoupler = parts.find(
      (p) => p.name === "Decoupler.1",
    ) as ProjectedPart;
    expect(decoupler.body.latMax - decoupler.body.latMin).toBeCloseTo(1.25, 2);
    expect(decoupler.body.axialMax - decoupler.body.axialMin).toBeCloseTo(
      0.16,
      2,
    );
  });
});

/** Pixels per metre for the shape checks, large enough that no minimum-size floor in the drawing applies. */
const SHAPE_SCALE = 100;

interface Extent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function sampleBezier(pts: number[][], steps = 40): number[][] {
  const out: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let level = pts;
    while (level.length > 1) {
      level = level
        .slice(1)
        .map((q, k) => q.map((v, d) => v * t + level[k][d] * (1 - t)));
    }
    out.push(level[0]);
  }
  return out;
}

/** One attribute of a tag as a number. */
function numAttr(tag: string, attr: string): number {
  return Number(new RegExp(`\\s${attr}="([^"]+)"`).exec(tag)?.[1]);
}

function rectPoints(tag: string): number[][] {
  const [x, y, w, h] = ["x", "y", "width", "height"].map((a) =>
    numAttr(tag, a),
  );
  return [
    [x, y],
    [x + w, y + h],
  ];
}

function ellipsePoints(tag: string): number[][] {
  const isCircle = tag.startsWith("<circle");
  const cx = numAttr(tag, "cx");
  const cy = numAttr(tag, "cy");
  const rx = numAttr(tag, isCircle ? "r" : "rx");
  const ry = numAttr(tag, isCircle ? "r" : "ry");
  return [
    [cx - rx, cy - ry],
    [cx + rx, cy + ry],
  ];
}

function polygonPoints(tag: string): number[][] {
  const nums =
    /points="([^"]+)"/
      .exec(tag)?.[1]
      .split(/[\s,]+/)
      .map(Number) ?? [];
  const points: number[][] = [];
  for (let i = 0; i < nums.length; i += 2) points.push([nums[i], nums[i + 1]]);
  return points;
}

function pathPoints(tag: string): number[][] {
  const d = /\sd="([^"]+)"/.exec(tag)?.[1] ?? "";
  const points: number[][] = [];
  let cur = [0, 0];
  for (const [, cmd, args] of d.matchAll(/([MLCQ])\s*([^MLCQZ]*)/g)) {
    const n = args
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    const per = cmd === "C" ? 6 : cmd === "Q" ? 4 : 2;
    for (let i = 0; i < n.length; i += per) {
      const seg: number[][] = [];
      for (let k = 0; k < per; k += 2) seg.push([n[i + k], n[i + k + 1]]);
      if (cmd === "C" || cmd === "Q")
        points.push(...sampleBezier([cur, ...seg]));
      if (cmd !== "C" && cmd !== "Q") points.push(seg[0]);
      cur = seg[seg.length - 1];
    }
  }
  return points;
}

const POINTS_OF_TAG: Record<string, (tag: string) => number[][]> = {
  rect: rectPoints,
  ellipse: ellipsePoints,
  circle: ellipsePoints,
  polygon: polygonPoints,
  path: pathPoints,
};

/** Points on every outline in the markup: the corners, ellipse extremes and the sampled curves of a path. */
function outlinePoints(markup: string): number[][] {
  return [
    ...markup.matchAll(/<(rect|ellipse|circle|polygon|path)\b[^>]*>/g),
  ].flatMap(([tag, name]) => POINTS_OF_TAG[name](tag));
}

function extentOf(points: number[][]): Extent {
  const xs = points.map((q) => q[0]);
  const ys = points.map((q) => q[1]);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

describe.each(CRAFT)("measured craft %s drawn shapes", (_name, fixture) => {
  it("fills the part's box, so the neighbour above or beside it touches", () => {
    const off: string[] = [];
    for (const p of layout(fixture)) {
      const w = (p.body.latMax - p.body.latMin) * SHAPE_SCALE;
      const h = (p.body.axialMax - p.body.axialMin) * SHAPE_SCALE;
      const box = {
        x: p.body.latMin * SHAPE_SCALE,
        y: -p.body.axialMax * SHAPE_SCALE,
        w,
        h,
      };
      const center = { x: box.x + w / 2, y: box.y + h / 2 };
      const markup = renderToStaticMarkup(
        renderPartShape(
          p.type,
          box,
          center,
          "#fff",
          false,
          1,
          p.lat >= 0 ? 1 : -1,
        ),
      );
      const e = extentOf(outlinePoints(markup));
      const slack = 0.5;
      const drawnW = e.maxX - e.minX;
      const drawnH = e.maxY - e.minY;
      if (
        Math.abs(drawnW - w) > slack ||
        Math.abs(drawnH - h) > slack ||
        Math.abs(e.minY - box.y) > slack ||
        Math.abs(e.maxY - (box.y + h)) > slack
      ) {
        off.push(
          `${p.name} (${p.type}): drawn ${drawnW.toFixed(1)}x${drawnH.toFixed(1)} from y ${e.minY.toFixed(1)}, box ${w.toFixed(1)}x${h.toFixed(1)} from y ${box.y.toFixed(1)}`,
        );
      }
    }
    expect(off).toEqual([]);
  });
});
