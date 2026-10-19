import type { VesselTopology } from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
import lfv2Wave from "./__fixtures__/lfv2-wave-19parts.json";
import lfv2WavePower from "./__fixtures__/lfv2-wave-power-23parts.json";
import lfv2WaveProbe from "./__fixtures__/lfv2-wave-probe-14parts.json";
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
