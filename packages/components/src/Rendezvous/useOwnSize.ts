import { useEffect, useRef, useState } from "react";

/**
 * The element's own laid-out size, read from the element itself each time it
 * resizes. It is 1 by 1 until it has one, which is also what a render with no
 * layout reports.
 */
export function useOwnSize<Element extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<Element>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });
  useEffect(() => {
    const el = ref.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const read = () => {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) {
        setSize({ w: el.offsetWidth, h: el.offsetHeight });
      }
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, size };
}
