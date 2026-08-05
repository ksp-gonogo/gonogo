import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Whether the viewer has asked the OS to reduce motion, tracked live.
 *
 * Most animations in the kit guard themselves with a CSS
 * `@media (prefers-reduced-motion: reduce)` block, which is enough when the
 * only thing to suppress is a transition or keyframe. This hook is for the
 * cases where the decision has to be made in JS, because it also gates a
 * behaviour a stylesheet cannot reach (whether to replay a one-shot pulse, or
 * to render a transition at all so a test can observe the difference).
 *
 * Returns `false` when `matchMedia` is unavailable (SSR, older jsdom) so the
 * default is to animate, and motion is only suppressed on an explicit opt-out.
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
