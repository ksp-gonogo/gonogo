import type { InputMappings } from "@ksp-gonogo/serial";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Layout, LayoutItem } from "react-grid-layout";
import type { DashboardConfig, DashboardItem } from "./index";
import { COLS, firstFreeSlot } from "./layoutNormalization";

/**
 * Owns the items + layout state for a Dashboard instance. Screens (MainScreen
 * / StationScreen) call this hook and pass the result into `<Dashboard>` as
 * props, so other consumers (notably the InputDispatcher) can subscribe to
 * item changes without reaching into Dashboard internals. Saving is the
 * caller's: `onChange` fires after every change to the items or the layout.
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
  /** Adds several widgets in one change, so Undo takes them all back together. */
  addItems: (
    entries: readonly { item: DashboardItem; placement: Partial<LayoutItem> }[],
  ) => void;
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
  /** Replace items + layout wholesale (switching to another profile). */
  replaceState: (items: DashboardItem[], layout: Layout) => void;
}

export interface DashboardStateOptions {
  /** Called after every change to the items or the layout, never on mount. */
  onChange?: (items: DashboardItem[], layout: Layout) => void;
}

export function useDashboardState(
  initial: DashboardConfig,
  options: DashboardStateOptions = {},
): DashboardState {
  const [items, setItemsInner] = useState<DashboardItem[]>(initial.items);
  const [layout, setLayout] = useState<Layout>(initial.layout);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);

  const itemsRef = useRef(items);
  itemsRef.current = items;

  const onChangeRef = useRef(options.onChange);
  onChangeRef.current = options.onChange;

  const itemListeners = useRef(new Set<(items: DashboardItem[]) => void>());
  const hasMountedRef = useRef(false);

  /*
   * Side effects (saving + external subscribers) run from an effect, NOT
   * inside the setState updater: StrictMode double-invokes updaters to
   * detect impurity, which would duplicate writes and subscriber callbacks.
   */
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    onChangeRef.current?.(items, layout);
    itemListeners.current.forEach((cb) => {
      cb(items);
    });
  }, [items, layout]);

  const handleLayoutChange = useCallback((next: Layout) => {
    setLayout(next);
  }, []);

  const addItems = useCallback(
    (
      entries: readonly {
        item: DashboardItem;
        placement: Partial<LayoutItem>;
      }[],
    ) => {
      if (entries.length === 0) return;
      setItemsInner((prev) => [...prev, ...entries.map((e) => e.item)]);
      let next = layout;
      for (const { item, placement } of entries) {
        // Without a caller-supplied x/y the widget takes the first free slot wide enough for it.
        const w = placement.w ?? 3;
        const h = placement.h ?? 3;
        const placed: LayoutItem =
          placement.x !== undefined || placement.y !== undefined
            ? { i: item.i, x: 0, y: 9999, w, h, ...placement }
            : {
                ...placement,
                i: item.i,
                ...firstFreeSlot(next, { w, h }, COLS),
              };
        next = [...next, placed];
      }
      setLayout(next);
      setLastAddedId(entries[entries.length - 1].item.i);
    },
    [layout],
  );

  const addItem = useCallback(
    (item: DashboardItem, placement: Partial<LayoutItem>) =>
      addItems([{ item, placement }]),
    [addItems],
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
   * Replace items + layout wholesale. Used when switching to another profile
   * so the dashboard snaps to a saved state in one tick. Loses in-flight
   * drag/resize state by design.
   */
  const replaceState = useCallback(
    (nextItems: DashboardItem[], nextLayout: Layout) => {
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
    addItems,
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
