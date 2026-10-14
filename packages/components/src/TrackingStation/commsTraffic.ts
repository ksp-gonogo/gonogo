import type { CommsNetwork, CommsNetworkEdge } from "@ksp-gonogo/sitrep-sdk";
import {
  computeUplinkPulse,
  type PendingPulseEntry,
  type UplinkPulseLeg,
} from "../FleetComms/pendingPulse";
import { deriveCommsPath, edgeEntityId } from "./commsPath";

/*
 * Command traffic routes each `system.uplink.pending` pulse along the actual `comms.network` relay path, reading the already-projected `connection-line` endpoints by entity id.
 * `PendingUplink` carries no vessel target by contract, so every entry is addressed to the current active vessel, the only craft the command channel can reach.
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
  /** Every edge id on the active vessel's route to home, non-empty only while at least one pulse is actually in flight on it. */
  edgeIds: readonly string[];
  /** One position per in-flight `system.uplink.pending` entry. */
  pulses: readonly IdentifiedTrafficPulse[];
}

export const NO_TRAFFIC: TrafficState = { edgeIds: [], pulses: [] };

/** `system.uplink.pending` entries to in-flight pulse positions on the active vessel's route; returns `NO_TRAFFIC` for any input that cannot produce a pulse. */
export function deriveTraffic(
  pending: readonly PendingTrafficEntry[],
  network: CommsNetwork | undefined,
  targetVesselId: string | null | undefined,
  utNow: number | undefined,
): TrafficState {
  if (
    !network ||
    !targetVesselId ||
    pending.length === 0 ||
    utNow === undefined ||
    !Number.isFinite(utNow)
  ) {
    return NO_TRAFFIC;
  }

  const path = deriveCommsPath(network, targetVesselId);
  if (path.edgeIds.length === 0) return NO_TRAFFIC;

  const hops = directTrafficHops(
    targetVesselId,
    path.edgeIds,
    edgesById(network),
  );

  const pulses: IdentifiedTrafficPulse[] = [];
  for (const entry of pending) {
    const pulse = computeUplinkPulse(entry, utNow);
    if (!pulse) continue;
    const position = pulsePositionOnHops(
      hops,
      pulse.leg,
      pulse.progress,
      pulse.opacity,
    );
    if (position) pulses.push({ ...position, id: entry.id });
  }

  return { edgeIds: pulses.length > 0 ? path.edgeIds : [], pulses };
}
