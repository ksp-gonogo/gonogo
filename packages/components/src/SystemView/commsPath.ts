import {
  CommsHopKind,
  type CommsNetwork,
  type CommsNetworkEdge,
} from "@ksp-gonogo/sitrep-sdk";

/**
 * The selected vessel's CommNet route to home, derived by walking
 * `comms.network`'s already-contributed graph (the same topic
 * `vesselOrbitsContribution.ts` reads to draw the faint relay lines). No
 * per-vessel path ships on the wire, so this is a generic BFS over `edges`,
 * not a lookup: a graph node's `id` IS a vessel's `vesselId`, so the selected
 * vessel IS a node to search from.
 *
 * `quality` governs TRAVERSAL only, which edges make up the highlighted
 * path: `"full"` prefers a path using only `active: true` edges, the live
 * control route; `"partial"` falls back to every edge regardless of
 * `active` when no all-active route exists (e.g. a relay hop has dropped
 * out of range this tick but the topology still connects); `"none"` means
 * the vessel is unreachable from home at all. It is deliberately NOT the
 * colour source: a vessel can sit on an all-active edge chain to home
 * through ANOTHER vessel's relay while its own `CommsControlSource` is
 * still Partial or None, so colouring by this field would draw a green
 * line for a vessel the info panel reports as degraded. The colour instead
 * comes from `commsControlQuality`, keyed off the selected vessel's own
 * roster control state (`RosterCommsControlSource`, `vesselOrbitsContribution
 * .ts`'s `commsLabel`), so the line always agrees with the info panel.
 */
export type CommsPathQuality = "full" | "partial" | "none";

export interface DerivedCommsPath {
  quality: CommsPathQuality;
  /**
   * Entity ids of the `comms-edge:<a>:<b>` contribution entries that make up
   * the route, in traversal order. Empty when `quality` is `"none"`.
   */
  edgeIds: readonly string[];
}

export const NO_COMMS_PATH: DerivedCommsPath = {
  quality: "none",
  edgeIds: [],
};

/** Mirrors `vesselOrbitsContribution.ts`'s own home-node convention: `"home"`
 *  is always the KSC id, plus any node whose `kind` says so explicitly. */
function resolveHomeNodeIds(network: CommsNetwork): ReadonlySet<string> {
  const ids = new Set(
    network.nodes.filter((n) => n.kind === CommsHopKind.Home).map((n) => n.id),
  );
  ids.add("home");
  return ids;
}

/** The id a `comms.network` edge's contributed `connection-line` entity is
 *  assigned. `vesselOrbitsContribution.ts` calls this to produce the id, and
 *  `commsTraffic.ts` calls it again to walk the SAME edges by id to place a
 *  pulse. One definition, so producer and consumers can never drift apart. */
export function edgeEntityId(edge: CommsNetworkEdge): string {
  return `comms-edge:${edge.a}:${edge.b}`;
}

/** Undirected adjacency: each edge reachable from both its endpoints,
 *  carrying the ORIGINAL edge object so a traversed hop reconstructs the
 *  same `edgeEntityId` the contribution used, regardless of walk direction. */
function buildAdjacency(
  edges: readonly CommsNetworkEdge[],
): Map<string, Array<{ to: string; edge: CommsNetworkEdge }>> {
  const adjacency = new Map<
    string,
    Array<{ to: string; edge: CommsNetworkEdge }>
  >();
  const link = (from: string, to: string, edge: CommsNetworkEdge) => {
    const hops = adjacency.get(from);
    if (hops) hops.push({ to, edge });
    else adjacency.set(from, [{ to, edge }]);
  };
  for (const edge of edges) {
    link(edge.a, edge.b, edge);
    link(edge.b, edge.a, edge);
  }
  return adjacency;
}

/**
 * BFS shortest hop-count path from `fromId` to any id in `targetIds`, over
 * `edges`. Returns the ordered edges the walk crossed, or `null` when no
 * target is reachable. `fromId` itself matching a target is the zero-hop
 * case (empty path, no edges to highlight).
 */
