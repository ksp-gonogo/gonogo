import { type RefObject, useLayoutEffect } from "react";

/** How far up from a scroller's bottom edge its overflow glow dims what is drawn under it. */
const GLOW_BAND_PX = 24;

/** The boxes a stack lays out, looking through wrappers that draw no box of their own. */
function boxesOf(parent: Element): HTMLElement[] {
  return Array.from(parent.children).flatMap((child) =>
    getComputedStyle(child).display === "contents"
      ? boxesOf(child)
      : [child as HTMLElement],
  );
}

/**
 * Keeps the overflow glow of the scroller around `window` off every readout in
 * the stack `wrapper` holds at rest: the first box the glow would reach is moved down to the scroller's
 * fold, so the glow sits over empty space and what lies past the fold reads as
 * a continuation. `wrapper` is a plain element around the stack's own element and `window` the element inside the scroller. A stack that fits, or whose boxes all start past the fold, is
 * left alone. The offset is a margin set on that one box and cleared each pass.
 */
export function useFoldSnap(
  wrapper: RefObject<HTMLElement>,
  window: RefObject<HTMLElement>,
  enabled: boolean,
): void {
  // Every render: a header, plot or readout changing height moves the fold's position in the stack without resizing the stack.
  useLayoutEffect(() => {
    const root = wrapper.current?.firstElementChild;
    const box = window.current?.parentElement;
    if (!root || !box) return;
    let pushed: HTMLElement | undefined;
    const settle = () => {
      if (pushed) pushed.style.marginTop = "";
      pushed = undefined;
      if (!enabled) return;
      const fold = box.clientHeight;
      if (fold === 0 || box.scrollHeight <= fold) return;
      const origin = box.getBoundingClientRect().top - box.scrollTop;
      for (const el of boxesOf(root)) {
        const { top, height } = el.getBoundingClientRect();
        if (height === 0) continue;
        if (top - origin + height <= fold - GLOW_BAND_PX) continue;
        if (top - origin < fold) {
          el.style.marginTop = `${fold - (top - origin)}px`;
          pushed = el;
        }
        return;
      }
    };
    settle();
    const observer = new ResizeObserver(settle);
    observer.observe(box);
    observer.observe(root);
    for (const el of boxesOf(root)) observer.observe(el);
    return () => {
      observer.disconnect();
      if (pushed) pushed.style.marginTop = "";
    };
  });
}
