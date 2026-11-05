import { useCallback, useRef, useState } from "react";

/**
 * The element's own laid-out size, read from the element itself each time it
 * resizes. It is 1 by 1 until it has one, which is also what a render with no
 * layout reports. The element is measured whenever it mounts, so one that
 * renders after the first paint is read too, and the first read happens
 * before the browser paints so a choice made from the size never shows once
 * in the wrong form.
 */
export function useOwnSize<Element extends HTMLElement = HTMLDivElement>() {
  const [size, setSize] = useState({ w: 1, h: 1 });
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: Element | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const read = () => {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) {
        setSize({ w: el.offsetWidth, h: el.offsetHeight });
      }
    };
    read();
    observer.current = new ResizeObserver(read);
    observer.current.observe(el);
  }, []);
  return { ref, size };
}
