import { createPanelStore } from "../store/createPanelStore";
import { createStore } from "../store/createStore";
import { type Severity, severityRank, worstSeverity } from "./severity";

/**
 * One statement about a panel's state, as published to its
 * {@link PanelStatusStore}. A {@link Badge} with `report`, the panel's stream
 * status and the dashboard's alarms all publish this shape, and the panel
 * summarises them together.
 *
 * @category Panel
 */
export interface StatusContribution {
  /** Stable for the contributor's lifetime; a second contribution with the same id replaces the first. */
  id: string;
  severity: Severity;
  /** Shown when this contribution wins the summary. */
  label: string;
}

/**
 * The contribution that wins a panel's summary: the worst severity, and the
 * earliest registered among equals. `id` is the winner's own contribution id,
 * so a caller already drawing that contribution (as a badge pill, say) can
 * skip drawing it twice.
 *
 * @category Panel
 */
export interface StatusSummary {
  id: string;
  severity: Severity;
  label: string;
}

/**
 * One row of a panel's per-severity breakdown: how many contributions sit at
 * one severity. Two cautions are one `{ severity: "caution", count: 2 }` row;
 * severities are never folded into a worse one.
 *
 * @category Panel
 */
export interface StatusBreakdownEntry {
  severity: Severity;
  count: number;
}

/**
 * The store of {@link StatusContribution}s for one dashboard tile, from which
 * the panel draws its summary badge and the collapsed header's status dots.
 * Components publish with {@link useStatusContribution} and read with
 * {@link useStatusSummary} and {@link useStatusBreakdown}; a change re-renders
 * only those subscribers.
 *
 * @category Panel
 */
export interface PanelStatusStore {
  /** Adds a contribution. Returns a function that removes it. */
  register(c: StatusContribution): () => void;
  /** Changes a registered contribution's severity and label in place. */
  update(id: string, next: Omit<StatusContribution, "id">): void;
  /** Calls `onChange` on any change to the contributions. Returns a function that unsubscribes. */
  subscribe(onChange: () => void): () => void;
  /** The winning contribution (see {@link StatusSummary}), or `null` when there are none. The same object is returned while the result is unchanged. */
  getSummary(): StatusSummary | null;
  /**
   * Per-severity counts, worst first, one row per severity present. The same
   * array is returned while the counts are unchanged.
   */
  getBreakdown(): readonly StatusBreakdownEntry[];
}

/** The worst contribution's OWN label, tie-broken by insertion order (the
 * earliest contribution at the worst rank wins, so the winning label cannot
 * flicker between two equal-severity contributors frame to frame). */
function summarise(
  contributions: readonly StatusContribution[],
): StatusSummary | null {
  if (contributions.length === 0) return null;
  const worst = worstSeverity(contributions.map((c) => c.severity));
  for (const c of contributions) {
    if (c.severity === worst) {
      return { id: c.id, severity: c.severity, label: c.label };
    }
  }
  return null; // unreachable: worst is drawn from the set
}

// Shared frozen empty so an empty store returns one stable identity (a fresh `[]` per call would loop useSyncExternalStore).
const EMPTY_BREAKDOWN: readonly StatusBreakdownEntry[] = Object.freeze([]);

/** Per-severity counts, worst-first. Each distinct severity is its own row with
 * its own count; nothing is folded across tiers. */
function breakdownOf(
  contributions: readonly StatusContribution[],
): readonly StatusBreakdownEntry[] {
  if (contributions.length === 0) return EMPTY_BREAKDOWN;
  const counts = new Map<Severity, number>();
  for (const c of contributions) {
    counts.set(c.severity, (counts.get(c.severity) ?? 0) + 1);
  }
  return Array.from(counts, ([severity, count]) => ({ severity, count })).sort(
    (a, b) => severityRank(b.severity) - severityRank(a.severity),
  );
}

/** Structural equality over the worst-first entries (same length, same
 * severity + count at each index), so a change that leaves the breakdown
 * identical (a label-only update) preserves the array's identity. */
function breakdownEqual(
  a: readonly StatusBreakdownEntry[],
  b: readonly StatusBreakdownEntry[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].severity !== b[i].severity || a[i].count !== b[i].count) {
      return false;
    }
  }
  return true;
}

export function createPanelStatusStore(): PanelStatusStore {
  const base = createStore<StatusContribution>();

  /*
   * Derived views are cached on the base snapshot's identity, and an equal
   * recomputed result keeps the previous object, so a losing contributor
   * moving never hands useSyncExternalStore a fresh summary.
   */
  let cachedSummary: StatusSummary | null = null;
  let cachedFrom: readonly StatusContribution[] | null = null;
  let cachedBreakdown: readonly StatusBreakdownEntry[] = EMPTY_BREAKDOWN;
  let cachedBreakdownFrom: readonly StatusContribution[] | null = null;

  return {
    register: base.register,
    update: base.update,
    subscribe: base.subscribe,
    getSummary() {
      const snapshot = base.getSnapshot();
      if (snapshot === cachedFrom) return cachedSummary;
      const next = summarise(snapshot);
      cachedFrom = snapshot;
      if (
        cachedSummary !== null &&
        next !== null &&
        cachedSummary.id === next.id &&
        cachedSummary.severity === next.severity &&
        cachedSummary.label === next.label
      ) {
        return cachedSummary; // identity preserved: same merged result
      }
      cachedSummary = next;
      return cachedSummary;
    },
    getBreakdown() {
      const snapshot = base.getSnapshot();
      if (snapshot === cachedBreakdownFrom) return cachedBreakdown;
      const next = breakdownOf(snapshot);
      cachedBreakdownFrom = snapshot;
      if (breakdownEqual(cachedBreakdown, next)) return cachedBreakdown;
      cachedBreakdown = next;
      return cachedBreakdown;
    },
  };
}

/** Shared, stable empty breakdown for the no-store hook fallback (same identity
 * an empty store returns), so `useSyncExternalStore` has a referentially stable
 * snapshot with no provider in the tree. */
export const NO_STATUS_BREAKDOWN = EMPTY_BREAKDOWN;

const StatusPanelStore = createPanelStore(createPanelStatusStore);

/**
 * Creates one {@link PanelStatusStore} and provides it for as long as it is
 * mounted, so the widget body and the tile's chrome share it. The dashboard
 * mounts one per tile.
 *
 * @category Panel
 */
export const PanelStatusStoreProvider = StatusPanelStore.Provider;

/**
 * The nearest {@link PanelStatusStore}, or `null` outside a dashboard tile.
 *
 * @category Panel
 */
export const usePanelStatusStore = StatusPanelStore.useStore;
