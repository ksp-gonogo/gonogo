import { type RefObject, useEffect } from "react";

/**
 * Zooms on a trackpad pinch or ctrl/cmd + wheel only; a plain wheel belongs to
 * the page, which must still scroll under the widget. Hand-bound because only
 * a non-passive listener may call preventDefault. `onZoom` gets the delta and
 * the element-relative pointer; `null` leaves it unbound, and it must be
 * memoised.
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
