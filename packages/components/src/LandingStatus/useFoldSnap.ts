import { type RefObject, useLayoutEffect, useRef } from "react";

/** How far up from a scroller's bottom edge its overflow glow dims what is drawn under it. */
const GLOW_BAND_PX = 24;

/** The boxes a stack lays out, looking through wrappers that draw no box of their own, each of which is added to `wrappers` when given. */
function boxesOf(parent: Element, wrappers?: Element[]): HTMLElement[] {
  return Array.from(parent.children).flatMap((child) => {
    if (getComputedStyle(child).display !== "contents") {
      return [child as HTMLElement];
    }
    wrappers?.push(child);
    return boxesOf(child, wrappers);
  });
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
  const watch = useRef<Watch | null>(null);

  /*
   * Runs after every commit but only compares elements: the stack is re-measured when something it
   * lays out changes size, which the observers report, rather than on every render, since measuring
   * straight after a render forces the browser to lay the whole window out again.
   */
  useLayoutEffect(() => {
    const root = wrapper.current?.firstElementChild ?? null;
    const content = window.current;
    const box = content?.parentElement ?? null;
    const current = watch.current;
    if (
      current?.root === root &&
      current.content === content &&
      current.box === box &&
      current.enabled === enabled
    ) {
      return;
    }
    current?.stop();
    watch.current =
      root && content && box ? startWatch(root, content, box, enabled) : null;
  });

  useLayoutEffect(
    () => () => {
      watch.current?.stop();
      watch.current = null;
    },
    [],
  );
}

interface Watch {
  root: Element;
  content: Element;
  box: Element;
  enabled: boolean;
  stop: () => void;
}

/**
 * Settles the stack in `root` against the fold of the scroller `box` whenever the scroller, the
 * content it scrolls, the stack, or any box in the stack changes size, and whenever a box is added
 * or removed.
 */
function startWatch(
  root: Element,
  content: Element,
  box: Element,
  enabled: boolean,
): Watch {
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
  if (!enabled) return { root, content, box, enabled, stop: () => {} };

  const resized = new ResizeObserver(settle);
  /* A box newly observed is reported at once, which is what settles the stack after a box is added. */
  const changed = new MutationObserver(() => observeAll());
  const observeAll = () => {
    resized.disconnect();
    changed.disconnect();
    resized.observe(box);
    resized.observe(content);
    resized.observe(root);
    const wrappers: Element[] = [root];
    for (const el of boxesOf(root, wrappers)) resized.observe(el);
    for (const el of wrappers) changed.observe(el, { childList: true });
  };
  observeAll();
  return {
    root,
    content,
    box,
    enabled,
    stop: () => {
      resized.disconnect();
      changed.disconnect();
      if (pushed) pushed.style.marginTop = "";
    },
  };
}
