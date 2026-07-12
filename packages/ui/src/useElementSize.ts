import { type RefObject, useEffect, useRef, useState } from "react";

/** Pixel dimensions of an observed element, `Math.floor`-rounded. */
export interface ElementSize {
  w: number;
  h: number;
}

/**
 * Observe an element's content-box and track its `{ w, h }` size.
 *
 * Extracted from the hand-rolled `ResizeObserver` blocks that several
 * widgets repeated verbatim: attach a `ResizeObserver` to a `ref`, ignore
 * zero-size measurements, `Math.floor` the result, and disconnect on
 * unmount. The `typeof ResizeObserver === "undefined"` guard keeps the hook
 * a no-op in jsdom (tests render at the `initial` size, exactly as the
 * inline versions did).
 *
 * @param initial seed size used until the first non-zero measurement.
 * @returns `{ ref, size }` — attach `ref` to the element to measure.
 */
export function useElementSize<T extends HTMLElement = HTMLDivElement>(
  initial: ElementSize,
): { ref: RefObject<T>; size: ElementSize } {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<ElementSize>(initial);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        if (e.contentRect.width > 0 && e.contentRect.height > 0) {
          setSize({
            w: Math.floor(e.contentRect.width),
            h: Math.floor(e.contentRect.height),
          });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, size };
}
