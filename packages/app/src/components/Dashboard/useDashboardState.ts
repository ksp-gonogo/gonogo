import type { InputMappings } from "@ksp-gonogo/serial";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Layout, LayoutItem } from "react-grid-layout";
import type { DashboardConfig, DashboardItem } from "./index";
import { COLS, firstFreeSlot } from "./layoutNormalization";

interface PersistedState {
  items: DashboardItem[];
  layout: Layout;
}

function loadState(key: string): PersistedState | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const state = parsed as PersistedState;
    // One entry that is not an item must not cost the operator every other widget on the layout.
    const items = Array.isArray(state.items)
      ? state.items.filter(
          (it): it is DashboardItem =>
            typeof it === "object" &&
            it !== null &&
            typeof it.i === "string" &&
            typeof it.componentId === "string",
        )
      : [];
    return {
      items,
      layout: Array.isArray(state.layout) ? state.layout : [],
    };
  } catch {
    return null;
  }
}

function saveState(key: string, state: PersistedState): void {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // quota / private browsing: in-memory state is authoritative.
  }
}

/**
 * Owns the items + layout state for a Dashboard instance and persists it
 * under `storageKey`. Screens (MainScreen / StationScreen) call this hook
 * and pass the result into `<Dashboard>` as props, so other consumers
 * (notably the InputDispatcher) can subscribe to item changes
 * without reaching into Dashboard internals.
 */
export interface DashboardState {
  items: DashboardItem[];
  layout: Layout;
  /**
   * Set to the id of the most recently added item so the Dashboard can scroll
   * to and briefly highlight it. Cleared by the Dashboard via `clearLastAdded`
   * once the highlight animation finishes.
   */
  lastAddedId: string | null;
  /** Clears `lastAddedId` if it matches the supplied id (no-op otherwise). */
  clearLastAdded: (id: string) => void;
  handleLayoutChange: (layout: Layout) => void;
  addItem: (item: DashboardItem, placement: Partial<LayoutItem>) => void;
  removeItem: (id: string) => void;
  /** Reorder: move the item with this id one slot earlier in `items`. No-op for the first item. */
  moveItemUp: (id: string) => void;
  /** Reorder: move the item with this id one slot later in `items`. No-op for the last item. */
  moveItemDown: (id: string) => void;
  updateItemConfig: (id: string, config: Record<string, unknown>) => void;
  updateItemMappings: (id: string, mappings: InputMappings) => void;
  /** Set the per-instance mobile-width override (used by MobileDashboard). */
  updateItemMobileWidth: (id: string, width: "full" | "half") => void;
  updateItemMobileHeight: (id: string, height: "full" | "half") => void;
  /** Subscribe to item changes, fires after every add / update. */
  subscribeItems: (cb: (items: DashboardItem[]) => void) => () => void;
  /** Always returns the latest items without going through React render. */
  getItems: () => readonly DashboardItem[];
  /** Replace items + layout wholesale (mission-profile load). */
  replaceState: (items: DashboardItem[], layout: Layout) => void;
}

