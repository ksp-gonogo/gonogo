import type { Value } from "@ksp-gonogo/sitrep-sdk";
import type { TechNode } from "./wire";
import { sortCost } from "./wire";

// The tiered graph needs width to be legible; below this, and with unmeasured dims, the widget draws the compact list.
export const GRAPH_MIN_COLS = 10;

export const COL_W = 134; // px between column left edges
export const CARD_W = 118;
export const CARD_H = 48; // fits a 2-line clamped title + the cost/owned row
export const ROW_GAP = 12;
export const CANVAS_PAD = 16;

export type DisplayState = "owned" | "researchable" | "locked";

export function displayState(
  node: TechNode,
  researchable: Set<string>,
): DisplayState {
  if (node.state === "Available") return "owned";
  if (researchable.has(node.id)) return "researchable";
  return "locked";
}

export function dsBorder(ds: DisplayState): string {
  if (ds === "owned") return "var(--color-go-text)";
  if (ds === "researchable") return "var(--color-accent-fg)";
  return "var(--color-text-faint)";
}

// A card the search filtered out drops its state's fill and edge, so the matches are the only cards still drawn in a state.
export function graphCardBg(ds: DisplayState, dimmed: boolean): string {
  if (dimmed) return "var(--color-surface-panel)";
  if (ds === "owned") return "var(--color-go-status)";
  if (ds === "researchable") return "var(--color-surface-raised)";
  return "var(--color-surface-panel)";
}

export function graphCardBorder(ds: DisplayState, dimmed: boolean): string {
  if (dimmed) return "var(--color-border-subtle)";
  return dsBorder(ds);
}

/**
 * A node is researchable-now when it is not owned, every parent is unlocked, and its cost is affordable. The plugin only emits `Available` / `Unavailable`, so this is computed; an explicit `"Researchable"` state is also honoured.
 */
export function computeResearchable(
  nodes: TechNode[],
  science: Value<"science"> | null | undefined,
): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Set<string>();
  for (const n of nodes) {
    if (n.state === "Available") continue;
    if (n.state === "Researchable") {
      // Explicit state from a fixture / older payload, trust it.
      out.add(n.id);
      continue;
    }
    const parentsUnlocked = n.parents.every(
      (p) => byId.get(p)?.state === "Available",
    );
    if (!parentsUnlocked) continue;
    if (
      science != null &&
      n.scienceCost !== null &&
      science.compare(n.scienceCost) < 0
    )
      continue;
    out.add(n.id);
  }
  return out;
}

/** Longest-path depth from a root (a parentless node is tier 0); edges may span tiers. Cycle-guarded. */
export function computeTiers(nodes: TechNode[]): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  function tier(id: string): number {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const n = byId.get(id);
    if (!n || n.parents.length === 0) {
      memo.set(id, 0);
      return 0;
    }
    if (visiting.has(id)) return 0; // cycle guard
    visiting.add(id);
    let t = 0;
    for (const p of n.parents) {
      if (byId.has(p)) t = Math.max(t, tier(p) + 1);
    }
    visiting.delete(id);
    memo.set(id, t);
    return t;
  }
  for (const n of nodes) tier(n.id);
  return memo;
}

export interface PlacedNode {
  node: TechNode;
  tier: number;
  row: number; // vertical slot within the column
  x: number;
  y: number;
}

/** Assigns each node a (tier, row) slot, then orders rows within a column by the mean row of their parents to cut most edge crossings. */
export function layoutGraph(
  nodes: TechNode[],
  tiers: Map<string, number>,
): { placed: PlacedNode[]; width: number; height: number } {
  const maxTier = Math.max(0, ...nodes.map((n) => tiers.get(n.id) ?? 0));
  const columns: TechNode[][] = Array.from({ length: maxTier + 1 }, () => []);
  for (const n of nodes) columns[tiers.get(n.id) ?? 0].push(n);

  // Initial within-column order: by science cost then title (stable, readable).
  for (const col of columns) {
    col.sort(
      (a, b) => sortCost(a) - sortCost(b) || a.title.localeCompare(b.title),
    );
  }

  // Row index per node, seeded from the initial order.
  const rowOf = new Map<string, number>();
  for (const col of columns) {
    col.forEach((n, i) => {
      rowOf.set(n.id, i);
    });
  }

  // Barycenter sweep: order each column (left→right) by mean parent row.
  for (let pass = 0; pass < 4; pass++) {
    for (let t = 1; t < columns.length; t++) {
      const col = columns[t];
      const bary = new Map<string, number>();
      for (const n of col) {
        const parentRows = n.parents
          .map((p) => rowOf.get(p))
          .filter((r): r is number => r !== undefined);
        bary.set(
          n.id,
          parentRows.length
            ? parentRows.reduce((s, r) => s + r, 0) / parentRows.length
            : (rowOf.get(n.id) ?? 0),
        );
      }
      col.sort(
        (a, b) =>
          (bary.get(a.id) ?? 0) - (bary.get(b.id) ?? 0) ||
          sortCost(a) - sortCost(b),
      );
      col.forEach((n, i) => {
        rowOf.set(n.id, i);
      });
    }
  }

  const placed: PlacedNode[] = [];
  let maxRows = 0;
  for (let t = 0; t < columns.length; t++) {
    maxRows = Math.max(maxRows, columns[t].length);
    columns[t].forEach((n, row) => {
      placed.push({
        node: n,
        tier: t,
        row,
        x: CANVAS_PAD + t * COL_W,
        y: CANVAS_PAD + row * (CARD_H + ROW_GAP),
      });
    });
  }

  const width = CANVAS_PAD * 2 + maxTier * COL_W + CARD_W;
  const height = CANVAS_PAD * 2 + Math.max(1, maxRows) * (CARD_H + ROW_GAP);
  return { placed, width, height };
}
