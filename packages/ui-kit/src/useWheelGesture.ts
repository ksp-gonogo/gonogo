import { type RefObject, useEffect, useRef, useState } from "react";
import {
  createWheelGesture,
  type WheelGestureOptions,
  wheelZoomFactor,
} from "./wheelGesture";

/**
 * What a diagram does with one wheel event: the zoom ratio (above 1 zooms
 * in) and the pointer position in pixels from the element's top left. Return
 * `false` when the diagram is already at its limit in that direction, so the
 * rest of the gesture scrolls the page.
 *
 * @category Layout
 */
export type WheelZoomHandler = (
  factor: number,
  x: number,
  y: number,
) => boolean | undefined;

/**
 * Zooms a diagram from the mouse wheel only when the turn of the wheel began
 * with the pointer inside it. A scroll that began on the dashboard and carries
 * the pointer over the diagram keeps scrolling the dashboard, and so does a
 * pointer left still while the dashboard scrolls the diagram under it. Ctrl or Cmd plus
 * wheel, which is how a trackpad pinch arrives, always zooms. Useful for
 * letting an operator scroll a dashboard of diagrams without the diagrams
 * grabbing the wheel. Used by {@link usePanZoom}.
 *
 * `onZoom` must be memoised; `null` leaves the wheel unbound. A listener is
 * bound by hand because only a non-passive one may call `preventDefault`.
 *
 * @intent Published so an Uplink whose zoomable surface is not a plane of SVG, such as a canvas or a third-party viewer, follows the same wheel rule as every kit diagram.
 * @category Layout
 */
export function useWheelGesture<Zoomed extends HTMLElement>(
  ref: RefObject<Zoomed | null>,
  onZoom: WheelZoomHandler | null,
  options: WheelGestureOptions = {},
): void {
  const { quietMs } = options;
  const gesture = useRef(createWheelGesture({ quietMs }));
  useEffect(() => {
    gesture.current = createWheelGesture({ quietMs });
  }, [quietMs]);

  /*
   * The element is read back after every render, so a viewport that mounts
   * later, or is replaced by another node, is bound on the render that follows
   * instead of leaving the listener on a detached node.
   */
  const [el, setEl] = useState<Zoomed | null>(null);
  useEffect(() => {
    if (ref.current !== el) setEl(ref.current);
  });

  useEffect(() => {
    if (!el || !onZoom) return;
    const inside = (target: EventTarget | null) =>
      target instanceof Node && el.contains(target);

    // Sees every wheel, scroll and pointer move on the page, so a gesture that began elsewhere is known to have.
    let last: { x: number; y: number } | null = null;
    /*
     * With no position seen yet, the first pointer event cannot be told from the
     * browser repeating a stale position after content scrolled under it, so it
     * only records where the pointer is.
     */
    const moved = (x: number, y: number) =>
      last !== null && (Math.abs(x - last.x) >= 1 || Math.abs(y - last.y) >= 1);
    const trackWheel = (e: WheelEvent) => {
      last = { x: e.clientX, y: e.clientY };
      if (e.ctrlKey || e.metaKey) return;
      gesture.current.wheel(performance.now(), inside(e.target));
    };
    // The browser repeats the last pointer position as a move when content scrolls under it; only a change of position is the operator moving.
    const trackPointer = (e: PointerEvent) => {
      const real = moved(e.clientX, e.clientY);
      last = { x: e.clientX, y: e.clientY };
      if (real && inside(e.target)) gesture.current.pointerMovedInside();
    };
    const trackScroll = (e: Event) => {
      const target = e.target;
      if (
        target === document ||
        (target instanceof Node && target.contains(el))
      ) {
        gesture.current.pageScrolled();
      }
    };

    const handler = (e: WheelEvent) => {
      const pinch = e.ctrlKey || e.metaKey;
      if (!pinch && gesture.current.owner !== "diagram") return;
      const rect = el.getBoundingClientRect();
      const factor = wheelZoomFactor(e.deltaY, e.deltaMode, pinch);
      const moved = onZoom(factor, e.clientX - rect.left, e.clientY - rect.top);
      if (moved === false && !pinch) {
        gesture.current.yieldToPage();
        return;
      }
      e.preventDefault();
    };

    window.addEventListener("wheel", trackWheel, {
      capture: true,
      passive: true,
    });
    window.addEventListener("pointermove", trackPointer, {
      capture: true,
      passive: true,
    });
    window.addEventListener("scroll", trackScroll, {
      capture: true,
      passive: true,
    });
    el.addEventListener("wheel", handler, { passive: false });
    return () => {
      window.removeEventListener("wheel", trackWheel, { capture: true });
      window.removeEventListener("pointermove", trackPointer, {
        capture: true,
      });
      window.removeEventListener("scroll", trackScroll, { capture: true });
      el.removeEventListener("wheel", handler);
    };
  }, [el, onZoom]);
}
