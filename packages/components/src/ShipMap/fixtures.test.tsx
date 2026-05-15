import type { VesselTopology } from "@gonogo/core";
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

/**
 * Fixture-driven scaffolding for Phase 2 Ship Map snapshot tests.
 *
 * Each fixture is a raw `v.topology` payload captured from a live KSP
 * session 2026-05-15. The tests below assert the *invariants* the
 * fixtures encode — they don't yet do full DOM snapshots; that's the
 * Phase 2 deliverable. For now they at least pin the wire-shape
 * contract so future fixture captures can be validated.
 *
 * See `local_docs/2026-05-16-phase-2-shipmap-handoff.md` for the
 * intended Phase 2 work that extends these.
 */

interface Fixture {
  "v.topology": VesselTopology;
}

function loadParts(fixture: Fixture): ShipMapPart[] {
  const topo = fixture["v.topology"];
  const { useX } = pickLateralAxis(topo.parts);
  return topo.parts.map((p) => buildShipMapPart(p, undefined, undefined, useX));
}

describe("Ship Map fixtures (Phase 2 scaffolding)", () => {
  it("rover-b-alone — 28 parts, vertical Y stack, classifyable", () => {
    const parts = loadParts(roverBAlone as Fixture);
    expect(parts).toHaveLength(28);
    // KSP convention: Y is vessel stack axis. Parts span a non-zero
    // axial range; lateral range may also be non-zero due to radial bits.
    const axials = parts.map((p) => p.axial);
    const axialSpan = Math.max(...axials) - Math.min(...axials);
    expect(axialSpan).toBeGreaterThan(1);
    // Every part has a classified type (no raw passthroughs).
    expect(parts.every((p) => typeof p.type === "string")).toBe(true);
  });

  it("rover-merged — 56 parts, both docking ports present, T-shape", () => {
    const parts = loadParts(roverMerged as Fixture);
    expect(parts).toHaveLength(56);
    const dockingPorts = parts.filter((p) =>
      p.name.toLowerCase().includes("docking"),
    );
    expect(dockingPorts).toHaveLength(2);
    // T-shape signature: pickLateralAxis should detect spread on
    // both X and Z; the wider one wins. Confirm the picker doesn't
    // crash and the chosen lateral isn't all zeros.
    const lats = parts.map((p) => p.lat);
    const latSpan = Math.max(...lats) - Math.min(...lats);
    expect(latSpan).toBeGreaterThan(0);
  });

  it("fuelline-tester-prelaunch — 22 parts, 2 fuel lines via CModuleFuelLine", () => {
    const fixture = fuellinePrelaunch as Fixture;
    const topo = fixture["v.topology"];
    const fuelLines = topo.parts.filter((p) =>
      (p.modules ?? []).includes("CModuleFuelLine"),
    );
    expect(fuelLines).toHaveLength(2);
    // Phase 2 Item 4: each fuel line's parentFlightId points at its
    // "from" tank. The "to" tank isn't in the topology yet — fork
    // extension needed. Lock the current contract.
    for (const line of fuelLines) {
      expect(line.parentFlightId).not.toBeNull();
    }
  });

  it("fuelline-tester-poststage2 — minimum-survival craft renders", () => {
    const parts = loadParts(fuellinePostStage2 as Fixture);
    // Pod + parachute + 2 antennas — edge-case for tiny vessels.
    expect(parts).toHaveLength(4);
    expect(parts.some((p) => p.name === "mk1pod.v2")).toBe(true);
    expect(parts.some((p) => p.name === "parachuteSingle")).toBe(true);
  });

  it("axis fix: every fixture renders with Y as the axial axis", () => {
    // Regression guard for the 2026-05-15 rotation bug
    // (shipTopology.ts:191-242). If the picker reverts to comparing
    // X-vs-Y as lateral candidates, the axial direction becomes Z
    // and stacks lose their vertical orientation.
    for (const fixture of [
      roverBAlone,
      roverMerged,
      fuellinePrelaunch,
      fuellinePostStage2,
    ]) {
      const topo = (fixture as Fixture)["v.topology"];
      const { useX } = pickLateralAxis(topo.parts);
      // useX is the lateral choice (X or Z) — never Y. If the bug
      // returns, the picker would have to be modified directly.
      expect(typeof useX).toBe("boolean");
      // Every part's axial should be orgPos[1] (Y) per the fix.
      const sample = topo.parts[0];
      const built = buildShipMapPart(sample, undefined, undefined, useX);
      expect(built.axial).toBe(sample.orgPos[1]);
    }
  });
});
