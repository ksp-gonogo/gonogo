import {
  RosterCommsControlSource,
  Situation,
  type SystemBodies,
  type SystemVessels,
  type VesselRosterEntry,
  VesselType,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { computeVesselOrbitEntities } from "./vesselOrbitsContribution";

function bodies(): SystemBodies {
  return {
    bodies: [
      { index: 0, name: "Kerbol", parentIndex: undefined, orbit: undefined },
      { index: 1, name: "Kerbin", parentIndex: 0, orbit: undefined },
    ],
  };
}

function vessel(overrides: Partial<VesselRosterEntry>): VesselRosterEntry {
  return {
    vesselId: "v-1",
    name: "Tester",
    vesselType: VesselType.Ship,
    situation: Situation.Orbiting,
    bodyIndex: 1,
    ...overrides,
  };
}

function wire(vessels: VesselRosterEntry[]): SystemVessels {
  return { vessels };
}

describe("computeVesselOrbitEntities", () => {
  it("draws a faint orbit-path for a vessel with a usable orbit", () => {
    const entities = computeVesselOrbitEntities(
      wire([
        vessel({
          orbit: {
            sma: value("m", 700_000),
            ecc: value("1", 0.1),
            inc: value("°", 5),
            lan: value("°", 20),
            argPe: value("°", 30),
            meanAnomalyAtEpoch: value("rad", 0),
            epoch: value("s", 0),
          },
        }),
      ]),
      bodies(),
    );

    expect(entities).toHaveLength(1);
    const entity = entities[0];
    expect(entity.id).toBe("vessel-orbit:v-1");
    expect(entity.shape).toEqual({ kind: "orbit-path" });
    expect(entity.style).toEqual({ emphasis: "faint" });
    expect(entity.position).toEqual({
      kind: "orbit",
      parentName: "Kerbin",
      sma: 700_000,
      ecc: 0.1,
      lan: 20,
      argPe: 30,
      trueAnomaly: 0,
    });
  });

  it("defaults missing ecc/lan/argPe to 0 when only sma is present", () => {
    const entities = computeVesselOrbitEntities(
      wire([vessel({ orbit: { sma: value("m", 700_000) } })]),
      bodies(),
    );
    expect(entities[0].position).toEqual({
      kind: "orbit",
      parentName: "Kerbin",
      sma: 700_000,
      ecc: 0,
      lan: 0,
      argPe: 0,
      trueAnomaly: 0,
    });
  });

  it("degrades a vessel with no sma to a faint dot at its body, never a fabricated orbit", () => {
    const entities = computeVesselOrbitEntities(
      wire([vessel({ situation: Situation.Landed, orbit: undefined })]),
      bodies(),
    );
    expect(entities).toHaveLength(1);
    expect(entities[0].shape).toEqual({ kind: "point", radiusPx: 3 });
    expect(entities[0].style).toEqual({ emphasis: "faint" });
    expect(entities[0].position).toEqual({
      kind: "fixed",
      parentName: "Kerbin",
      xMetres: 0,
      yMetres: 0,
    });
  });

  it("degrades a non-finite/zero sma the same as a missing orbit", () => {
    const entities = computeVesselOrbitEntities(
      wire([vessel({ orbit: { sma: value("m", 0) } })]),
      bodies(),
    );
    expect(entities[0].shape).toEqual({ kind: "point", radiusPx: 3 });
  });

  it("omits a vessel whose body can't be resolved (no data, not a fabricated position)", () => {
    const entities = computeVesselOrbitEntities(
      wire([vessel({ bodyIndex: 99 })]),
      bodies(),
    );
    expect(entities).toEqual([]);
  });

  it("omits a vessel with no bodyIndex at all", () => {
    const entities = computeVesselOrbitEntities(
      wire([vessel({ bodyIndex: undefined })]),
      bodies(),
    );
    expect(entities).toEqual([]);
  });

  it("carries the roster fields (name/type/situation/body/crew/comms) in meta", () => {
    const entities = computeVesselOrbitEntities(
      wire([
        vessel({
          name: "Intrepid",
          vesselType: VesselType.Probe,
          situation: Situation.Orbiting,
          crewCount: value("count", 2),
          crewCapacity: value("count", 4),
          commsControlSource: RosterCommsControlSource.Full,
          orbit: { sma: value("m", 700_000) },
        }),
      ]),
      bodies(),
    );
    expect(entities[0].meta).toEqual({
      name: "Intrepid",
      type: "Probe",
      situation: "Orbiting",
      body: "Kerbin",
      crew: "2/4",
      comms: "connected",
    });
  });

  it("reports unresolved crew count as unknown rather than fabricating 0", () => {
    const entities = computeVesselOrbitEntities(
      wire([vessel({ crewCount: undefined, crewCapacity: undefined })]),
      bodies(),
    );
    expect(entities[0].meta?.crew).toBe("unknown");
  });

  it("reports missing commsControlSource as unknown, distinct from a confirmed no-link", () => {
    const entities = computeVesselOrbitEntities(
      wire([vessel({ commsControlSource: undefined })]),
      bodies(),
    );
    expect(entities[0].meta?.comms).toBe("unknown");
  });

  it("draws every vessel on the roster, not just craft (unlike FleetRoster's isRosterCraft filter)", () => {
    const entities = computeVesselOrbitEntities(
      wire([
        vessel({ vesselId: "debris-1", vesselType: VesselType.Debris }),
        vessel({ vesselId: "flag-1", vesselType: VesselType.Flag }),
        vessel({ vesselId: "eva-1", vesselType: VesselType.EVA }),
      ]),
      bodies(),
    );
    expect(entities.map((e) => e.id)).toEqual([
      "vessel-orbit:debris-1",
      "vessel-orbit:flag-1",
      "vessel-orbit:eva-1",
    ]);
  });

  it("returns nothing when the roster hasn't arrived yet", () => {
    expect(computeVesselOrbitEntities(undefined, bodies())).toEqual([]);
  });

  it("returns nothing for an empty roster", () => {
    expect(computeVesselOrbitEntities(wire([]), bodies())).toEqual([]);
  });
});