function shortestPathToAny(
  edges: readonly CommsNetworkEdge[],
  fromId: string,
  targetIds: ReadonlySet<string>,
): CommsNetworkEdge[] | null {
  if (targetIds.has(fromId)) return [];
  const adjacency = buildAdjacency(edges);
  const visited = new Set<string>([fromId]);
  const cameFrom = new Map<string, { from: string; edge: CommsNetworkEdge }>();
  const queue: string[] = [fromId];
  let reached: string | null = null;

  for (let head = 0; head < queue.length && reached === null; head++) {
    const current = queue[head];
    for (const { to, edge } of adjacency.get(current) ?? []) {
      if (visited.has(to)) continue;
      visited.add(to);
      cameFrom.set(to, { from: current, edge });
      if (targetIds.has(to)) {
        reached = to;
        break;
      }
      queue.push(to);
    }
  }
  if (reached === null) return null;

  const path: CommsNetworkEdge[] = [];
  let cursor = reached;
  while (cursor !== fromId) {
    const step = cameFrom.get(cursor);
    if (!step) return null; // unreachable: defensive, cameFrom is exhaustive for any visited node
    path.unshift(step.edge);
    cursor = step.from;
  }
  return path;
}

/**
 * Derives the selected vessel's route to home: an active-only walk first
 * (the live control path, `"full"`), falling back to a walk over every edge
 * regardless of `active` (`"partial"`, the topology still connects even
 * though the live route doesn't), and finally `NO_COMMS_PATH` when the
 * vessel isn't reachable from home at all.
 */
export function deriveCommsPath(
  network: CommsNetwork | undefined,
  vesselId: string,
): DerivedCommsPath {
  if (!network || vesselId.length === 0) return NO_COMMS_PATH;

  const homeNodeIds = resolveHomeNodeIds(network);

  const activeEdges = network.edges.filter((e) => e.active);
  const fullPath = shortestPathToAny(activeEdges, vesselId, homeNodeIds);
  if (fullPath) {
    return { quality: "full", edgeIds: fullPath.map(edgeEntityId) };
  }

  const anyPath = shortestPathToAny(network.edges, vesselId, homeNodeIds);
  if (anyPath) {
    return { quality: "partial", edgeIds: anyPath.map(edgeEntityId) };
  }

  return NO_COMMS_PATH;
}

/** GREEN for full control, its own degraded tone for partial, a third for
 *  none, indexed by `commsControlQuality`'s result rather than
 *  `deriveCommsPath`'s traversal-only `quality` (see this file's module doc
 *  comment). `"none"` is reachable here (an edge can be highlighted for a
 *  vessel whose own control source is None while the topology still
 *  connects it to home some other way), unlike `deriveCommsPath`'s own
 *  `"none"`, which never has edges to paint. */
export const COMMS_PATH_COLOUR: Readonly<Record<CommsPathQuality, string>> = {
  full: "var(--color-status-go-bg)",
  partial: "var(--color-status-warning-bg)",
  none: "var(--color-status-nogo-bg)",
};

/**
 * Maps the selected vessel's own roster comms-control label (`commsLabel()`
 * in `vesselOrbitsContribution.ts`, carried on `SystemEntity.meta.comms`) to
 * a `CommsPathQuality` tier for `COMMS_PATH_COLOUR` to index. This is the
 * highlighted path's actual colour source (see the module doc comment for
 * why it isn't `deriveCommsPath`'s own `quality`). An unrecognised or
 * missing label (roster hasn't caught up yet, or reports "unknown") degrades
 * to `"none"` rather than assuming full control.
 */
export function commsControlQuality(
  commsLabel: string | number | boolean | undefined,
): CommsPathQuality {
  switch (commsLabel) {
    case "connected":
      return "full";
    case "relay":
      return "partial";
    default:
      return "none";
  }
}
