import { type RefObject, useEffect, useRef, useState } from "react";

/**
 * Pixel dimensions of an observed element, rounded down to whole pixels.
 *
 * @category Layout
 */
export interface ElementSize {
  w: number;
  h: number;
}

/**
 * Observe an element's content box and track its `{ w, h }` size.
 *
 * Attach `ref` to the element to measure. Zero-size measurements are ignored
 * and the result is rounded down to whole pixels. The element may come and go,
 * or be swapped for another: whichever one `ref` holds after a render is the
 * one observed. Where there is no `ResizeObserver` (jsdom) the size stays at
 * `initial`.
 *
 * @param initial - Seed size used until the first non-zero measurement
 * @returns `{ ref, size }`: attach `ref` to the element to measure
 *
 * @example
 * ```tsx
 * const { ref, size } = useElementSize({ w: 200, h: 120 });
 * return <div ref={ref}>{size.w > 300 ? <Wide /> : <Narrow />}</div>;
 * ```
 *
 * @category Layout
 */
export function useElementSize<
  MeasuredElement extends HTMLElement = HTMLDivElement,
>(
  initial: ElementSize,
): { ref: RefObject<MeasuredElement>; size: ElementSize } {
  const ref = useRef<MeasuredElement>(null);
  const [size, setSize] = useState<ElementSize>(initial);
  const [observed, setObserved] = useState<MeasuredElement | null>(null);

  // After every render, so an element that mounts late or is replaced is picked up; only a different element re-renders.
  useEffect(() => {
    if (ref.current !== observed) setObserved(ref.current);
  });

  useEffect(() => {
    if (!observed || typeof ResizeObserver === "undefined") return;
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
    ro.observe(observed);
    return () => ro.disconnect();
  }, [observed]);

  return { ref, size };
}
