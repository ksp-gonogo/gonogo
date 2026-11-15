import type { TopologyPart } from "@ksp-gonogo/core";
import { classifyPart } from "./classifyPart";
import { depthOf, lateralOf, partMeshCenter } from "./shipTopology";

/** The turn one press of the rotate control makes, and the finest view the control can reach. */
export const VIEW_STEP_RAD = Math.PI / 4;
/** Presses of the rotate control that make a full turn. */
export const VIEW_STEPS_PER_TURN = 8;

const CANDIDATE_COUNT = 72;
/* A part counts as unmatched past this share of the craft's longest side from where its mirror image should be, and costs no more for being further. */
const MIRROR_CAP_SHARE = 0.03;
/* Views whose unmatched share of the parts is within this of the best's are equally symmetric. */
const SYMMETRY_TOLERANCE = 0.02;
/* Among equally symmetric views, those whose silhouette is at least this share of the widest count as equally wide. */
const WIDTH_TOLERANCE = 0.97;
/* A view square to the vessel's axes is taken over a skewed one when its silhouette is at least this share of the widest. */
const SQUARE_WIDTH_SHARE = 0.85;
/* A view square to the vessel's axes counts as symmetric enough when its unmatched share is within this of the best view's. */
const SQUARE_TOLERANCE = 0.03;

interface Candidate {
  view: number;
  miss: number;
  spread: number;
}

interface Mass {
  name: string;
  x: number;
  y: number;
  z: number;
  weight: number;
}

/**
 * The angle, in radians about the spine, at which the diagram looks at a
 * craft by default: the view in which parts that come in mirrored pairs sit
 * evenly on both sides, so a plane's two wings are drawn equal. Of the views
 * that are equally symmetric the widest silhouette wins, which for a winged
 * craft is the planform seen from above, and for a craft with radial symmetry
 * the view nearest the vessel's X axis.
 *
 * Neither the facility a craft was built in nor a plane type reaches the wire,
 * so symmetry is found from the parts: each part's mirror image across the
 * spine in a candidate view is looked for among the parts of the same name,
 * and the views are ranked by how far the best-matching parts miss it.
 */
export function pickView(parts: readonly TopologyPart[]): number {
  // Launch clamps stand where the pad put them and a fuel line's box wraps its whole run, so neither says how the craft is built.
  const built = parts.filter((p) => {
    const type = classifyPart(p);
    return type !== "clamp" && type !== "fuel-line";
  });
  const masses: Mass[] = built.map((p) => {
    const [x, y, z] = partMeshCenter(p);
    const { x: sx, y: sy, z: sz } = p.bounds.size;
    return {
      name: p.name,
      x,
      y,
      z,
      weight: Math.cbrt(Math.max(sx * sy * sz, 0.001)),
    };
  });
  if (masses.length < 2) return 0;
  const extent = longestSide(masses);
  if (extent < 1e-6) return 0;
  const byName = new Map<string, Mass[]>();
  for (const m of masses) {
    const group = byName.get(m.name) ?? [];
    group.push(m);
    byName.set(m.name, group);
  }
  const total = masses.reduce((sum, m) => sum + m.weight, 0);
  const cap = extent * MIRROR_CAP_SHARE;

  const candidates: Candidate[] = Array.from(
    { length: CANDIDATE_COUNT },
    (_, k) => {
      const raw = (k * Math.PI) / CANDIDATE_COUNT;
      // A view and the one half a turn on look at the craft from opposite sides and are equally symmetric; the one within a quarter turn of X is kept.
      const view = raw > Math.PI / 2 ? raw - Math.PI : raw;
      let miss = 0;
      let spread = 0;
      for (const m of masses) {
        const lat = lateralOf(m, view);
        const depth = depthOf(m, view);
        spread += m.weight * lat * lat;
        let nearest = cap;
        for (const other of byName.get(m.name) ?? []) {
          const d = Math.hypot(
            lateralOf(other, view) + lat,
            depthOf(other, view) - depth,
            other.y - m.y,
          );
          if (d < nearest) nearest = d;
        }
        miss += m.weight * nearest;
      }
      return {
        view,
        miss: miss / total / cap,
        spread: spread / total,
      };
    },
  );

  const bestMiss = Math.min(...candidates.map((c) => c.miss));
  const symmetric = candidates.filter(
    (c) => c.miss <= bestMiss + SYMMETRY_TOLERANCE,
  );
  const widest = Math.max(...symmetric.map((c) => c.spread));
  const offAxis = (view: number) =>
    Math.abs(view - Math.round(view / (Math.PI / 2)) * (Math.PI / 2));
  const nearerX = (a: Candidate, b: Candidate) =>
    Math.abs(b.view) < Math.abs(a.view) ? b : a;
  // A view square to the vessel's axes reads most plainly, so one that is symmetric and nearly as wide as any is taken first.
  const square = candidates.filter(
    (c) =>
      offAxis(c.view) < 1e-6 &&
      c.miss <= bestMiss + SQUARE_TOLERANCE &&
      c.spread >= widest * SQUARE_WIDTH_SHARE,
  );
  if (square.length > 0) {
    const widestSquare = Math.max(...square.map((c) => c.spread));
    return square
      .filter((c) => c.spread >= widestSquare * WIDTH_TOLERANCE)
      .reduce(nearerX).view;
  }
  return symmetric
    .filter((c) => c.spread >= widest * WIDTH_TOLERANCE)
    .reduce(nearerX).view;
}

function longestSide(masses: readonly Mass[]): number {
  const range = (pick: (m: Mass) => number) => {
    const values = masses.map(pick);
    return Math.max(...values) - Math.min(...values);
  };
  return Math.max(
    range((m) => m.x),
    range((m) => m.y),
    range((m) => m.z),
  );
}

/** The view the diagram draws: the default turned by `steps` presses of the rotate control. */
export function turnedView(base: number, steps: number): number {
  return base + steps * VIEW_STEP_RAD;
}
