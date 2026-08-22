import type { CommsNetwork, CommsNetworkEdge } from "@ksp-gonogo/sitrep-sdk";
import {
  computeUplinkPulse,
  type PendingPulseEntry,
  type UplinkPulseLeg,
} from "../FleetComms/pendingPulse";
import { deriveCommsPath, edgeEntityId } from "./commsPath";

/**
 * Command traffic. Unlike the straight line from
 * the diagram origin to the active vessel's own dot, this ROUTES each
 * `system.uplink.pending` pulse along the actual `comms.network` relay path
 * (the same graph `vesselOrbitsContribution.ts` draws, `commsPath.ts` walks
 * for selection). `PendingUplink` carries no vessel-target field (a hard
 * contract invariant, see `UplinkPending.cs`'s class doc: it must never grow
 * a vessel-derived field), so every entry is implicitly addressed to the
 * CURRENT ACTIVE VESSEL, the only craft the mod's command channel can
 * possibly dispatch to. A decoration only: it never re-renders the graph's
 * own geometry, only reads the ALREADY-PROJECTED `connection-line` endpoints
 * by entity id (`SystemEntitiesLayer`'s `pulses` prop).
 */

/** One `comms.network` edge, directed to match the WALK it was traversed in
 *  (`forward`: true when the walk crossed it a -> b, matching the edge's own
 *  `connection-line` draw order `x1,y1 (a) -> x2,y2 (b)`; false for b -> a). */
export interface DirectedTrafficHop {
  edgeId: string;
  forward: boolean;
}

/**
 * Directs `deriveCommsPath`'s vessel->home edge id list by re-walking it from
 * `vesselId`, looking up each edge's real `a`/`b` via `edgesById` to record
 * which way THIS walk crossed it. Stops early (returning whatever hops were
 * resolved so far) if an id in `edgeIds` isn't in `edgesById`: defensive only,
 * `edgeIds` always comes straight off these same edges in practice.
 */
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

/** `comms.network`'s edges, indexed by the same id `edgeEntityId` assigns
 *  their contributed `connection-line` entity. */
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

/** A `system.uplink.pending` entry, `PendingPulseEntry`'s dispatch-time
 *  fields plus the queue's own correlation id: needed here (unlike
 *  `computeUplinkPulse`, which stays entry-shape-agnostic) so each rendered
 *  pulse marker keeps a STABLE React key even when two entries share an
 *  edge at the same instant, which array position can't guarantee. */
export interface PendingTrafficEntry extends PendingPulseEntry {
  id: string;
}

/**
 * Places a `computeUplinkPulse` leg+progress on a specific hop + a LOCAL t
 * within it, in `hops`' own a->b sense. `hops` is always in vessel->home
 * order (`directTrafficHops`'s contract): the RETURN leg (target -> home)
 * travels that order directly; the OUTBOUND leg (home -> target) travels it
 * reversed. `null` when there are no hops to place a pulse on (the target IS
 * the home node, or the route doesn't resolve).
 */
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
  // `hop.forward` records whether the CANONICAL vessel->home walk crosses
  // this edge a->b. Travelling vessel->home matches that sense directly;
  // travelling home->vessel (outbound) is its mirror.
  const aToB = travellingVesselToHome ? hop.forward : !hop.forward;
  const t = aToB ? legLocalT : 1 - legLocalT;

  return { edgeId: hop.edgeId, t, opacity };
}

/** One in-flight pulse, keyed by its `system.uplink.pending` entry's own
 *  `id`: the stable identity a consumer (`SystemEntitiesLayer`'s React
 *  `key`) needs, since two entries can legitimately share an `edgeId` at the
 *  same instant. */
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

/**
 * Full pipeline: `system.uplink.pending` entries -> in-flight pulse
 * positions on the active vessel's `comms.network` route. `targetVesselId`
 * is always the ACTIVE vessel (see this file's module doc: the wire has no
 * other addressable target). Returns `NO_TRAFFIC` up front for any input
 * that can't possibly produce a pulse, so a caller never needs its own
 * empty-state guard.
 */
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
