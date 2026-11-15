import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TopologyPart } from "@ksp-gonogo/core";
import {
  type DecodedPartShape,
  decodePartShape,
  deriveTopologyFromVesselParts,
} from "@ksp-gonogo/data";
import { wrapTopicPayload } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { seatRadialParts } from "./radialSeat";

const DIR = join(__dirname, "__fixtures__", "probe");

interface Loaded {
  parts: readonly TopologyPart[];
  shapeOf: (key: string) => DecodedPartShape | undefined;
}

function load(file: string): Loaded {
  const fixture = JSON.parse(readFileSync(join(DIR, file), "utf8"));
  const emits: { channel: string; value: never }[] = fixture._stream.emits;
  const wire = emits.find((e) => e.channel === "vessel.parts");
  const shapes = new Map<string, DecodedPartShape>();
  for (const e of emits) {
    if (e.channel.startsWith("parts.shape.")) {
      shapes.set(
        e.channel.slice("parts.shape.".length),
        decodePartShape(e.value),
      );
    }
  }
  const parts = wrapTopicPayload("vessel.parts", structuredClone(wire?.value));
  return {
    parts: deriveTopologyFromVesselParts(parts as never).parts,
    shapeOf: (key) => shapes.get(key),
  };
}

const named = (parts: readonly TopologyPart[], name: string) =>
  parts.filter((p) => p.name === name);

const tiltOf = (p: TopologyPart) =>
  Math.acos(Math.min(1, p.up?.[1] ?? 1)) * (180 / Math.PI);

describe("seatRadialParts", () => {
  const { parts, shapeOf } = load("chutes-packed.json");
  const seated = seatRadialParts(parts, shapeOf);
  const podOrigin = named(parts, "mk1pod.v2")[0].orgPos;

  it("brings a side tank in from its gap to rest against the pod", () => {
    for (const tank of named(seated, "fuelTankSmallFlat")) {
      const before = named(parts, "fuelTankSmallFlat").find(
        (p) => p.flightId === tank.flightId,
      ) as TopologyPart;
      const reach = (p: TopologyPart) => Math.abs(p.orgPos[2] - podOrigin[2]);
      expect(reach(before)).toBeCloseTo(1.88, 1);
      expect(reach(tank)).toBeLessThan(1.4);
      expect(reach(tank)).toBeGreaterThan(1.0);
    }
  });

  it("keeps a side tank's orientation as the wire gives it", () => {
    for (const tank of named(seated, "fuelTankSmallFlat")) {
      const was = parts.find((p) => p.flightId === tank.flightId);
      expect(tank.up).toBe(was?.up);
      expect(tank.forward).toBe(was?.forward);
    }
  });

  it("carries a drogue mounted on a moved tank along with it", () => {
    const tank = named(seated, "fuelTankSmallFlat")[0];
    const drogue = named(seated, "parachuteDrogue").find(
      (p) => p.parentFlightId === tank.flightId,
    ) as TopologyPart;
    const was = named(parts, "parachuteDrogue").find(
      (p) => p.flightId === drogue.flightId,
    ) as TopologyPart;
    expect(Math.abs(drogue.orgPos[2])).toBeLessThan(Math.abs(was.orgPos[2]));
    expect(drogue.up).toBe(was.up);
  });

  it("leans each radial chute with the pod's sloped side, and the pair alike", () => {
    const chutes = named(seated, "parachuteRadial");
    expect(chutes).toHaveLength(2);
    for (const chute of chutes) {
      expect(tiltOf(chute)).toBeGreaterThan(5);
      expect(tiltOf(chute)).toBeLessThan(30);
    }
    expect(tiltOf(chutes[0])).toBeCloseTo(tiltOf(chutes[1]), 0);
    // The side that narrows upward leans in at its top.
    for (const chute of chutes) {
      const side = Math.sign(chute.orgPos[0] - podOrigin[0]);
      expect(Math.sign(chute.up?.[0] ?? 0)).toBe(-side);
    }
  });

  it("leaves a part stacked on its parent's axis where it was", () => {
    for (const name of ["parachuteLarge", "solidBooster.sm.v2", "mk1pod.v2"]) {
      const was = named(parts, name)[0];
      expect(named(seated, name)[0]).toBe(was);
    }
  });

  it("changes nothing when the parent's shape has not arrived", () => {
    expect(seatRadialParts(parts, () => undefined)).toBe(parts);
  });

  it("changes nothing in a craft with no radial part", () => {
    for (const file of readdirSync(DIR).filter(
      (f) => f.endsWith(".json") && !f.startsWith("chutes-"),
    )) {
      const loaded = load(file);
      expect(seatRadialParts(loaded.parts, loaded.shapeOf), file).toBe(
        loaded.parts,
      );
    }
  });
});
