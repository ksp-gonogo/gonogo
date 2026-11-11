import type { CommsNetwork, CommsNetworkEdge } from "@ksp-gonogo/sitrep-sdk";
import {
  computeUplinkPulse,
  type PendingPulseEntry,
  type UplinkPulseLeg,
} from "../FleetComms/pendingPulse";
import {
  deriveCommsPath,
  deriveCommsPathBetween,
  edgeEntityId,
} from "./commsPath";

/*
 * Command traffic routes each `system.uplink.pending` pulse along the actual `comms.network` relay path, reading the already-projected `connection-line` endpoints by entity id.
 * An entry is routed by its own `craft`: a vessel's path to home, or for a ground station the path between that station and the sender's, which is drawn only when the graph has one. An entry with no `craft` is a command to the active vessel.
 */
/** One `comms.network` edge, directed by the walk: `forward` is true when the walk crossed it a to b, the edge's own draw order. */
export interface DirectedTrafficHop {
  edgeId: string;
  forward: boolean;
}

/** Directs `deriveCommsPath`'s vessel-to-home edge ids by re-walking them from `vesselId`; stops at the first id missing from `edgesById`. */
export function directTrafficHops(
  vesselId: string,
  edgeIds: readonly string[],
  edgesById: ReadonlyMap<string, CommsNetworkEdge>,
): DirectedTrafficHop[] {
  const hops: DirectedTrafficHop[] = [];
  let cursor = vesselId;
  for (const edgeId of edgeIds) {
    const edge = edgesById.get(edgeId);
    if (!edge) break;
    const forward = edge.a === cursor;
    hops.push({ edgeId, forward });
    cursor = forward ? edge.b : edge.a;
  }
  return hops;
}

/** `comms.network`'s edges, indexed by the id `edgeEntityId` assigns their `connection-line` entity. */
export function edgesById(
  network: CommsNetwork | undefined,
): ReadonlyMap<string, CommsNetworkEdge> {
  const m = new Map<string, CommsNetworkEdge>();
  for (const edge of network?.edges ?? []) m.set(edgeEntityId(edge), edge);
  return m;
}

export interface TrafficPulsePosition {
  edgeId: string;
  /** 0..1 along the edge's own a -> b direction (the `connection-line`'s x1,y1 -> x2,y2 draw order). */
  t: number;
  opacity: number;
}

/** A `system.uplink.pending` entry with its correlation id, so each pulse keeps a stable React key when two entries share an edge. */
export interface PendingTrafficEntry extends PendingPulseEntry {
  id: string;
  /** Who it is addressed to: `vessel:<id>` or `ground:<name>`; empty or absent for a command to the active vessel. */
  craft?: string | null;
  /** The command centre that sent it, as `ground:<name>`. */
  vantage?: string | null;
}

const NODE_PREFIXES = ["vessel:", "ground:"] as const;

/** A craft or vantage id as `comms.network` names the node: without its `vessel:` or `ground:` prefix. */
function nodeIdOf(id: string): string {
  for (const prefix of NODE_PREFIXES) {
    if (id.startsWith(prefix)) return id.slice(prefix.length);
  }
  return id;
}

/** Places a pulse leg and progress on a hop at a local t in its a-to-b sense. `hops` run vessel to home, so the return leg travels them in order and the outbound leg reversed; `null` when there are no hops. */
export function pulsePositionOnHops(
  hops: readonly DirectedTrafficHop[],
  leg: UplinkPulseLeg,
  progress: number,
  opacity: number,
): TrafficPulsePosition | null {
  const n = hops.length;
  if (n === 0) return null;

  const clamped = Math.min(Math.max(progress, 0), 1);
  const travellingVesselToHome = leg === "return";
  const walk = travellingVesselToHome ? hops : [...hops].reverse();

  const scaled = clamped * n;
  const index = Math.min(Math.floor(scaled), n - 1);
  const legLocalT = scaled - index;

  const hop = walk[index];
  // `hop.forward` is the vessel-to-home sense, so the outbound leg mirrors it.
  const aToB = travellingVesselToHome ? hop.forward : !hop.forward;
  const t = aToB ? legLocalT : 1 - legLocalT;

  return { edgeId: hop.edgeId, t, opacity };
}

/** One in-flight pulse, keyed by its `system.uplink.pending` entry's id, since two entries can share an `edgeId`. */
export interface IdentifiedTrafficPulse extends TrafficPulsePosition {
  id: string;
}

export interface TrafficState {
  /** Every edge id on the route of an entry with a pulse in flight; empty while none is. */
  edgeIds: readonly string[];
  /** One position per in-flight `system.uplink.pending` entry. */
  pulses: readonly IdentifiedTrafficPulse[];
}

export const NO_TRAFFIC: TrafficState = { edgeIds: [], pulses: [] };

/** `system.uplink.pending` entries to in-flight pulse positions, each on the route of the craft it is addressed to; returns `NO_TRAFFIC` for any input that cannot produce a pulse. */
export function deriveTraffic(
  pending: readonly PendingTrafficEntry[],
  network: CommsNetwork | undefined,
  targetVesselId: string | null | undefined,
  utNow: number | undefined,
): TrafficState {
  if (
    !network ||
    pending.length === 0 ||
    utNow === undefined ||
    !Number.isFinite(utNow)
  ) {
    return NO_TRAFFIC;
  }

  const byEdge = edgesById(network);
  const routes = new Map<
    string,
    { edgeIds: readonly string[]; hops: DirectedTrafficHop[] }
  >();
  const routeOf = (entry: PendingTrafficEntry) => {
    const craft = entry.craft ?? "";
    const toGround = craft.startsWith("ground:");
    const target = craft === "" ? (targetVesselId ?? "") : nodeIdOf(craft);
    const sender = toGround ? nodeIdOf(entry.vantage ?? "") : "";
    const key = `${target}>${sender}`;
    const held = routes.get(key);
    if (held) return held;
    const path = toGround
      ? deriveCommsPathBetween(network, target, sender)
      : deriveCommsPath(network, target);
    const route = {
      edgeIds: path.edgeIds,
      hops: directTrafficHops(target, path.edgeIds, byEdge),
    };
    routes.set(key, route);
    return route;
  };

  const pulses: IdentifiedTrafficPulse[] = [];
  const litEdgeIds = new Set<string>();
  for (const entry of pending) {
    const pulse = computeUplinkPulse(entry, utNow);
    if (!pulse) continue;
    const route = routeOf(entry);
    if (route.hops.length === 0) continue;
    const position = pulsePositionOnHops(
      route.hops,
      pulse.leg,
      pulse.progress,
      pulse.opacity,
    );
    if (!position) continue;
    pulses.push({ ...position, id: entry.id });
    for (const edgeId of route.edgeIds) litEdgeIds.add(edgeId);
  }

  return { edgeIds: [...litEdgeIds], pulses };
}
