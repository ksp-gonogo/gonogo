import { useCallback, useRef, useState } from "react";

/** Where a rail sits inside the enclosing `Panel.Body` so that all of it is in view. */
export interface RailFrame {
  /** The sticky offset: clear of the panel's pinned header. */
  top: number;
  /** The visible height from the rail's top edge to the bottom of the body. */
  height: number;
  /** The height from the row's top edge to the bottom of the body with the body scrolled to its top: what the row has to fill, whatever has been scrolled. */
  room: number;
}

const UNMEASURED: RailFrame = { top: 0, height: 0, room: 0 };

/**
 * The part of the enclosing `Panel.Body` the rail may occupy, and the callback ref that finds it.
 *
 * The rail spans what the operator can see, which no percentage expresses from inside a content-sized flex row: from its own top edge (or the foot of the pinned header once the body has scrolled past it) to the body's bottom. A callback ref, because the measured row mounts only once a descent streams, after a mount-time effect would have run.
 */
export function useScrollerHeight(): [
  (node: HTMLElement | null) => void,
  RailFrame,
] {
  const [frame, setFrame] = useState<RailFrame>(UNMEASURED);
  const cleanup = useRef<(() => void) | null>(null);
  const measure = useCallback((node: HTMLElement | null) => {
    cleanup.current?.();
    cleanup.current = null;
    const box = node?.closest("[data-panel-body]");
    if (!(node instanceof HTMLElement) || !(box instanceof HTMLElement)) return;
    const read = () => {
      const cs = getComputedStyle(box);
      const boxRect = box.getBoundingClientRect();
      const pinned = box.querySelector<HTMLElement>("[data-panel-sticky-top]");
      const top = pinned?.offsetHeight ?? 0;
      // clientHeight is the padding box, and the rail lives in the content box.
      const bottom =
        boxRect.top +
        box.clientTop +
        box.clientHeight -
        Number.parseFloat(cs.paddingBottom || "0");
      const scrollportTop = boxRect.top + box.clientTop + top;
      const rowTop = node.getBoundingClientRect().top;
      const railTop = Math.max(rowTop, scrollportTop);
      const next = {
        top,
        height: Math.max(0, Math.round(bottom - railTop)),
        room: Math.max(0, Math.round(bottom - (rowTop + box.scrollTop))),
      };
      setFrame((prev) =>
        prev.top === next.top &&
        prev.height === next.height &&
        prev.room === next.room
          ? prev
          : next,
      );
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(box);
    // A section above the row growing moves the row without resizing the scroll box, so everything above the row is watched too.
    for (
      let el: Element | null = node;
      el && el !== box;
      el = el.parentElement
    ) {
      for (
        let sib = el.previousElementSibling;
        sib;
        sib = sib.previousElementSibling
      ) {
        ro.observe(sib);
      }
    }
    box.addEventListener("scroll", read, { passive: true });
    cleanup.current = () => {
      ro.disconnect();
      box.removeEventListener("scroll", read);
    };
  }, []);
  return [measure, frame];
}
