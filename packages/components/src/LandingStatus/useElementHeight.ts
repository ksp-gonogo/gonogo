import { useCallback, useRef, useState } from "react";

/**
 * The height of the element a callback ref is given, kept current as it resizes. A callback ref, because the measured block mounts only once a descent streams.
 */
export function useElementHeight(): [
  (node: HTMLElement | null) => void,
  number,
] {
  const [height, setHeight] = useState(0);
  const stop = useRef<(() => void) | null>(null);
  const measure = useCallback((node: HTMLElement | null) => {
    stop.current?.();
    stop.current = null;
    if (!node) return;
    const read = () =>
      setHeight(Math.ceil(node.getBoundingClientRect().height));
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    stop.current = () => observer.disconnect();
  }, []);
  return [measure, height];
}
