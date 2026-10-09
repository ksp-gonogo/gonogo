import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/**
 * State shared across a cluster of floating action buttons, one primary,
 * several secondaries. Secondaries stay hidden until the cluster is
 * "active"; a short close delay keeps the cluster open while the cursor
 * travels between buttons. On a coarse primary pointer there is no hover to
 * reveal them and a tap on the primary opens its own dialog, so the cluster
 * stays open and every name is readable.
 */
interface FabClusterValue {
  /** True when any FAB in the cluster is hovered or focused. */
  active: boolean;
  /** Attach to every FAB so hovering any of them keeps the cluster open. */
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
}

const FabClusterContext = createContext<FabClusterValue | null>(null);

/** Long enough for a deliberate cursor move between non-adjacent FABs in a tall cluster. */
const LEAVE_DELAY_MS = 400;

const COARSE_POINTER = "(pointer: coarse)";

function subscribeCoarse(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(COARSE_POINTER);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function readCoarse() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia(COARSE_POINTER).matches
  );
}

export function FabClusterProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const [hovered, setHovered] = useState(false);
  const coarse = useSyncExternalStore(subscribeCoarse, readCoarse, () => false);
  const active = hovered || coarse;
  const timerRef = useRef<number | null>(null);

  const clearPendingClose = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const open = useCallback(() => {
    clearPendingClose();
    setHovered(true);
  }, [clearPendingClose]);

  const scheduleClose = useCallback(() => {
    clearPendingClose();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setHovered(false);
    }, LEAVE_DELAY_MS);
  }, [clearPendingClose]);

  useEffect(() => () => clearPendingClose(), [clearPendingClose]);

  const value = useMemo<FabClusterValue>(
    () => ({
      active,
      onMouseEnter: open,
      onMouseLeave: scheduleClose,
      onFocus: open,
      onBlur: scheduleClose,
    }),
    [active, open, scheduleClose],
  );

  return (
    <FabClusterContext.Provider value={value}>
      {children}
    </FabClusterContext.Provider>
  );
}

/** Null without a provider, so a standalone FAB stays visible. */
export function useFabCluster(): FabClusterValue | null {
  return useContext(FabClusterContext);
}
