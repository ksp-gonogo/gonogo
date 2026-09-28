import { useEffect, useRef, useState } from "react";

/**
 * Observe the registered scroller and derive a value from it, recomputed on
 * scroll and on any size or child-list change to the scroller. Drivable in
 * jsdom by dispatching a `scroll` event.
 */
export function useScrollerMetric<Metric>(
  el: HTMLElement | null,
  compute: (el: HTMLElement) => Metric,
  isEqual: (a: Metric, b: Metric) => boolean,
  initial: Metric,
): Metric {
  const [value, setValue] = useState<Metric>(initial);
  // Latest closures without re-subscribing: the effect keys off `el` alone.
  const computeRef = useRef(compute);
  computeRef.current = compute;
  const equalRef = useRef(isEqual);
  equalRef.current = isEqual;

  useEffect(() => {
    if (!el) return;
    const update = () => {
      const next = computeRef.current(el);
      setValue((prev) => (equalRef.current(prev, next) ? prev : next));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    const mo = new MutationObserver(() => {
      for (const child of Array.from(el.children)) ro.observe(child);
      update();
    });
    mo.observe(el, { childList: true });
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
      mo.disconnect();
    };
  }, [el]);

  return value;
}

/** Whether a scroller's content runs past its box on either axis. */
export function overflowsBox(el: HTMLElement): boolean {
  return el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth;
}

/**
 * The `tabIndex` a scroll body takes: 0 while its content overflows, so it can
 * be scrolled from the keyboard in WebKit, which never focuses a scroller on
 * its own; none while everything fits, so a body with nothing to scroll adds
 * no tab stop.
 */
export function useKeyboardScrollable(el: HTMLElement | null): 0 | undefined {
  const overflows = useScrollerMetric(el, overflowsBox, Object.is, false);
  return overflows ? 0 : undefined;
}
