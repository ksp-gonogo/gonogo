import { type CommsHop, value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  buildCommsRouteNodes,
  commsBottleneckHopId,
  commsHopId,
  commsLegTimeSeconds,
  commsRouteRelayCount,
} from "./commsRoute";

/** Home-ness derived from the endpoint id these fixtures use for the ground end. */
const isHome = (endpoint: string) => endpoint === "home";

function hop(from: string, to: string): CommsHop {
  return {
    from,
    to,
    kind: 0,
    fromIsHome: isHome(from),
    toIsHome: isHome(to),
  };
}

function hopWithDistance(from: string, to: string, meters: number): CommsHop {
  return { ...hop(from, to), distanceMeters: value("m", meters) };
}

describe("buildCommsRouteNodes", () => {
  it("returns an empty chain for an empty hop list (no path home)", () => {
    expect(buildCommsRouteNodes([], "Active Vessel", "KSC")).toEqual([]);
  });

  it("labels the source node by the vessel's own name, not 'You'", () => {
    const nodes = buildCommsRouteNodes(
      [hop("Active Vessel", "home")],
      "Active Vessel",
      "KSC",
    );
    expect(nodes.map((n) => n.label)).toEqual(["Active Vessel", "KSC"]);
  });

  it("names each intermediate relay by its own raw hop id, not the centre label", () => {
    const nodes = buildCommsRouteNodes(
      [hop("Active Vessel", "Relay Sat 1"), hop("Relay Sat 1", "home")],
      "Active Vessel",
      "KSC",
    );
    expect(nodes.map((n) => n.label)).toEqual([
      "Active Vessel",
      "Relay Sat 1",
      "KSC",
    ]);
  });

  it("uses the centre label for the terminal node even when the centre is a crewed vessel", () => {
    const nodes = buildCommsRouteNodes(
      [hop("Active Vessel", "Constant Companion")],
      "Active Vessel",
      "Constant Companion",
    );
    expect(nodes.map((n) => n.label)).toEqual([
      "Active Vessel",
      "Constant Companion",
    ]);
  });
});

describe("commsRouteRelayCount", () => {
  it("is 0 for a direct (1-hop) link", () => {
    expect(commsRouteRelayCount([hop("Active Vessel", "home")])).toBe(0);
  });

  it("is 1 for a single-relay (2-hop) path", () => {
    expect(
      commsRouteRelayCount([
        hop("Active Vessel", "Relay Sat 1"),
        hop("Relay Sat 1", "home"),
      ]),
    ).toBe(1);
  });

  it("is 0 for an empty (no-path-home) hop list", () => {
    expect(commsRouteRelayCount([])).toBe(0);
  });
});

