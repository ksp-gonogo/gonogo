import {
  CommsHopKind,
  type CommsNetwork,
  type CommsNetworkEdge,
  type CommsNetworkNode,
  Quality,
} from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  COMMS_PATH_COLOUR,
  commsControlQuality,
  deriveCommsPath,
  NO_COMMS_PATH,
} from "./commsPath";

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

describe("deriveCommsPath", () => {
  it("returns NO_COMMS_PATH when the network is undefined", () => {
    expect(deriveCommsPath(undefined, "v-1")).toEqual(NO_COMMS_PATH);
  });

  it("resolves a direct (single-hop) active edge to home as full", () => {
    const net = network(
      [
        node({ id: "home" }),
        node({ id: "v-relay", kind: CommsHopKind.Vessel }),
      ],
      [edge("home", "v-relay")],
    );
    expect(deriveCommsPath(net, "v-relay")).toEqual({
      quality: "full",
      edgeIds: ["comms-edge:home:v-relay"],
    });
  });

  it("resolves a relayed (multi-hop) active path to home as full, in traversal order", () => {
    const net = network(
      [
        node({ id: "home" }),
        node({ id: "v-relay", kind: CommsHopKind.Relay }),
        node({ id: "v-far", kind: CommsHopKind.Vessel }),
      ],
      [edge("home", "v-relay"), edge("v-relay", "v-far")],
    );
    // The walk starts at the vessel, so the vessel's own hop comes first.
    expect(deriveCommsPath(net, "v-far")).toEqual({
      quality: "full",
      edgeIds: ["comms-edge:v-relay:v-far", "comms-edge:home:v-relay"],
    });
  });

  it("walks edges bidirectionally regardless of a/b order", () => {
    // The edge is stored reversed; the path still resolves, and the entity id keeps the edge's own a/b order.
    const net = network(
      [
        node({ id: "home" }),
        node({ id: "v-relay", kind: CommsHopKind.Relay }),
        node({ id: "v-far", kind: CommsHopKind.Vessel }),
      ],
      [edge("home", "v-relay"), edge("v-far", "v-relay")],
    );
    expect(deriveCommsPath(net, "v-far")).toEqual({
      quality: "full",
      edgeIds: ["comms-edge:v-far:v-relay", "comms-edge:home:v-relay"],
    });
  });

  it("degrades to partial when only an inactive route connects the vessel to home", () => {
    const net = network(
      [
        node({ id: "home" }),
        node({ id: "v-relay", kind: CommsHopKind.Vessel }),
      ],
      [edge("home", "v-relay", false)],
    );
    expect(deriveCommsPath(net, "v-relay")).toEqual({
      quality: "partial",
      edgeIds: ["comms-edge:home:v-relay"],
    });
  });

  it("returns NO_COMMS_PATH (no edges) when the vessel is unreachable from home", () => {
    const net = network(
      [
        node({ id: "home" }),
        node({ id: "v-isolated", kind: CommsHopKind.Vessel }),
        node({ id: "v-other", kind: CommsHopKind.Vessel }),
      ],
      [edge("v-isolated", "v-other")],
    );
    expect(deriveCommsPath(net, "v-isolated")).toEqual(NO_COMMS_PATH);
  });

  it("returns NO_COMMS_PATH for a vessel id absent from the graph entirely", () => {
    const net = network([node({ id: "home" })], []);
    expect(deriveCommsPath(net, "v-unknown")).toEqual(NO_COMMS_PATH);
  });

  it("returns the zero-hop empty path when the vessel id IS the home node", () => {
    const net = network([node({ id: "home" })], []);
    expect(deriveCommsPath(net, "home")).toEqual({
      quality: "full",
      edgeIds: [],
    });
  });

  it("treats any node whose kind is Home as a valid target, not just the literal 'home' id", () => {
    const net = network(
      [
        node({ id: "ksc-alt", kind: CommsHopKind.Home }),
        node({ id: "v-1", kind: CommsHopKind.Vessel }),
      ],
      [edge("ksc-alt", "v-1")],
    );
    expect(deriveCommsPath(net, "v-1")).toEqual({
      quality: "full",
      edgeIds: ["comms-edge:ksc-alt:v-1"],
    });
  });
});

describe("COMMS_PATH_COLOUR", () => {
  it("maps full to the go tone and both degraded tiers to distinct non-go tones", () => {
    expect(COMMS_PATH_COLOUR.full).toBe("var(--color-status-go-mark)");
    expect(COMMS_PATH_COLOUR.partial).not.toBe(COMMS_PATH_COLOUR.full);
    expect(COMMS_PATH_COLOUR.none).not.toBe(COMMS_PATH_COLOUR.full);
  });
});

describe("commsControlQuality", () => {
  // The path colour comes from the selected vessel's own roster commsLabel, not the traversal `quality`: a vessel can route to home over active edges while its own control is Partial or None.
  it("maps a FULL-control roster label ('connected') to the go tone", () => {
    expect(COMMS_PATH_COLOUR[commsControlQuality("connected")]).toBe(
      "var(--color-status-go-mark)",
    );
  });

  it("maps a PARTIAL-control roster label ('relay') to a degraded, non-go tone", () => {
    const colour = COMMS_PATH_COLOUR[commsControlQuality("relay")];
    expect(colour).not.toBe("var(--color-status-go-mark)");
    expect(colour).toBe("var(--color-status-warning-bg)");
  });

  it("maps a NONE-control roster label ('none') to a degraded, non-go tone", () => {
    expect(COMMS_PATH_COLOUR[commsControlQuality("none")]).not.toBe(
      "var(--color-status-go-mark)",
    );
  });

  it("degrades an unrecognised/missing label rather than assuming full control", () => {
    expect(commsControlQuality("unknown")).toBe("none");
    expect(commsControlQuality(undefined)).toBe("none");
  });
});
