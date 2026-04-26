import { useEffect, useState } from "react";

const QUERY = "(pointer: coarse)";

/**
 * True when the primary input is touch / stylus (phones, tablets, kiosk
 * displays). Drives interaction affordances that don't translate to touch
 * — most importantly the dashboard's drag-and-drop layout, which is
 * replaced by a list-with-arrows view on coarse-pointer devices.
 *
 * Width is deliberately NOT checked: a desktop user with a half-width
 * window still has a mouse and should keep the desktop affordances.
 */
export function useTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(QUERY);
    const handler = (e: MediaQueryListEvent) => setIsTouch(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return isTouch;
}
