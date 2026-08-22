import {
  CommsHopKind,
  type CommsNetwork,
  type CommsNetworkEdge,
  type CommsNetworkNode,
  Quality,
  RosterCommsControlSource,
  Situation,
  type SystemBodies,
  type SystemVessels,
  type VesselRosterEntry,
  VesselType,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  computeCommsNetworkEntities,
  computeVesselOrbitEntities,
} from "./vesselOrbitsContribution";

function bodies(): SystemBodies {
  return {
    bodies: [
      { index: 0, name: "Kerbol", parentIndex: undefined, orbit: undefined },
      {
        index: 1,
        name: "Kerbin",
        parentIndex: 0,
        orbit: undefined,
        isHome: true,
      },
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

function node(overrides: Partial<CommsNetworkNode>): CommsNetworkNode {
  return {
    id: "home",
    displayName: "KSC",
    kind: CommsHopKind.Home,
    ...overrides,
  };
}

function edge(a: string, b: string, active = true): CommsNetworkEdge {
  return { a, b, active };
}

function network(
  nodes: CommsNetworkNode[],
  edges: CommsNetworkEdge[],
): CommsNetwork {
  return { nodes, edges, meta: { source: "test", quality: Quality.Loaded } };
}

describe("computeCommsNetworkEntities", () => {
  it("joins a vessel node's edge endpoint to that vessel's own orbit position", () => {
    const relay = vessel({
      vesselId: "v-relay",
      orbit: { sma: value("m", 3_468_750) },
    });
    const entities = computeCommsNetworkEntities(
      network(
        [
          node({ id: "home" }),
          node({ id: "v-relay", kind: CommsHopKind.Relay }),
        ],
        [edge("home", "v-relay")],
      ),
      wire([relay]),
      bodies(),
    );

    expect(entities).toHaveLength(1);
    expect(entities[0].shape).toEqual({
      kind: "connection-line",
      to: {
        kind: "orbit",
        parentName: "Kerbin",
        sma: 3_468_750,
        ecc: 0,
        lan: 0,
        argPe: 0,
        trueAnomaly: 0,
      },
    });
    expect(entities[0].style).toEqual({ emphasis: "faint" });
  });

  it("joins a vessel node with no usable orbit to a fixed point at its body, same degrade as the fleet contribution", () => {
    const landed = vessel({
      vesselId: "v-landed",
      situation: Situation.Landed,
      orbit: undefined,
    });
    const entities = computeCommsNetworkEntities(
      network(
        [
          node({ id: "home" }),
          node({ id: "v-landed", kind: CommsHopKind.Vessel }),
        ],
        [edge("home", "v-landed")],
      ),
      wire([landed]),
      bodies(),
    );

    expect(entities[0].position).toEqual({
      kind: "fixed",
      parentName: "Kerbin",
      xMetres: 0,
      yMetres: 0,
    });
  });

  it("places the home node at the body flagged isHome, independent of vessel data", () => {
    const entities = computeCommsNetworkEntities(
      network(
        [node({ id: "home" }), node({ id: "v-1", kind: CommsHopKind.Vessel })],
        [edge("home", "v-1")],
      ),
      wire([vessel({ orbit: { sma: value("m", 700_000) } })]),
      bodies(),
    );

    expect(entities[0].position).toEqual({
      kind: "fixed",
      parentName: "Kerbin",
      xMetres: 0,
      yMetres: 0,
    });
  });

  it("locates the home body by isHome, not by a fixed index, under a hypothetical planet pack ordering", () => {
    const reorderedBodies: SystemBodies = {
      bodies: [
        { index: 0, name: "Kerbol", parentIndex: undefined, orbit: undefined },
        { index: 1, name: "Moho", parentIndex: 0, orbit: undefined },
        {
          index: 2,
          name: "HomeworldX",
          parentIndex: 0,
          orbit: undefined,
          isHome: true,
        },
      ],
    };
    const entities = computeCommsNetworkEntities(
      network(
        [node({ id: "home" }), node({ id: "v-1", kind: CommsHopKind.Vessel })],
        [edge("home", "v-1")],
      ),
      wire([vessel({ orbit: { sma: value("m", 700_000) }, bodyIndex: 2 })]),
      reorderedBodies,
    );

    expect(entities[0].position).toEqual({
      kind: "fixed",
      parentName: "HomeworldX",
      xMetres: 0,
      yMetres: 0,
    });
  });

  it("recognises a home-role node by CommsHopKind.Home even when its id isn't literally 'home'", () => {
    const entities = computeCommsNetworkEntities(
      network(
        [
          node({ id: "ground-relay-alpha", kind: CommsHopKind.Home }),
          node({ id: "v-1", kind: CommsHopKind.Vessel }),
        ],
        [edge("ground-relay-alpha", "v-1")],
      ),
      wire([vessel({ orbit: { sma: value("m", 700_000) } })]),
      bodies(),
    );

    expect(entities).toHaveLength(1);
    expect(entities[0].position).toEqual({
      kind: "fixed",
      parentName: "Kerbin",
      xMetres: 0,
      yMetres: 0,
    });
  });

  it("omits an edge whose endpoint id matches no known vessel and isn't home, never fabricating a position", () => {
    const entities = computeCommsNetworkEntities(
      network(
        [
          node({ id: "home" }),
          node({ id: "v-ghost", kind: CommsHopKind.Relay }),
        ],
        [edge("home", "v-ghost")],
      ),
      wire([]), // v-ghost never lands on the roster
      bodies(),
    );

    expect(entities).toEqual([]);
  });

  it("omits an edge whose vessel endpoint's body can't be resolved yet", () => {
    const orphan = vessel({ vesselId: "v-orphan", bodyIndex: 99 });
    const entities = computeCommsNetworkEntities(
      network(
        [
          node({ id: "home" }),
          node({ id: "v-orphan", kind: CommsHopKind.Vessel }),
        ],
        [edge("home", "v-orphan")],
      ),
      wire([orphan]),
      bodies(),
    );

    expect(entities).toEqual([]);
  });

  it("draws every other edge even when one is omitted for an unresolvable endpoint", () => {
    const relay = vessel({
      vesselId: "v-relay",
      orbit: { sma: value("m", 3_468_750) },
    });
    const entities = computeCommsNetworkEntities(
      network(
        [
          node({ id: "home" }),
          node({ id: "v-relay", kind: CommsHopKind.Relay }),
          node({ id: "v-ghost", kind: CommsHopKind.Vessel }),
        ],
        [edge("home", "v-relay"), edge("v-relay", "v-ghost")],
      ),
      wire([relay]),
      bodies(),
    );

    expect(entities.map((e) => e.id)).toEqual(["comms-edge:home:v-relay"]);
  });

  it("omits an edge to home when no body is flagged isHome yet", () => {
    const relay = vessel({
      vesselId: "v-relay",
      orbit: { sma: value("m", 3_468_750) },
    });
    const entities = computeCommsNetworkEntities(
      network(
        [
          node({ id: "home" }),
          node({ id: "v-relay", kind: CommsHopKind.Relay }),
        ],
        [edge("home", "v-relay")],
      ),
      wire([relay]),
      {
        bodies: [
          { index: 0, name: "Kerbol", orbit: undefined },
          { index: 1, name: "Kerbin", parentIndex: 0, orbit: undefined }, // present, but not flagged home
        ],
      },
    );

    expect(entities).toEqual([]);
  });

  it("returns nothing when comms.network hasn't arrived yet", () => {
    expect(computeCommsNetworkEntities(undefined, wire([]), bodies())).toEqual(
      [],
    );
  });

  it("returns nothing for a network with no edges", () => {
    expect(
      computeCommsNetworkEntities(
        network([node({ id: "home" })], []),
        wire([]),
        bodies(),
      ),
    ).toEqual([]);
  });
});
