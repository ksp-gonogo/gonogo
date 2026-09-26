import { type RefObject, useEffect, useState } from "react";

/** Whether the element is wider than tall and at least 240px wide, so the diagram fits beside the readouts. */
export function useIsLandscape(ref: RefObject<HTMLElement | null>): boolean {
  const [isLandscape, setIsLandscape] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setIsLandscape(width > height && width >= 240);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return isLandscape;
}
