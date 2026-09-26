import { useCallback, useRef, useState } from "react";

/**
 * The visible content height of the enclosing `Panel.Body`, and the callback ref that finds it.
 *
 * The rail spans the scroller's box, which no percentage expresses from inside a content-sized flex row. A callback ref, because the measured row mounts only once a descent streams, after a mount-time effect would have run.
 */
export function useScrollerHeight(): [
  (node: HTMLElement | null) => void,
  number,
] {
  const [height, setHeight] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const measure = useCallback((node: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    const box = node?.closest("[data-panel-body]");
    if (!(box instanceof HTMLElement)) return;
    // clientHeight is the padding box, and the rail lives in the content box.
    const contentHeight = () => {
      const cs = getComputedStyle(box);
      return (
        box.clientHeight -
        Number.parseFloat(cs.paddingTop || "0") -
        Number.parseFloat(cs.paddingBottom || "0")
      );
    };
    setHeight(contentHeight());
    const ro = new ResizeObserver(() => setHeight(contentHeight()));
    ro.observe(box);
    observer.current = ro;
  }, []);
  return [measure, height];
}