describe("commsLegTimeSeconds", () => {
  it("apportions the path's total delay across legs by distance", () => {
    const hops = [
      hopWithDistance("Active Vessel", "Relay Sat 1", 1_250_000),
      hopWithDistance("Relay Sat 1", "Relay Sat 2", 2_400_000),
      hopWithDistance("Relay Sat 2", "home", 640_000),
    ];
    const totalMeters = 1_250_000 + 2_400_000 + 640_000;
    const totalDelay = 6.2;

    const legTimes = hops.map((h) =>
      commsLegTimeSeconds(h, hops, value("s", totalDelay), undefined),
    );

    expect(legTimes[0]).toBeCloseTo((1_250_000 / totalMeters) * totalDelay, 9);
    expect(legTimes[1]).toBeCloseTo((2_400_000 / totalMeters) * totalDelay, 9);
    expect(legTimes[2]).toBeCloseTo((640_000 / totalMeters) * totalDelay, 9);
    // The apportioned legs always sum back to the total DELAY row above them.
    expect(
      (legTimes[0] ?? 0) + (legTimes[1] ?? 0) + (legTimes[2] ?? 0),
    ).toBeCloseTo(totalDelay, 9);
  });

  it("divides by the save's published light speed with no path delay to apportion against", () => {
    const hops = [hopWithDistance("Active Vessel", "home", 299_792_458)];
    const c = value("m/s", 299_792_458);
    expect(commsLegTimeSeconds(hops[0], hops, undefined, c)).toBeCloseTo(1, 9);
    expect(commsLegTimeSeconds(hops[0], hops, null, c)).toBeCloseTo(1, 9);
  });

  it("uses the save's light speed rather than the real one when the save scales it", () => {
    /*
     * The whole reason `comms.delay` publishes the speed: on a save running at
     * twice light speed this leg takes half a second, and nothing on the wire
     * could say so while the constant was mirrored client-side.
     */
    const hops = [hopWithDistance("Active Vessel", "home", 299_792_458)];
    expect(
      commsLegTimeSeconds(hops[0], hops, undefined, value("m/s", 599_584_916)),
    ).toBeCloseTo(0.5, 9);
  });

  it("returns undefined rather than guessing when no light speed was published", () => {
    const hops = [hopWithDistance("Active Vessel", "home", 299_792_458)];
    expect(
      commsLegTimeSeconds(hops[0], hops, undefined, undefined),
    ).toBeUndefined();
    expect(
      commsLegTimeSeconds(hops[0], hops, undefined, value("m/s", 0)),
    ).toBeUndefined();
  });

  it("returns undefined for a hop with no distance to derive from", () => {
    const hops = [hop("Active Vessel", "home")];
    expect(
      commsLegTimeSeconds(hops[0], hops, value("s", 6.2), undefined),
    ).toBeUndefined();
  });

  it("falls back to light-time when the total delay is non-positive", () => {
    const hops = [hopWithDistance("Active Vessel", "home", 299_792_458)];
    const c = value("m/s", 299_792_458);
    expect(commsLegTimeSeconds(hops[0], hops, value("s", 0), c)).toBeCloseTo(
      1,
      9,
    );
    expect(commsLegTimeSeconds(hops[0], hops, value("s", -3), c)).toBeCloseTo(
      1,
      9,
    );
  });
});

describe("commsHopId", () => {
  it("is the single join key both the schedule and a contributor derive from", () => {
    expect(commsHopId("Vessel", "Relay 1")).toBe(
      commsHopId("Vessel", "Relay 1"),
    );
  });

  it("is direction-sensitive and collision-resistant across the from/to split", () => {
    expect(commsHopId("Vessel", "Relay 1")).not.toBe(
      commsHopId("Relay 1", "Vessel"),
    );
    // A delimiter that could be forged by concatenation must not collide: "ab"+"c"
    // and "a"+"bc" stay distinct.
    expect(commsHopId("ab", "c")).not.toBe(commsHopId("a", "bc"));
  });
});

describe("commsBottleneckHopId", () => {
  const path = [hop("Vessel", "Relay 1"), hop("Relay 1", "home")];
  const rate = (a: string, b: string, bits: number): [string, number] => [
    commsHopId(a, b),
    bits,
  ];

  it("flags the minimum-rate hop when at least two hops carry a rate", () => {
    const rates = new Map([
      rate("Vessel", "Relay 1", 262_000),
      rate("Relay 1", "home", 48_000),
    ]);
    expect(commsBottleneckHopId(path, rates)).toBe(
      commsHopId("Relay 1", "home"),
    );
  });

  it("does not flag a lone rated hop (nothing to be a bottleneck relative to)", () => {
    const rates = new Map([rate("Relay 1", "home", 48_000)]);
    expect(commsBottleneckHopId(path, rates)).toBeUndefined();
  });

  it("returns undefined under bare CommNet / no contributed rates", () => {
    expect(commsBottleneckHopId(path, new Map())).toBeUndefined();
  });

  it("resolves a tie to the first minimum hop in path order", () => {
    const rates = new Map([
      rate("Vessel", "Relay 1", 48_000),
      rate("Relay 1", "home", 48_000),
    ]);
    expect(commsBottleneckHopId(path, rates)).toBe(
      commsHopId("Vessel", "Relay 1"),
    );
  });
});
