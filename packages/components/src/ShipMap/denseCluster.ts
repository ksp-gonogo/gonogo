import type { ProjectedPart } from "./shipLayout";

/** A cluster needs at least this many parts: fewer are readable where they sit. */
export const MIN_CLUSTER_SIZE = 4;

/** A part this much of its parent's width or more is part of the stack, not of a ring around it. */
const STACK_WIDTH_FRACTION = 0.8;

/** Screen distance in pixels under which two parts count as touching. */
export const CLUSTER_GAP_PX = 4;

export interface DenseCluster {
  /** The attach parent's flight id, as a string. */
  id: string;
  parentFlightId: number;
  members: readonly ProjectedPart[];
  /** The metre-space box around every member's drawn extent. */
  latMin: number;
  latMax: number;
  axialMin: number;
  axialMax: number;
}

interface Extent {
  latMin: number;
  latMax: number;
  axialMin: number;
  axialMax: number;
}

function extentOf(p: ProjectedPart): Extent {
  return {
    latMin: p.lat - p.latHalfExtent,
    latMax: p.lat + p.latHalfExtent,
    axialMin: p.axial - p.axialHalfExtent,
    axialMax: p.axial + p.axialHalfExtent,
  };
}

function touches(a: Extent, b: Extent, gap: number): boolean {
  return (
    a.latMin - gap <= b.latMax &&
    b.latMin - gap <= a.latMax &&
    a.axialMin - gap <= b.axialMax &&
    b.axialMin - gap <= a.axialMax
  );
}

/**
 * The dense clusters of a craft: the parts attached to one parent, off its
 * stack, when at least {@link MIN_CLUSTER_SIZE} of them overlap a sibling or
 * sit within `gap` metres of one. The cluster is the whole ring around that
 * parent, so no part of it is left behind. Used by the Ship Map to offer an
 * expanded view of a ring of radial parts too crowded to read in place.
 */
export function findDenseClusters(
  parts: readonly ProjectedPart[],
  gap: number,
): DenseCluster[] {
  const byId = new Map(parts.map((p) => [p.flightId, p]));
  const childrenOf = new Map<number, ProjectedPart[]>();
  for (const p of parts) {
    if (p.parentFlightId == null || p.type === "fuel-line") continue;
    const parent = byId.get(p.parentFlightId);
    if (!parent) continue;
    const parentWidth = parent.latHalfExtent * 2;
    if (p.latHalfExtent * 2 >= parentWidth * STACK_WIDTH_FRACTION) continue;
    const list = childrenOf.get(p.parentFlightId) ?? [];
    list.push(p);
    childrenOf.set(p.parentFlightId, list);
  }

  const clusters: DenseCluster[] = [];
  for (const [parentId, children] of childrenOf) {
    const boxes = children.map(extentOf);
    const crowded = children.filter((_, i) =>
      boxes.some((other, j) => j !== i && touches(boxes[i], other, gap)),
    );
    if (crowded.length < MIN_CLUSTER_SIZE) continue;
    clusters.push({
      id: `${parentId}`,
      parentFlightId: parentId,
      members: children,
      latMin: Math.min(...boxes.map((b) => b.latMin)),
      latMax: Math.max(...boxes.map((b) => b.latMax)),
      axialMin: Math.min(...boxes.map((b) => b.axialMin)),
      axialMax: Math.max(...boxes.map((b) => b.axialMax)),
    });
  }
  return clusters;
}
