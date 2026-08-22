import {
  CommsHopKind,
  type CommsNetwork,
  type CommsNetworkEdge,
  type CommsNetworkNode,
  Quality,
} from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  deriveTraffic,
  directTrafficHops,
  edgesById,
  NO_TRAFFIC,
  pulsePositionOnHops,
} from "./commsTraffic";

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

describe("directTrafficHops", () => {
  it("marks a single hop forward when the edge's a matches the vessel", () => {
    const edges = edgesById(network([], [edge("v-1", "home")]));
    expect(directTrafficHops("v-1", ["comms-edge:v-1:home"], edges)).toEqual([
      { edgeId: "comms-edge:v-1:home", forward: true },
    ]);
  });

  it("marks a single hop reversed when the edge's b matches the vessel", () => {
    const edges = edgesById(network([], [edge("home", "v-1")]));
    expect(directTrafficHops("v-1", ["comms-edge:home:v-1"], edges)).toEqual([
      { edgeId: "comms-edge:home:v-1", forward: false },
    ]);
  });

  it("walks a multi-hop path, each hop directed relative to the CURRENT cursor", () => {
    // v-far -> v-relay -> home, edgeIds in that (vessel->home) order.
    const edges = edgesById(
      network([], [edge("v-relay", "v-far"), edge("home", "v-relay")]),
    );
    expect(
      directTrafficHops(
        "v-far",
        ["comms-edge:v-relay:v-far", "comms-edge:home:v-relay"],
        edges,
      ),
    ).toEqual([
      // v-far -> v-relay: edge is (v-relay, v-far), cursor=v-far=b, reversed.
      { edgeId: "comms-edge:v-relay:v-far", forward: false },
      // v-relay -> home: edge is (home, v-relay), cursor=v-relay=b, reversed.
      { edgeId: "comms-edge:home:v-relay", forward: false },
    ]);
  });

  it("stops early (defensive) on an edgeId absent from edgesById", () => {
    const edges = edgesById(network([], []));
    expect(directTrafficHops("v-1", ["comms-edge:v-1:home"], edges)).toEqual(
      [],
    );
  });
});

describe("pulsePositionOnHops", () => {
  // forward=true: the vessel->home walk crosses this edge a->b, so the
  // edge's own a (x1,y1) is the vessel-side end and b (x2,y2) is the
  // home-side end.
  const SINGLE_FORWARD = [{ edgeId: "e1", forward: true }];
  const SINGLE_REVERSED = [{ edgeId: "e1", forward: false }];

  it("returns null for an empty hop list", () => {
    expect(pulsePositionOnHops([], "outbound", 0.5, 1)).toBeNull();
  });

  it("outbound (home -> vessel) on a forward hop starts at home/b (t=1) and ends at vessel/a (t=0)", () => {
    expect(pulsePositionOnHops(SINGLE_FORWARD, "outbound", 0, 1)).toEqual({
      edgeId: "e1",
      t: 1,
      opacity: 1,
    });
    expect(pulsePositionOnHops(SINGLE_FORWARD, "outbound", 1, 1)).toEqual({
      edgeId: "e1",
      t: 0,
      opacity: 1,
    });
  });

  it("return (vessel -> home) on a forward hop starts at vessel/a (t=0) and ends at home/b (t=1)", () => {
    expect(pulsePositionOnHops(SINGLE_FORWARD, "return", 0, 1)).toEqual({
      edgeId: "e1",
      t: 0,
      opacity: 1,
    });
    expect(pulsePositionOnHops(SINGLE_FORWARD, "return", 1, 1)).toEqual({
      edgeId: "e1",
      t: 1,
      opacity: 1,
    });
  });

  it("a reversed hop flips both legs' start points", () => {
    expect(pulsePositionOnHops(SINGLE_REVERSED, "outbound", 0, 1)).toEqual({
      edgeId: "e1",
      t: 0,
      opacity: 1,
    });
    expect(pulsePositionOnHops(SINGLE_REVERSED, "return", 0, 1)).toEqual({
      edgeId: "e1",
      t: 1,
      opacity: 1,
    });
  });

  it("clamps progress outside [0, 1]", () => {
    expect(pulsePositionOnHops(SINGLE_FORWARD, "outbound", -0.5, 1)?.t).toBe(1);
    expect(pulsePositionOnHops(SINGLE_FORWARD, "outbound", 1.5, 1)?.t).toBe(0);
  });

  it("carries opacity through unchanged", () => {
    expect(
      pulsePositionOnHops(SINGLE_FORWARD, "outbound", 0.5, 0.42)?.opacity,
    ).toBe(0.42);
  });

  describe("two-hop path", () => {
    // Canonical vessel->home order: hop0 touches the vessel, hop1 touches home.
    const HOPS = [
      { edgeId: "near-vessel", forward: true },
      { edgeId: "near-home", forward: true },
    ];

    it("return leg starts on the vessel-adjacent hop and ends on the home-adjacent hop", () => {
      expect(pulsePositionOnHops(HOPS, "return", 0, 1)?.edgeId).toBe(
        "near-vessel",
      );
      expect(pulsePositionOnHops(HOPS, "return", 0.99, 1)?.edgeId).toBe(
        "near-home",
      );
    });

    it("outbound leg starts on the home-adjacent hop and ends on the vessel-adjacent hop", () => {
      expect(pulsePositionOnHops(HOPS, "outbound", 0, 1)?.edgeId).toBe(
        "near-home",
      );
      expect(pulsePositionOnHops(HOPS, "outbound", 0.99, 1)?.edgeId).toBe(
        "near-vessel",
      );
    });

    it("outbound at progress=0 sits at the home end of the home-adjacent hop", () => {
      // near-home is forward (vessel->home matches a->b), so home->vessel
      // (outbound) starts at its b, i.e. a->b sense t=1... wait: outbound
      // reverses the edge's own forward sense, so aToB=false, legLocalT=0 -> t=1-0=1.
      expect(pulsePositionOnHops(HOPS, "outbound", 0, 1)).toEqual({
        edgeId: "near-home",
        t: 1,
        opacity: 1,
      });
    });
  });
});

