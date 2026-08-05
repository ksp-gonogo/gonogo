import { createContext, type ReactNode, useContext, useRef } from "react";
import { type Severity, worstSeverity } from "./severity";

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
 * A per-grid-item, off-tree status store. Plain subscribe/getSnapshot state
 * with stable identity for the item's whole life, mirroring the resolved
 * delay-output design (`DelayStore`).
 *
 * HARD RULE from that design applies verbatim: the live status data lives in
 * the store, never in a React context value, so a contribution change
 * re-renders only the summary subscribers, not every widget in the tree.
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
}

export function createPanelStatusStore(): PanelStatusStore {
  // Insertion-ordered by construction (Map), which is what makes the top-rank
  // tie-break deterministic: the earliest-registered contribution at the worst
  // rank wins, so the winning label cannot flicker between two equal-severity
  // contributors frame to frame.
  const contributions = new Map<string, StatusContribution>();
  const listeners = new Set<() => void>();

  // Cached last summary so `getSummary` returns a referentially stable object
  // while the merged result is unchanged (the useSyncExternalStore no-loop
  // guard, same discipline use-command.ts uses with its shared IDLE constant).
  let cached: StatusSummary | null = null;
  let dirty = true;

  function emit() {
    dirty = true;
    for (const listener of listeners) listener();
  }

  function recompute(): StatusSummary | null {
    if (contributions.size === 0) return null;
    const worst = worstSeverity(
      Array.from(contributions.values(), (c) => c.severity),
    );
    // First contribution at the worst rank, in insertion order.
    for (const c of contributions.values()) {
      if (c.severity === worst) return { severity: c.severity, label: c.label };
    }
    return null; // unreachable: worst is drawn from the set
  }

  return {
    register(c) {
      contributions.set(c.id, { ...c });
      emit();
      return () => {
        if (contributions.delete(c.id)) emit();
      };
    },
    update(id, next) {
      const existing = contributions.get(id);
      if (!existing) return;
      if (
        existing.severity === next.severity &&
        existing.label === next.label
      ) {
        return; // no-op keeps summary identity stable
      }
      contributions.set(id, { id, ...next });
      emit();
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    getSummary() {
      if (!dirty) return cached;
      const next = recompute();
      // Preserve object identity when the merged result is equal, so a change
      // that does not move the summary (a losing contributor updating) does not
      // hand useSyncExternalStore a new snapshot.
      if (
        cached !== null &&
        next !== null &&
        cached.severity === next.severity &&
        cached.label === next.label
      ) {
        dirty = false;
        return cached;
      }
      cached = next;
      dirty = false;
      return cached;
    },
  };
}

/**
 * Carries only the store HANDLE, never the live status. `null` outside a
 * dashboard (settings modal, station connect view), where there is no summary,
 * exactly as `usePanelStreamStatus` returns `null` there today.
 */
const PanelStatusStoreCtx = createContext<PanelStatusStore | null>(null);

/**
 * Provides one store for a dashboard grid item, so both the widget body and the
 * drag-bar chrome subscribe to the same off-tree store. Same placement as
 * `DelayStore`. The store is created once and kept for the provider's whole
 * life; the value never changes identity, so mounting it re-renders nothing.
 */
export function PanelStatusStoreProvider({
  children,
}: {
  children?: ReactNode;
}) {
  const storeRef = useRef<PanelStatusStore | null>(null);
  if (storeRef.current === null) storeRef.current = createPanelStatusStore();
  return (
    <PanelStatusStoreCtx.Provider value={storeRef.current}>
      {children}
    </PanelStatusStoreCtx.Provider>
  );
}

/** The nearest store, or `null` outside a dashboard grid item. */
export function usePanelStatusStore(): PanelStatusStore | null {
  return useContext(PanelStatusStoreCtx);
}
