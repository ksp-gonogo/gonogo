import { type RefObject, useEffect } from "react";

/**
 * Binds the wheel half of a pan/zoom surface, on the pinch gesture only.
 *
 * A plain wheel belongs to the PAGE. Every one of these surfaces is a widget
 * on a dashboard that is routinely taller than the viewport, and a handler
 * that swallowed every wheel event left the operator unable to scroll that
 * dashboard at all while the pointer sat over the widget: a trackpad
 * two-finger scroll is a stream of `wheel` events, so the page simply did not
 * move. Zoom takes the pinch gesture instead, which a trackpad delivers as a
 * wheel with `ctrlKey` set, so pinch-to-zoom is unchanged and a mouse gets
 * ctrl/cmd + wheel as the equivalent. Touch pinch goes through pointer events
 * and never reaches here.
 *
 * The listener is hand-bound rather than a React `onWheel` because only a
 * `{ passive: false }` listener may call preventDefault, and it is bound once
 * here rather than at each surface: the two call sites had copied the same
 * handler, and a third copy is how the trap would come back.
 *
 * `onZoom` receives the wheel delta and the pointer position relative to the
 * element's top-left corner. Pass `null` to leave the surface unbound (a
 * canvas that has not been measured yet has nothing to zoom about); memoise
 * it, or the listener rebinds on every render.
 */
export function useWheelZoom<E extends HTMLElement>(
  ref: RefObject<E | null>,
  onZoom: ((deltaY: number, x: number, y: number) => void) | null,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !onZoom) return;

    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      onZoom(e.deltaY, e.clientX - rect.left, e.clientY - rect.top);
    };

    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [ref, onZoom]);
}
