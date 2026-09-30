import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Whether the viewer has asked the OS to reduce motion, tracked live. For a
 * decision a stylesheet cannot reach (whether to replay a one-shot pulse, or
 * render a transition at all); a plain transition guards itself with a CSS
 * media query.
 *
 * Returns `false` when `matchMedia` is unavailable, so motion is suppressed
 * only on an explicit opt-out.
 *
 * @category Theme
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(QUERY);
    const onChange = () => setReduced(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
