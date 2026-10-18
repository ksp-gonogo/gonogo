import { useEffect, useState } from "react";

/**
 * Below this window width the dashboard is a single-column list: a 36-column
 * grid there leaves columns too narrow to drag or read.
 */
export const LIST_DASHBOARD_BELOW_PX = 700;

/**
 * Touch devices get the list too, whatever their width, since the grid's drag
 * handles need a fine pointer.
 */
const QUERY = `(pointer: coarse), (width < ${LIST_DASHBOARD_BELOW_PX}px)`;

/**
 * True when the dashboard shows as the single-column list (the mobile view)
 * rather than the grid: on a touch device, or in a window narrower than
 * {@link LIST_DASHBOARD_BELOW_PX}. Follows the window as it is resized.
 */
export function useListDashboard(): boolean {
  const [isList, setIsList] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(QUERY);
    setIsList(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsList(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return isList;
}
