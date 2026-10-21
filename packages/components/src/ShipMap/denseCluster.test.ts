import type { VesselTopology } from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
import fuellinePostStage2 from "./__fixtures__/fuelline-tester-poststage2.json";
import lfv2Wave from "./__fixtures__/lfv2-wave-19parts.json";
import lfv2WaveProbe from "./__fixtures__/lfv2-wave-probe-14parts.json";
import { findDenseClusters } from "./denseCluster";
import { project } from "./shipLayout";
import { buildShipMapPart } from "./shipTopology";
import { pickView } from "./shipView";

/** A captured topology fixture; its free-text note is declared because an undeclared key fails the cast. */
interface Fixture {
  "v.topology": VesselTopology;
  _comment?: string;
}

function projected(fixture: Fixture) {
  const topo = fixture["v.topology"];
  const view = pickView(topo.parts);
  return project(
    topo.parts.map((p) => buildShipMapPart(p, undefined, undefined, view)),
  ).projected;
}

describe("findDenseClusters", () => {
  it("finds the ring of nine radial parts on the probe's tank", () => {
    const parts = projected(lfv2WaveProbe as Fixture);
    const clusters = findDenseClusters(parts, 0.02);
    expect(clusters).toHaveLength(1);
    const tank = parts.find((p) => p.name === "fuelTankSmallFlat");
    expect(clusters[0].parentFlightId).toBe(tank?.flightId);
    expect(clusters[0].members).toHaveLength(9);
    const parentWidth = (tank?.latHalfExtent ?? 0) * 2;
    for (const m of clusters[0].members) {
      expect(m.latHalfExtent * 2).toBeLessThan(parentWidth * 0.8);
    }
  });

  it("finds the same ring on a craft that has the rest of its stack below", () => {
    const clusters = findDenseClusters(projected(lfv2Wave as Fixture), 0.02);
    expect(clusters.map((c) => c.members.length)).toEqual([9]);
  });

  it("finds nothing on a craft whose parts are each readable in place", () => {
    expect(
      findDenseClusters(projected(fuellinePostStage2 as Fixture), 0.02),
    ).toEqual([]);
  });

  it("finds nothing once fewer than four of the ring crowd a sibling", () => {
    const parts = projected(lfv2WaveProbe as Fixture);
    const tank = parts.find((p) => p.name === "fuelTankSmallFlat");
    const ring = parts.filter(
      (p) =>
        p.parentFlightId === tank?.flightId &&
        p.latHalfExtent * 2 < (tank?.latHalfExtent ?? 0) * 1.6,
    );
    expect(ring).toHaveLength(9);
    const dropped = new Set(ring.slice(3).map((p) => p.flightId));
    const thinned = parts.filter((p) => !dropped.has(p.flightId));
    expect(findDenseClusters(thinned, 0.02)).toEqual([]);
  });
});
