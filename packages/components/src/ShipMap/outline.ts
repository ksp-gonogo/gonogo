/** A point in a part's drawn box frame: metres from the box centre, x across and y up. */
export interface OutlinePoint {
  x: number;
  y: number;
}

function cross(o: OutlinePoint, a: OutlinePoint, b: OutlinePoint): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * The convex hull of a point set, counter-clockwise, by the monotone chain.
 * A set with fewer than three distinct points has no area to draw and returns
 * empty.
 */
export function convexHull(points: readonly OutlinePoint[]): OutlinePoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return [];
  const build = (list: readonly OutlinePoint[]) => {
    const chain: OutlinePoint[] = [];
    for (const p of list) {
      while (
        chain.length >= 2 &&
        cross(chain[chain.length - 2], chain[chain.length - 1], p) <= 1e-9
      ) {
        chain.pop();
      }
      chain.push(p);
    }
    chain.pop();
    return chain;
  };
  const hull = [...build(sorted), ...build([...sorted].reverse())];
  return hull.length >= 3 ? hull : [];
}
