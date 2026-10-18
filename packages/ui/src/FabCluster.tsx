import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/**
 * State shared across a cluster of floating action buttons, one toggle and
 * several secondaries. Secondaries stay hidden until the cluster is
 * "active": hovered or focused (a short close delay keeps it open while the
 * cursor travels between buttons), or held open by the toggle until it is
 * pressed again, Escape is pressed or a pointer lands outside the cluster. On
 * a coarse primary pointer there is no hover to reveal them, so the cluster
 * stays open and every name is readable.
 */
interface FabClusterValue {
  /** True when any FAB in the cluster is hovered or focused, or the toggle holds it open. */
  active: boolean;
  /** True while the toggle holds the cluster open. */
  expanded: boolean;
  /** Opens the cluster until it is toggled again or dismissed. */
  toggle: () => void;
  /** Id of the element that holds the cluster's buttons, for `aria-controls`. */
  regionId: string;
  /** Attach to the toggle so Escape can return focus to it. */
  toggleRef: RefObject<HTMLButtonElement>;
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
  const [expanded, setExpanded] = useState(false);
  const active = hovered || expanded || coarse;
  const regionId = useId();
  const regionRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
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

  const toggle = useCallback(() => {
    clearPendingClose();
    setExpanded((e) => !e);
  }, [clearPendingClose]);

  useEffect(() => () => clearPendingClose(), [clearPendingClose]);

  useEffect(() => {
    if (!expanded && !hovered) return;
    const dismiss = () => {
      clearPendingClose();
      setExpanded(false);
      setHovered(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      dismiss();
      toggleRef.current?.focus();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!regionRef.current?.contains(e.target as Node)) dismiss();
    };
    // Capture phase: a tooltip open on a focused button stops Escape there, and the cluster must close on the same press.
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [expanded, hovered, clearPendingClose]);

  const value = useMemo<FabClusterValue>(
    () => ({
      active,
      expanded,
      toggle,
      regionId,
      toggleRef,
      onMouseEnter: open,
      onMouseLeave: scheduleClose,
      onFocus: open,
      onBlur: scheduleClose,
    }),
    [active, expanded, toggle, regionId, open, scheduleClose],
  );

  return (
    <FabClusterContext.Provider value={value}>
      <div id={regionId} ref={regionRef}>
        {children}
      </div>
    </FabClusterContext.Provider>
  );
}

/** Null without a provider, so a standalone FAB stays visible. */
export function useFabCluster(): FabClusterValue | null {
  return useContext(FabClusterContext);
}