function pendingEntry(id: string, dispatchedAt: number, oneWaySeconds: number) {
  return { id, dispatchedAt, oneWaySeconds };
}

describe("deriveTraffic", () => {
  const NET = network(
    [node({ id: "home" }), node({ id: "v-1", kind: CommsHopKind.Vessel })],
    [edge("home", "v-1")],
  );

  it("returns NO_TRAFFIC when there is no pending queue", () => {
    expect(deriveTraffic([], NET, "v-1", 100)).toEqual(NO_TRAFFIC);
  });

  it("returns NO_TRAFFIC when there is no active vessel id", () => {
    expect(deriveTraffic([pendingEntry("cmd-1", 0, 10)], NET, null, 5)).toEqual(
      NO_TRAFFIC,
    );
  });

  it("returns NO_TRAFFIC when the network is undefined", () => {
    expect(
      deriveTraffic([pendingEntry("cmd-1", 0, 10)], undefined, "v-1", 5),
    ).toEqual(NO_TRAFFIC);
  });

  it("returns NO_TRAFFIC when utNow is undefined or non-finite", () => {
    const pending = [pendingEntry("cmd-1", 0, 10)];
    expect(deriveTraffic(pending, NET, "v-1", undefined)).toEqual(NO_TRAFFIC);
    expect(deriveTraffic(pending, NET, "v-1", Number.NaN)).toEqual(NO_TRAFFIC);
  });

  it("returns NO_TRAFFIC when every pending entry has already expired", () => {
    // oneWaySeconds=10 -> round trip ends at t=20; utNow=100 is long past it.
    expect(
      deriveTraffic([pendingEntry("cmd-1", 0, 10)], NET, "v-1", 100),
    ).toEqual(NO_TRAFFIC);
  });

  it("places an in-flight entry's pulse on the vessel's route, and lights the whole route", () => {
    // Outbound leg (0..10s), utNow=5 -> progress 0.5.
    const state = deriveTraffic([pendingEntry("cmd-1", 0, 10)], NET, "v-1", 5);
    expect(state.edgeIds).toEqual(["comms-edge:home:v-1"]);
    expect(state.pulses).toHaveLength(1);
    expect(state.pulses[0].id).toBe("cmd-1");
    expect(state.pulses[0].edgeId).toBe("comms-edge:home:v-1");
    expect(state.pulses[0].t).toBeCloseTo(0.5, 6);
  });

  it("returns NO_TRAFFIC when the active vessel has no route to home", () => {
    const isolated = network(
      [node({ id: "home" }), node({ id: "v-lost", kind: CommsHopKind.Vessel })],
      [],
    );
    expect(
      deriveTraffic([pendingEntry("cmd-1", 0, 10)], isolated, "v-lost", 5),
    ).toEqual(NO_TRAFFIC);
  });

  it("skips a malformed entry (non-positive oneWaySeconds) without dropping the others", () => {
    const state = deriveTraffic(
      [pendingEntry("cmd-bad", 0, 0), pendingEntry("cmd-1", 0, 10)],
      NET,
      "v-1",
      5,
    );
    expect(state.pulses).toHaveLength(1);
  });

  it("carries multiple simultaneous pending entries as separate pulses", () => {
    const state = deriveTraffic(
      [pendingEntry("cmd-1", 0, 10), pendingEntry("cmd-2", 2, 10)],
      NET,
      "v-1",
      5,
    );
    expect(state.pulses).toHaveLength(2);
  });
});
