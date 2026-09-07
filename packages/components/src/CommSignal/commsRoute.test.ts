import { type CommsHop, value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  buildCommsRouteNodes,
  commsBottleneckHopId,
  commsHopId,
  commsLegTime,
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

describe("commsLegTime", () => {
  it("apportions the path's total delay across legs by distance", () => {
    const hops = [
      hopWithDistance("Active Vessel", "Relay Sat 1", 1_250_000),
      hopWithDistance("Relay Sat 1", "Relay Sat 2", 2_400_000),
      hopWithDistance("Relay Sat 2", "home", 640_000),
    ];
    const totalMeters = 1_250_000 + 2_400_000 + 640_000;
    const totalDelay = 6.2;

    const legTimes = hops.map((h) =>
      commsLegTime(h, hops, value("s", totalDelay)),
    );

    expect(legTimes[0]?.magnitude).toBeCloseTo(
      (1_250_000 / totalMeters) * totalDelay,
      9,
    );
    expect(legTimes[1]?.magnitude).toBeCloseTo(
      (2_400_000 / totalMeters) * totalDelay,
      9,
    );
    expect(legTimes[2]?.magnitude).toBeCloseTo(
      (640_000 / totalMeters) * totalDelay,
      9,
    );
    // The apportioned legs always sum back to the total DELAY row above them.
    expect(
      (legTimes[0]?.magnitude ?? 0) +
        (legTimes[1]?.magnitude ?? 0) +
        (legTimes[2]?.magnitude ?? 0),
    ).toBeCloseTo(totalDelay, 9);
  });

  it("apportions without being told the save's light speed", () => {
    /*
     * The share is a length over a length, so whatever speed this save's light
     * travels at cancels: a save running at twice light speed reports half the
     * total, and each leg's share of it is unchanged.
     */
    const hops = [
      hopWithDistance("Active Vessel", "Relay Sat 1", 299_792_458),
      hopWithDistance("Relay Sat 1", "home", 299_792_458),
    ];
    expect(commsLegTime(hops[0], hops, value("s", 1))?.magnitude).toBeCloseTo(
      0.5,
      9,
    );
    expect(commsLegTime(hops[0], hops, value("s", 0.5))?.magnitude).toBeCloseTo(
      0.25,
      9,
    );
  });

  it("returns a Value in seconds, not a bare number", () => {
    const hops = [hopWithDistance("Active Vessel", "home", 299_792_458)];
    expect(commsLegTime(hops[0], hops, value("s", 1))?.unit).toBe("s");
  });

  it("returns undefined for a hop with no distance to derive from", () => {
    const hops = [hop("Active Vessel", "home")];
    expect(commsLegTime(hops[0], hops, value("s", 6.2))).toBeUndefined();
  });

  it("returns nothing when there is no delay to apportion", () => {
    /*
     * A save with the delay feature off reports a real, applied ZERO. The route
     * carries no light-time, so no leg of it does either, and annotating one
     * with the time it WOULD take is a claim about a different save.
     */
    const hops = [hopWithDistance("Active Vessel", "home", 299_792_458)];
    expect(commsLegTime(hops[0], hops, undefined)).toBeUndefined();
    expect(commsLegTime(hops[0], hops, null)).toBeUndefined();
    expect(commsLegTime(hops[0], hops, value("s", 0))).toBeUndefined();
    expect(commsLegTime(hops[0], hops, value("s", -3))).toBeUndefined();
  });
});
