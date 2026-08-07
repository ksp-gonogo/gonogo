import { createPanelStore } from "../store/createPanelStore";
import { createStore } from "../store/createStore";
import { type Severity, severityRank, worstSeverity } from "./severity";

/**
 * One thing a contributor says about a panel's state. A `Badge` (via `report`),
 * the host-derived stream status, and the alarm bridge all publish this exact
 * shape, so state with completely different plumbing merges identically.
 */
export interface StatusContribution {
  /** Stable per contributor for its lifetime (dedupe + clean deregister). */
  id: string;
  severity: Severity;
  /** Shown when this contribution wins the summary. */
  label: string;
}

/** The winning contribution, or `null` when nothing is registered. */
export interface StatusSummary {
  severity: Severity;
  label: string;
}

/**
 * One row of the per-severity breakdown: how many contributors sit at a given
 * severity. Severities are NEVER merged across tiers, so two cautions are one
 * `{ severity: "caution", count: 2 }` row, never folded into a warning.
 */
export interface StatusBreakdownEntry {
  severity: Severity;
  count: number;
}

/**
 * A per-grid-item, off-tree status store: the generic `createStore` for the
 * register/update/subscribe/snapshot machinery, plus one derived view,
 * `getSummary`, the max-merge the panel actually shows.
 *
 * HARD RULE from the design applies verbatim: the live status data lives in the
 * store, never in a React context value, so a contribution change re-renders
 * only the summary subscribers, not every widget in the tree.
 */
export interface PanelStatusStore {
  /** Add a contribution. Returns its deregister function. */
  register(c: StatusContribution): () => void;
  /** Change an already-registered contribution's severity/label in place. */
  update(id: string, next: Omit<StatusContribution, "id">): void;
  /** Subscribe to any change to the merged summary. Returns unsubscribe. */
  subscribe(onChange: () => void): () => void;
  /** The max-merge summary, referentially stable while unchanged. */
  getSummary(): StatusSummary | null;
  /**
   * Per-severity counts, worst-first, referentially stable while unchanged.
   * Each distinct severity is its own row with its own count; nothing is folded
   * across tiers, unlike `getSummary`'s single max-merge winner.
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
    if (c.severity === worst) return { severity: c.severity, label: c.label };
  }
  return null; // unreachable: worst is drawn from the set
}

// Shared frozen empty so an empty store returns one stable identity (a fresh
// `[]` per call would loop useSyncExternalStore).
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

  // Derived-view cache keyed on the base snapshot's identity: while the entry
  // set is unchanged the snapshot is the same array, so the summary is too.
  // When it changes, recompute and preserve the previous summary object if the
  // merged result is equal (a losing contributor moving must not hand
  // useSyncExternalStore a fresh summary).
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
 * Provides one store for a dashboard grid item, so both the widget body and the
 * drag-bar chrome subscribe to the same off-tree store. The store is created
 * once and kept for the provider's whole life; the value never changes
 * identity, so mounting it re-renders nothing.
 */
export const PanelStatusStoreProvider = StatusPanelStore.Provider;

/** The nearest store, or `null` outside a dashboard grid item. */
export const usePanelStatusStore = StatusPanelStore.useStore;
