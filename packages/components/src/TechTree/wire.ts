import { asQuantityish, magnitudeOf } from "../shared/magnitude";

export type TechNodeState = "Available" | "Researchable" | "Unavailable";

export interface TechPart {
  name: string;
  title: string;
  manufacturer: string;
  category: string;
  entryCost: number;
  purchased: boolean;
}

export interface TechNode {
  id: string;
  title: string;
  description: string;
  /** `null` when the wire carried no price, which is not a free node. */
  scienceCost: number | null;
  state: TechNodeState;
  parents: string[];
  parts: TechPart[];
}

/** A price that never arrived sorts after every real one rather than as free. */
export function sortCost(n: { scienceCost: number | null }): number {
  return n.scienceCost ?? Number.POSITIVE_INFINITY;
}

function rawState(e: Record<string, unknown>): string {
  if (typeof e.state === "string") return e.state;
  if (e.unlocked === true) return "Available";
  return "Unavailable";
}

function clampState(stateRaw: string): TechNodeState {
  if (stateRaw === "Available" || stateRaw === "Researchable") return stateRaw;
  return "Unavailable";
}

function parsePart(raw: unknown): TechPart | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  const name = typeof p.name === "string" ? p.name : null;
  if (!name) return null;
  return {
    name,
    title: typeof p.title === "string" ? p.title : name,
    manufacturer: typeof p.manufacturer === "string" ? p.manufacturer : "",
    category: typeof p.category === "string" ? p.category : "",
    entryCost: typeof p.entryCost === "number" ? p.entryCost : 0,
    purchased: p.purchased === true,
  };
}

function notNull<T>(x: T | null): x is T {
  return x !== null;
}

/**
 * Parses tech-node arrays in either wire shape: an explicit `state` string, or `career.status.tech.nodes`, which carries only `unlocked` (mapped to "Available" / "Unavailable"; researchable-now is derived by `computeResearchable`). Drops malformed entries and tolerates missing optional fields.
 */
export function parseTechNodes(raw: unknown): TechNode[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: TechNode[] = [];
  const entries: unknown[] = raw;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === "string" ? e.id : null;
    if (!id) continue;
    out.push({
      id,
      title: typeof e.title === "string" ? e.title : id,
      description: typeof e.description === "string" ? e.description : "",
      // Compared against the available science to gate the Unlock button.
      scienceCost: magnitudeOf(asQuantityish(e.scienceCost)),
      state: clampState(rawState(e)),
      parents: Array.isArray(e.parents)
        ? e.parents.filter((p): p is string => typeof p === "string")
        : [],
      parts: Array.isArray(e.parts)
        ? e.parts.map(parsePart).filter(notNull)
        : [],
    });
  }
  return out;
}

function rank(n: TechNode, researchable: Set<string>): number {
  if (researchable.has(n.id)) return 0;
  if (n.state === "Available") return 1;
  return 2;
}

// Researchable-now first, then owned, then locked; within a group by cost then title, so the cheapest researchable node surfaces first.
export function sortNodes(
  nodes: TechNode[],
  researchable: Set<string>,
): TechNode[] {
  return [...nodes].sort((a, b) => {
    const ra = rank(a, researchable);
    const rb = rank(b, researchable);
    if (ra !== rb) return ra - rb;
    if (sortCost(a) !== sortCost(b)) return sortCost(a) - sortCost(b);
    return a.title.localeCompare(b.title);
  });
}