export function useDashboardState(
  storageKey: string | undefined,
  initial: DashboardConfig,
): DashboardState {
  // Read once: a ref's initial value is evaluated on every render, a state initialiser is not.
  const [saved] = useState<PersistedState | null>(() =>
    storageKey ? loadState(storageKey) : null,
  );

  const [items, setItemsInner] = useState<DashboardItem[]>(
    saved?.items ?? initial.items,
  );
  const [layout, setLayout] = useState<Layout>(saved?.layout ?? initial.layout);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const itemListeners = useRef(new Set<(items: DashboardItem[]) => void>());
  const hasMountedRef = useRef(false);
  // The key the current items belong to. Updated only *after* a key change has
  // loaded/seeded the incoming key, so the persist effect below never writes
  // the outgoing scene's items under the incoming scene's key.
  const activeKeyRef = useRef(storageKey);
  const storageKeyRef = useRef(storageKey);
  storageKeyRef.current = storageKey;
  /* Set when the whole dashboard is replaced while a key change is still
     waiting for its effect below. A child's effect runs before this hook's, so
     a layout loaded because of the scene change arrives first, and loading the
     incoming key's saved layout after it would undo it. */
  const replacedForKeyRef = useRef<string | undefined>(undefined);

  // Side effects (persistence + external subscribers) run from an effect, NOT
  // inside the setState updater: StrictMode double-invokes updaters to
  // detect impurity, which would duplicate writes and subscriber callbacks.
  // Persist to the *active* key (not the prop) so a mid-render scene switch
  // can't clobber the new scene's slot with the old scene's items.
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    const key = activeKeyRef.current;
    if (key) saveState(key, { items, layout });
    itemListeners.current.forEach((cb) => {
      cb(items);
    });
  }, [items, layout]);

  // Scene-scoped key changed (e.g. the operator entered a different KSP
  // scene): load that key's saved layout, or seed it from the current
  // dashboard so a never-visited scene starts populated rather than empty.
  // The outgoing scene's edits are already persisted under its own key by the
  // effect above, so nothing is lost.
  useEffect(() => {
    if (storageKey === activeKeyRef.current) return;
    activeKeyRef.current = storageKey;
    const replaced = replacedForKeyRef.current === storageKey;
    replacedForKeyRef.current = undefined;
    // The replacement is already in state and is saved under the incoming key by the effect above.
    if (replaced) return;
    const next = storageKey ? loadState(storageKey) : null;
    if (next) {
      setItemsInner(next.items);
      setLayout(next.layout);
      return;
    }
    if (storageKey) {
      // Seed the new key from what's on screen now; keep showing it.
      saveState(storageKey, {
        items: itemsRef.current,
        layout: layoutRef.current,
      });
    }
  }, [storageKey]);

  const handleLayoutChange = useCallback((next: Layout) => {
    setLayout(next);
  }, []);

  const addItem = useCallback(
    (item: DashboardItem, placement: Partial<LayoutItem>) => {
      setItemsInner((prev) => [...prev, item]);
      // Without a caller-supplied x/y the widget takes the first free slot wide enough for it.
      const w = placement.w ?? 3;
      const h = placement.h ?? 3;
      const placed: LayoutItem =
        placement.x !== undefined || placement.y !== undefined
          ? { i: item.i, x: 0, y: 9999, w, h, ...placement }
          : {
              ...placement,
              i: item.i,
              ...firstFreeSlot(layout, { w, h }, COLS),
            };
      setLayout([...layout, placed]);
      setLastAddedId(item.i);
    },
    [layout],
  );

  const clearLastAdded = useCallback((id: string) => {
    setLastAddedId((prev) => (prev === id ? null : prev));
  }, []);

  const removeItem = useCallback((id: string) => {
    setItemsInner((prev) => prev.filter((it) => it.i !== id));
    setLayout((prev) => prev.filter((l) => l.i !== id));
  }, []);

  const moveItemUp = useCallback((id: string) => {
    setItemsInner((prev) => {
      const idx = prev.findIndex((it) => it.i === id);
      if (idx <= 0) return prev;
      const next = prev.slice();
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  }, []);

  const moveItemDown = useCallback((id: string) => {
    setItemsInner((prev) => {
      const idx = prev.findIndex((it) => it.i === id);
      if (idx === -1 || idx >= prev.length - 1) return prev;
      const next = prev.slice();
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }, []);

  const updateItemConfig = useCallback(
    (id: string, newConfig: Record<string, unknown>) => {
      setItemsInner((prev) =>
        prev.map((it) => (it.i === id ? { ...it, config: newConfig } : it)),
      );
    },
    [],
  );

  const updateItemMappings = useCallback(
    (id: string, mappings: InputMappings) => {
      setItemsInner((prev) =>
        prev.map((it) =>
          it.i === id ? { ...it, inputMappings: mappings } : it,
        ),
      );
    },
    [],
  );

  const updateItemMobileWidth = useCallback(
    (id: string, width: "full" | "half") => {
      setItemsInner((prev) =>
        prev.map((it) => (it.i === id ? { ...it, mobileWidth: width } : it)),
      );
    },
    [],
  );

  const updateItemMobileHeight = useCallback(
    (id: string, height: "full" | "half") => {
      setItemsInner((prev) =>
        prev.map((it) => (it.i === id ? { ...it, mobileHeight: height } : it)),
      );
    },
    [],
  );

  const subscribeItems = useCallback((cb: (items: DashboardItem[]) => void) => {
    itemListeners.current.add(cb);
    return () => {
      itemListeners.current.delete(cb);
    };
  }, []);

  const getItems = useCallback(() => itemsRef.current, []);

  /**
   * Replace items + layout wholesale. Used by the mission-profile loader
   * so a profile swap snaps the dashboard to a saved state in one tick.
   * Loses in-flight drag/resize state by design: callers should warn the
   * user that unsaved changes are discarded.
   */
  const replaceState = useCallback(
    (nextItems: DashboardItem[], nextLayout: Layout) => {
      if (storageKeyRef.current !== activeKeyRef.current) {
        replacedForKeyRef.current = storageKeyRef.current;
      }
      setItemsInner(nextItems);
      setLayout(nextLayout);
    },
    [],
  );

  return {
    items,
    layout,
    lastAddedId,
    clearLastAdded,
    handleLayoutChange,
    addItem,
    removeItem,
    moveItemUp,
    moveItemDown,
    updateItemConfig,
    updateItemMappings,
    updateItemMobileWidth,
    updateItemMobileHeight,
    subscribeItems,
    getItems,
    replaceState,
  };
}
