import {
  CommsHopKind,
  type CommsNetwork,
  type CommsNetworkEdge,
} from "@ksp-gonogo/sitrep-sdk";

/**
 * The selected vessel's CommNet route to home, by BFS over `comms.network`'s edges; a graph node's `id` is a vessel's `vesselId`.
 *
 * `quality` governs traversal only: `"full"` uses only active edges, `"partial"` falls back to every edge, `"none"` is unreachable. It is NOT the colour source, because a vessel can route over another's active relay while its own control is Partial or None; `commsControlQuality` colours the line from the roster so it agrees with the info panel.
 */
export type CommsPathQuality = "full" | "partial" | "none";

export interface DerivedCommsPath {
  quality: CommsPathQuality;
  /** Ids of the `comms-edge:<a>:<b>` entities on the route, in traversal order; empty when `quality` is `"none"`. */
  edgeIds: readonly string[];
}

export const NO_COMMS_PATH: DerivedCommsPath = {
  quality: "none",
  edgeIds: [],
};

/** `"home"` is always the KSC id, plus any node whose `kind` says so. */
function resolveHomeNodeIds(network: CommsNetwork): ReadonlySet<string> {
  const ids = new Set(
    network.nodes.filter((n) => n.kind === CommsHopKind.Home).map((n) => n.id),
  );
  ids.add("home");
  return ids;
}

/** The id of a `comms.network` edge's contributed `connection-line` entity, shared by its producer and every consumer. */
export function edgeEntityId(edge: CommsNetworkEdge): string {
  return `comms-edge:${edge.a}:${edge.b}`;
}

/** Undirected adjacency carrying the original edge, so a hop walked backwards still yields the contribution's `edgeEntityId`. */
function buildAdjacency(
  edges: readonly CommsNetworkEdge[],
): Map<string, Array<{ to: string; edge: CommsNetworkEdge }>> {
  const adjacency = new Map<
    string,
    Array<{ to: string; edge: CommsNetworkEdge }>
  >();
  const link = (from: string, to: string, edge: CommsNetworkEdge) => {
    const hops = adjacency.get(from);
    if (!hops) {
      adjacency.set(from, [{ to, edge }]);
      return;
    }
    hops.push({ to, edge });
  };
  for (const edge of edges) {
    link(edge.a, edge.b, edge);
    link(edge.b, edge.a, edge);
  }
  return adjacency;
}

/** BFS shortest hop-count path from `fromId` to any of `targetIds`, or `null` when none is reachable; a zero-hop match is an empty path. */
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
    if (!step) return null;
    path.unshift(step.edge);
    cursor = step.from;
  }
  return path;
}

/** The selected vessel's route to home: active edges first (`"full"`), then every edge (`"partial"`), else `NO_COMMS_PATH`. */
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

/** Indexed by `commsControlQuality`, not the traversal `quality`; `"none"` is reachable here because a vessel with no control can still be linked to home. */
export const COMMS_PATH_COLOUR: Readonly<Record<CommsPathQuality, string>> = {
  full: "var(--color-go-mark)",
  partial: "var(--color-warn-mark)",
  none: "var(--color-nogo-mark)",
};

/** Maps the selected vessel's roster comms label to a colour tier; an unrecognised or missing label degrades to `"none"` rather than assuming control. */
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
