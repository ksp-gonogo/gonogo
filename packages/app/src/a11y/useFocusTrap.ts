import { type RefObject, useEffect } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Move focus into `containerRef` on mount and keep Tab inside it.
 *
 * Written for the two consent gates, which mount outside `ModalProvider` and so
 * get none of `Modal.tsx`'s chrome. It differs from that one in two ways that
 * both came out of the first-boot lockout: the stop list is read on each
 * keypress rather than cached, so a dialog whose controls change stays cyclable,
 * and focus sitting anywhere outside the container is pulled back in rather than
 * left to walk on into the page behind, which is what a gate opening with focus
 * still on `<body>` actually does.
 *
 * `initialFocusRef` picks the control that takes focus on open; without it the
 * first stop does, which for a consent ask should be the declining choice.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  initialFocusRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const stops = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));

    (initialFocusRef?.current ?? stops()[0] ?? container).focus();

    function handleKeyDown(e: KeyboardEvent) {
      // The narrowing above does not survive into this later-invoked closure.
      if (e.key !== "Tab" || !container) return;
      const focusable = stops();
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (!active || !container.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first)?.focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [containerRef, initialFocusRef]);
}
