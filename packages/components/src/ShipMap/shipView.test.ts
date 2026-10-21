import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deriveTopologyFromVesselParts } from "@ksp-gonogo/data";
import type { VesselParts } from "@ksp-gonogo/sitrep-sdk";
import { wrapTopicPayload } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { type CraftWire, craftParts } from "./craftSet";
import { project } from "./shipLayout";
import { depthOf, lateralOf, partMeshCenter } from "./shipTopology";
import { pickView, turnedView, VIEW_STEPS_PER_TURN } from "./shipView";

function wireOf(name: string): CraftWire {
  return JSON.parse(
    readFileSync(
      join(__dirname, "__fixtures__", "craftset", `${name}.json`),
      "utf8",
    ),
  );
}

type Wire = CraftWire & {
  parts: {
    position: { x: number; y: number; z: number };
    up: { x: number; y: number; z: number };
    forward: { x: number; y: number; z: number };
  }[];
};

/** The frame the wire reports, turned `angle` radians about the spine, as a craft whose root part sits skewed would report it. */
function turnedAboutSpine(wire: CraftWire, angle: number): CraftWire {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const turn = (v: { x: number; y: number; z: number }) => ({
    x: v.x * c + v.z * s,
    y: v.y,
    z: -v.x * s + v.z * c,
  });
  const out = structuredClone(wire) as Wire;
  for (const p of out.parts) {
    p.position = turn(p.position);
    p.up = turn(p.up);
    p.forward = turn(p.forward);
  }
  return out;
}

function topologyOf(wire: CraftWire) {
  return deriveTopologyFromVesselParts(
    wrapTopicPayload<VesselParts>(
      "vessel.parts",
      structuredClone({ parts: wire.parts }) as never,
    ),
  );
}

/** The share of parts that have a same-named part within `reach` metres of their mirror image across the spine in `view`. */
function mirroredShare(wire: CraftWire, view: number, reach: number): number {
  const centres = topologyOf(wire).parts.map((p) => {
    const [x, y, z] = partMeshCenter(p);
    return { name: p.name, v: { x, y, z } };
  });
  const matched = centres.filter((m) => {
    const lat = lateralOf(m.v, view);
    const depth = depthOf(m.v, view);
    return centres.some(
      (o) =>
        o.name === m.name &&
        Math.hypot(
          lateralOf(o.v, view) + lat,
          depthOf(o.v, view) - depth,
          o.v.y - m.v.y,
        ) <= reach,
    );
  });
  return matched.length / centres.length;
}

/** The most mirrored any view of the craft is, over views every 5 degrees. */
function bestMirroredShare(wire: CraftWire): number {
  return Math.max(
    ...Array.from({ length: 36 }, (_, k) =>
      mirroredShare(wire, (k * 5 * Math.PI) / 180, 0.1),
    ),
  );
}

/** An angle taken modulo half a turn, where a view and the one opposite it are the same. */
function modHalfTurn(angle: number): number {
  const half = Math.PI;
  return ((angle % half) + half) % half;
}

describe("the default view of a craft", () => {
  it("looks at a plane from above, with the wings across the screen", () => {
    const wire = wireOf("learstar-orbiter");
    const view = pickView(topologyOf(wire).parts);
    const planform = project(craftParts(wire)).bounds;
    const sideOn = project(craftParts(wire, 2)).bounds;
    expect(view).toBeCloseTo(0, 6);
    expect(planform.w).toBeGreaterThan(9);
    expect(sideOn.w).toBeLessThan(planform.w / 2);
  });

  it("finds the mirror plane of a plane whose frame is skewed", () => {
    const skew = (25 * Math.PI) / 180;
    const wire = turnedAboutSpine(wireOf("learstar-orbiter"), skew);
    const view = pickView(topologyOf(wire).parts);
    expect(modHalfTurn(view)).toBeCloseTo(modHalfTurn(-skew), 1);
    expect(mirroredShare(wire, view, 0.1)).toBeGreaterThan(0.95);
    // The wings are drawn equally on both sides of the spine.
    const { projected } = project(craftParts(wire));
    const wings = projected.filter((p) => p.name === "sweptWing2");
    const left = wings.find((p) => p.lat < 0);
    const right = wings.find((p) => p.lat > 0);
    expect(left && right).toBeTruthy();
    expect(-(left?.lat ?? 0)).toBeCloseTo(right?.lat ?? 0, 1);
  });

  it("puts a radially symmetric rocket in a view that shows it mirrored", () => {
    const skew = (17 * Math.PI) / 180;
    const wire = turnedAboutSpine(wireOf("kerbal-x"), skew);
    const view = pickView(topologyOf(wire).parts);
    expect(mirroredShare(wire, view, 0.1)).toBeGreaterThanOrEqual(
      bestMirroredShare(wire) - 0.05,
    );
  });

  it("keeps the vessel's own X axis across the screen for a craft already symmetric about it", () => {
    for (const name of ["kerbal-x", "station-core", "learstar-a1"]) {
      const view = pickView(topologyOf(wireOf(name)).parts);
      expect(Math.abs(view), name).toBeLessThan(Math.PI / 2 + 1e-9);
      expect(
        mirroredShare(wireOf(name), view, 0.1),
        name,
      ).toBeGreaterThanOrEqual(bestMirroredShare(wireOf(name)) - 0.05);
    }
  });

  it("is not thrown by a craft with one part", () => {
    expect(pickView([])).toBe(0);
  });
});

describe("rotating the view", () => {
  const wire = wireOf("learstar-orbiter");
  const widthAt = (steps: number) => project(craftParts(wire, steps)).bounds.w;

  it("turns the craft a step at a time and comes back after a full turn", () => {
    expect(widthAt(1)).not.toBeCloseTo(widthAt(0), 1);
    expect(widthAt(VIEW_STEPS_PER_TURN)).toBeCloseTo(widthAt(0), 6);
    expect(turnedView(0.3, 0)).toBe(0.3);
  });

  it("shows the craft from the other side after half a turn, wings still equal", () => {
    expect(widthAt(VIEW_STEPS_PER_TURN / 2)).toBeCloseTo(widthAt(0), 6);
  });
});
