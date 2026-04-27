import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * State shared across a cluster of floating action buttons — one primary,
 * several secondaries. Secondaries stay hidden until the cluster is
 * "active"; a short close delay keeps the cluster open while the cursor
 * travels between buttons.
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

/**
 * Delay before collapsing secondary FABs after the cursor leaves. The
 * tower can be ~480px tall with 20px gaps between buttons, so the delay
 * has to tolerate a deliberate cursor traversal between non-adjacent
 * FABs without snapping shut mid-move.
 */
const LEAVE_DELAY_MS = 400;

export function FabClusterProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const [active, setActive] = useState(false);
  const timerRef = useRef<number | null>(null);

  const clearPendingClose = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const open = useCallback(() => {
    clearPendingClose();
    setActive(true);
  }, [clearPendingClose]);

  const scheduleClose = useCallback(() => {
    clearPendingClose();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setActive(false);
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

/**
 * Read the cluster state. Returns `null` when no provider is mounted so
 * FABs can degrade to always-visible when rendered standalone.
 */
export function useFabCluster(): FabClusterValue | null {
  return useContext(FabClusterContext);
}
