import type { InputMappings } from "@gonogo/serial";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Layout, Layouts } from "react-grid-layout";
import type { DashboardConfig, DashboardItem } from "./index";

// Keep in lockstep with `BREAKPOINTS` in Dashboard/index.tsx — RGL warns
// at runtime if a key here isn't a valid breakpoint.
const COLS_KEYS = ["lg", "md", "sm", "xs", "xxs"] as const;

// Must match BREAKPOINTS in Dashboard/index.tsx. Duplicated here so the initial
// render picks the correct breakpoint before ResponsiveGridLayout has a chance
// to fire onBreakpointChange — avoids a one-frame flash of desktop layout on
// phones.
const INITIAL_BREAKPOINTS: ReadonlyArray<readonly [string, number]> = [
  ["lg", 1200],
  ["md", 996],
  ["sm", 768],
  ["xs", 480],
  ["xxs", 0],
];

function initialBreakpoint(): string {
  if (typeof window === "undefined") return "lg";
  const w = window.innerWidth;
  for (const [name, min] of INITIAL_BREAKPOINTS) {
    if (w >= min) return name;
  }
  return "xxs";
}

interface PersistedState {
  items: DashboardItem[];
  layouts: Layouts;
}

function loadState(key: string): PersistedState | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as PersistedState) : null;
  } catch {
    return null;
  }
}

function saveState(key: string, state: PersistedState): void {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // quota / private browsing — in-memory state is authoritative.
  }
}

/**
 * Owns the items + layouts state for a Dashboard instance and persists it
 * under `storageKey`. Screens (MainScreen / StationScreen) call this hook
 * and pass the result into `<Dashboard>` as props, so other consumers
 * (notably the InputDispatcher in Phase 4) can subscribe to item changes
 * without reaching into Dashboard internals.
 */
export interface DashboardState {
  items: DashboardItem[];
  layouts: Layouts;
  currentLayouts: Layouts;
  breakpoint: string;
  handleLayoutChange: (current: Layout[], all: Layouts) => void;
  handleBreakpointChange: (bp: string) => void;
  addItem: (item: DashboardItem, layout: Partial<Layout>) => void;
  removeItem: (id: string) => void;
  updateItemConfig: (id: string, config: Record<string, unknown>) => void;
  updateItemMappings: (id: string, mappings: InputMappings) => void;
  /** Subscribe to item changes — fires after every add / update. */
  subscribeItems: (cb: (items: DashboardItem[]) => void) => () => void;
  /** Always returns the latest items without going through React render. */
  getItems: () => readonly DashboardItem[];
  /** Replace items + layouts wholesale (mission-profile load). */
  replaceState: (items: DashboardItem[], layouts: Layouts) => void;
}

export function useDashboardState(
  storageKey: string | undefined,
  initial: DashboardConfig,
): DashboardState {
  const loadedRef = useRef<PersistedState | null>(
    storageKey ? loadState(storageKey) : null,
  );
  const saved = loadedRef.current;

  const [items, setItemsInner] = useState<DashboardItem[]>(
    saved?.items ?? initial.items,
  );
  const [layouts, setLayouts] = useState<Layouts>(
    saved?.layouts ?? initial.layouts,
  );
  const [currentLayouts, setCurrentLayouts] = useState<Layouts>(
    saved?.layouts ?? initial.layouts,
  );
  const [breakpoint, setBreakpoint] = useState<string>(initialBreakpoint);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const layoutsRef = useRef(layouts);
  layoutsRef.current = layouts;

  const itemListeners = useRef(new Set<(items: DashboardItem[]) => void>());
  const hasMountedRef = useRef(false);

  // Side effects (persistence + external subscribers) run from an effect, NOT
  // inside the setState updater — StrictMode double-invokes updaters to
  // detect impurity, which would duplicate writes and subscriber callbacks.
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    if (storageKey) saveState(storageKey, { items, layouts });
    itemListeners.current.forEach((cb) => {
      cb(items);
    });
  }, [items, layouts, storageKey]);

  const handleLayoutChange = useCallback((_current: Layout[], all: Layouts) => {
    setCurrentLayouts(all);
    setLayouts(all);
  }, []);

  const handleBreakpointChange = useCallback((bp: string) => {
    setBreakpoint(bp);
  }, []);

  const addItem = useCallback(
    (item: DashboardItem, layout: Partial<Layout>) => {
      setItemsInner((prev) => [...prev, item]);
      const entry: Layout = {
        i: item.i,
        x: layout.x ?? 0,
        y: layout.y ?? 9999,
        w: layout.w ?? 3,
        h: layout.h ?? 3,
        ...layout,
      };
      const nextLayouts = Object.fromEntries(
        COLS_KEYS.map((bp) => [bp, [...(currentLayouts[bp] ?? []), entry]]),
      );
      setLayouts(nextLayouts);
      setCurrentLayouts(nextLayouts);
    },
    [currentLayouts],
  );

  const removeItem = useCallback((id: string) => {
    setItemsInner((prev) => prev.filter((it) => it.i !== id));
    const stripped = (ls: Layout[] | undefined): Layout[] =>
      (ls ?? []).filter((l) => l.i !== id);
    setLayouts((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([bp, ls]) => [bp, stripped(ls)]),
      ),
    );
    setCurrentLayouts((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([bp, ls]) => [bp, stripped(ls)]),
      ),
    );
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

  const subscribeItems = useCallback((cb: (items: DashboardItem[]) => void) => {
    itemListeners.current.add(cb);
    return () => {
      itemListeners.current.delete(cb);
    };
  }, []);

  const getItems = useCallback(() => itemsRef.current, []);

  /**
   * Replace items + layouts wholesale. Used by the mission-profile loader
   * so a profile swap snaps the dashboard to a saved state in one tick.
   * Loses in-flight drag/resize state by design — callers should warn the
   * user that unsaved changes are discarded.
   */
  const replaceState = useCallback(
    (nextItems: DashboardItem[], nextLayouts: Layouts) => {
      setItemsInner(nextItems);
      setLayouts(nextLayouts);
      setCurrentLayouts(nextLayouts);
    },
    [],
  );

  return {
    items,
    layouts,
    currentLayouts,
    breakpoint,
    handleLayoutChange,
    handleBreakpointChange,
    addItem,
    removeItem,
    updateItemConfig,
    updateItemMappings,
    subscribeItems,
    getItems,
    replaceState,
  };
}
