import { type CommsHop, type Value, value } from "@ksp-gonogo/sitrep-sdk";

/**
 * One `comm-signal.hop-rates` entry (components-side mirror of the sdk leaf's
 * `CommSignalHopRateEntry`): a hop's forward bitrate keyed by the SAME node ids
 * `comms.path` carries, so the route schedule joins it by {@link commsHopId}
 * without importing backend-aware code. `bitsPerSec` is a plain magnitude; the
 * schedule wraps it in `<Unit>` and compares magnitudes to flag the bottleneck.
 */
export interface CommSignalHopRateEntry {
  fromNodeId: string;
  toNodeId: string;
  bitsPerSec: number;
}

// The components-side `comm-signal.hop-rates` slot, declared on core's registry
// and kept member-for-member identical to the sdk leaf's mirror in
// `contribution-slots.ts` (the conformance test-d proves the two agree, and TS
// itself rejects a declaration-merge that disagrees). A comms Uplink
// contributes each hop's forward rate keyed by node id; the route schedule
// joins it onto the hop it already renders and flags the bottleneck.
//
// It declares no `topics`. It used to name the contributor's source channel,
// which put a single mod's topic id in the one place this widget could still be
// said to reference a provider. A contribution declares its own `deps` at
// runtime and that is what feeds `compute`, so the union only typed the
// argument and the contributor cast through it regardless. Naming nothing is
// the honest statement: any comms Uplink may fill this, from whatever channel
// it owns.
//
// Declared here rather than in `index.tsx` so the contribution-slot conformance
// test-d can load the augmentation by importing this module's entry type.
declare module "@ksp-gonogo/core" {
  interface ContributionRegistry {
    "comm-signal.hop-rates": {
      entry: CommSignalHopRateEntry;
    };
  }
}

/**
 * The join key for a hop: the SINGLE derivation both this route schedule and any
 * `comm-signal.hop-rates` contributor key by, built from the hop's from/to node
 * ids (identical to `comms.path`'s `CommsHop.from`/`to`). A contribution relays
 * the raw node ids off its own Topic and the schedule joins them here, so the
 * widget never imports backend-aware code. A unit-separator control character
 * delimits the two ids so a node name containing it cannot forge a collision.
 */
export function commsHopId(fromNodeId: string, toNodeId: string): string {
  return `${fromNodeId}${toNodeId}`;
}

/**
 * The bottleneck hop's id: the minimum-rate hop in the path, since the slowest
 * link caps end-to-end throughput. `undefined` unless at least TWO hops carry a
 * rate: a bottleneck only means something relative to another leg, so a lone
 * rated leg (or a bare-CommNet path with no rates at all) is never flagged.
 * Ties resolve to the first hop at the minimum, in path order.
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
 * Builds the display chain for a `comms.path` hop list: the active vessel
 * (`vesselLabel`, its own name, `comms.path` is always the reader's OWN
 * path, never another vessel's), each intermediate relay (the hop's own raw
 * node name), and the resolved command centre (`centreLabel`, the same name
 * the panel subtitle already uses, not the hop's own opaque "home" id).
 * Gonogo is the experience FROM the command centre, so the vessel is named
 * rather than addressed as "you", the centre is the implicit reader.
 *
 * `hops` is ordered vessel-to-centre (`CommNetBackend.Path`/`RaCommsBackend`
 * in `mod/`), so node `i+1` is hop `i`'s `to`: an N-hop path always yields
 * N+1 nodes. Empty hops (no path home) yields an empty chain, the caller's
 * cue to render nothing.
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
 * Relay nodes between the vessel and the command centre: hop count minus
 * one (a 1-hop path is a direct link with no relay in between). Position-
 * based rather than counting `CommsHopKind.Relay` hops, because a crewed-vessel
 * command centre never sets a hop's `Kind` to `Home`, so kind-counting would
 * over-count by one whenever the centre itself is not a ground station.
 */
export function commsRouteRelayCount(hops: readonly CommsHop[]): number {
  return Math.max(0, hops.length - 1);
}

/**
 * One leg's light-time. `comms.path` carries each hop's distance but no per-hop
 * delay (the contract has no such field), so this derives it rather than
 * reading it off the wire.
 *
 * The hop's share of the path's total one-way delay, apportioned by distance
 * against the route's total distance. That reproduces `SignalDelay.cs`'s own
 * `OneWaySeconds = totalMeters / effectiveC` exactly, so every leg's time sums
 * to the total DELAY row above the route, and the save's light speed cancels
 * out of the arithmetic rather than having to be known: a length over a length
 * is dimensionless, and scaling a delay by it lands back in seconds.
 *
 * `undefined` when this hop has no distance, when the route has no distance at
 * all, or when there is no positive total to apportion. A save with the delay
 * feature off reports a real, applied ZERO here, and the honest annotation for a
 * leg of a route that carries no delay is no light-time rather than the one it
 * would carry if the feature were on.
 */
export function commsLegTime(
  hop: CommsHop,
  hops: readonly CommsHop[],
  pathDelay: Value<"s"> | null | undefined,
): Value<"s"> | undefined {
  const hopDistance = hop.distanceMeters;
  if (hopDistance === undefined) return undefined;
  if (!pathDelay?.greaterThan(0)) return undefined;
  const totalDistance = hops.reduce(
    (sum, h) => (h.distanceMeters ? sum.plus(h.distanceMeters) : sum),
    value("m", 0),
  );
  if (!totalDistance.greaterThan(0)) return undefined;
  return pathDelay.times(hopDistance.per(totalDistance));
}
