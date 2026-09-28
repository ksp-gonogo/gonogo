import { type CommsHop, type Value, value } from "@ksp-gonogo/sitrep-sdk";

/**
 * One `comm-signal.hop-rates` entry: a hop's forward bitrate keyed by the same
 * node ids `comms.path` carries, joined onto the route by {@link commsHopId}.
 */
export interface CommSignalHopRateEntry {
  fromNodeId: string;
  toNodeId: string;
  bitsPerSec: number;
}

/*
 * Kept member-for-member identical to the sdk leaf's mirror in
 * `contribution-slots.ts`. Any comms Uplink may fill it from whatever channel
 * it owns. Declared here rather than in `index.tsx`
 * so the conformance test-d can load the augmentation through this module.
 */
declare module "@ksp-gonogo/core" {
  interface ContributionRegistry {
    "comm-signal.hop-rates": {
      entry: CommSignalHopRateEntry;
    };
  }
}

/**
 * The join key for a hop, shared by the route schedule and every
 * `comm-signal.hop-rates` contributor. A unit-separator control character
 * delimits the two ids so a node name cannot forge a collision.
 */
export function commsHopId(fromNodeId: string, toNodeId: string): string {
  return `${fromNodeId}${toNodeId}`;
}

/**
 * The bottleneck hop's id: the minimum-rate hop, first in path order on a tie.
 * `undefined` unless at least two hops carry a rate, since a bottleneck only
 * means something relative to another leg.
 */
export function commsBottleneckHopId(
  hops: readonly CommsHop[],
  rateByHopId: ReadonlyMap<string, number>,
): string | undefined {
  let minId: string | undefined;
  let minRate = Number.POSITIVE_INFINITY;
  let rated = 0;
  for (const hop of hops) {
    const id = commsHopId(hop.from, hop.to);
    const rate = rateByHopId.get(id);
    if (rate === undefined) continue;
    rated++;
    if (rate < minRate) {
      minRate = rate;
      minId = id;
    }
  }
  return rated >= 2 ? minId : undefined;
}

/** One labelled stop along the vessel-to-command-centre chain. */
export interface CommsRouteNode {
  label: string;
  /** Hover text: what kind of node this is, for the title attribute. */
  title: string;
}

/**
 * Builds the display chain for a `comms.path` hop list: the active vessel by
 * name, each intermediate relay, and the resolved command centre (not the
 * hop's opaque "home" id). The vessel is named rather than addressed as "you"
 * because the command centre is the implicit reader.
 *
 * `hops` is ordered vessel-to-centre, so an N-hop path yields N+1 nodes and
 * no hops yields an empty chain.
 */
export function buildCommsRouteNodes(
  hops: readonly CommsHop[],
  vesselLabel: string,
  centreLabel: string,
): CommsRouteNode[] {
  if (hops.length === 0) return [];
  const nodes: CommsRouteNode[] = [
    { label: vesselLabel, title: "Source vessel" },
  ];
  for (let i = 0; i < hops.length - 1; i++) {
    nodes.push({ label: hops[i].to, title: "Relay" });
  }
  nodes.push({ label: centreLabel, title: "Command centre" });
  return nodes;
}

/**
 * Relay nodes between the vessel and the command centre: hop count minus one.
 * Position-based because a crewed-vessel command centre never marks its hop
 * `Home`, so counting by kind would over-count.
 */
export function commsRouteRelayCount(hops: readonly CommsHop[]): number {
  return Math.max(0, hops.length - 1);
}

/**
 * One leg's light-time: the path's total one-way delay apportioned by the
 * hop's share of the route distance. The legs sum to the total delay and the
 * save's light speed cancels out, so it never has to be known.
 *
 * `undefined` when the hop or route has no distance, or the total delay is not
 * positive: a route that carries no delay gets no light-time annotation.
 */
export function commsLegTime(
  hop: CommsHop,
  hops: readonly CommsHop[],
  pathDelay: Value<"s"> | null | undefined,
): Value<"s"> | undefined {
  const hopDistance = hop.distanceMeters;
  // Loose equality: an unmeasured hop arrives as an explicit null.
  if (hopDistance == null) return undefined;
  if (!pathDelay?.greaterThan(0)) return undefined;
  const totalDistance = hops.reduce(
    (sum, h) => (h.distanceMeters ? sum.plus(h.distanceMeters) : sum),
    value("m", 0),
  );
  if (!totalDistance.greaterThan(0)) return undefined;
  return pathDelay.times(hopDistance.per(totalDistance));
}
