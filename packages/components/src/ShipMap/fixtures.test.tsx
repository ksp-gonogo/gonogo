import type { VesselTopology } from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
import fuellinePrelaunch from "./__fixtures__/fuelline-tester-22parts-prelaunch.json";
import fuellinePostStage2 from "./__fixtures__/fuelline-tester-poststage2.json";
import roverBAlone from "./__fixtures__/rover-b-alone-28parts.json";
import roverMerged from "./__fixtures__/rover-merged-56parts.json";
import {
  buildShipMapPart,
  pickLateralAxis,
  type ShipMapPart,
} from "./shipTopology";

/** Invariants encoded by raw topology payloads captured from live KSP sessions, pinning the wire shape a future capture must match. */

interface Fixture {
  "v.topology": VesselTopology;
}

function loadParts(fixture: Fixture): ShipMapPart[] {
  const topo = fixture["v.topology"];
  const { useX } = pickLateralAxis(topo.parts);
  return topo.parts.map((p) => buildShipMapPart(p, undefined, undefined, useX));
}

describe("Ship Map fixtures", () => {
  it("rover-b-alone: 28 parts, vertical Y stack, classifyable", () => {
    const parts = loadParts(roverBAlone as Fixture);
    expect(parts).toHaveLength(28);
    // Y is the stack axis, so parts span a non-zero axial range.
    const axials = parts.map((p) => p.axial);
    const axialSpan = Math.max(...axials) - Math.min(...axials);
    expect(axialSpan).toBeGreaterThan(1);
    // Every part has a classified type.
    expect(parts.every((p) => typeof p.type === "string")).toBe(true);
  });

  it("rover-merged: 56 parts, both docking ports present, T-shape", () => {
    const parts = loadParts(roverMerged as Fixture);
    expect(parts).toHaveLength(56);
    const dockingPorts = parts.filter((p) =>
      p.name.toLowerCase().includes("docking"),
    );
    expect(dockingPorts).toHaveLength(2);
    // A T-shape spreads on both X and Z; the chosen lateral is not all zeros.
    const lats = parts.map((p) => p.lat);
    const latSpan = Math.max(...lats) - Math.min(...lats);
    expect(latSpan).toBeGreaterThan(0);
  });

  it("fuelline-tester-prelaunch: 22 parts, 2 fuel lines via CModuleFuelLine", () => {
    const fixture = fuellinePrelaunch as Fixture;
    const topo = fixture["v.topology"];
    const fuelLines = topo.parts.filter((p) =>
      (p.modules ?? []).includes("CModuleFuelLine"),
    );
    expect(fuelLines).toHaveLength(2);
    // Each fuel line's parentFlightId points at its "from" tank; the "to" tank is not in the topology.
    for (const line of fuelLines) {
      expect(line.parentFlightId).not.toBeNull();
    }
  });

  it("fuelline-tester-poststage2: minimum-survival craft renders", () => {
    const parts = loadParts(fuellinePostStage2 as Fixture);
    // Pod, parachute and two antennas: the tiny-vessel edge case.
    expect(parts).toHaveLength(4);
    expect(parts.some((p) => p.name === "mk1pod.v2")).toBe(true);
    expect(parts.some((p) => p.name === "parachuteSingle")).toBe(true);
  });

  it("axis fix: every fixture renders with Y as the axial axis", () => {
    // The lateral candidates are X and Z, never Y, or stacks lose their vertical orientation.
    for (const fixture of [
      roverBAlone,
      roverMerged,
      fuellinePrelaunch,
      fuellinePostStage2,
    ]) {
      const topo = (fixture as Fixture)["v.topology"];
      const { useX } = pickLateralAxis(topo.parts);
      expect(typeof useX).toBe("boolean");
      // Every part's axial is orgPos[1] (Y).
      const sample = topo.parts[0];
      const built = buildShipMapPart(sample, undefined, undefined, useX);
      expect(built.axial).toBe(sample.orgPos[1]);
    }
  });
});
