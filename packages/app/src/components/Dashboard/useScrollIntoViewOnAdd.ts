import { useEffect } from "react";

/**
 * After a new widget is added, scroll its cell into view inside the grid
 * container. Runs once per `lastAddedId` change. The pulse animation lives
 * in CSS on cells with `data-highlight="true"`; we just have to make sure
 * the user can see the new widget before the pulse fades.
 */
export function useScrollIntoViewOnAdd(
  gridRef: React.RefObject<HTMLDivElement | null>,
  lastAddedId: string | null | undefined,
  clearLastAdded: ((id: string) => void) | undefined,
) {
  useEffect(() => {
    if (!lastAddedId) return;
    const root = gridRef.current;
    if (!root) return;
    // RGL positions the cell asynchronously after layout reconciliation;
    // wait one frame so scrollIntoView targets its final coordinates.
    const raf = requestAnimationFrame(() => {
      const cell = root.querySelector<HTMLElement>(
        `[data-i="${cssEscape(lastAddedId)}"]`,
      );
      if (!cell) return;
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      cell.scrollIntoView({
        block: "center",
        behavior: reduced ? "auto" : "smooth",
      });
    });
    // Safety net: animation duration + a margin. The cell normally clears
    // its own highlight via onAnimationEnd, but reduced-motion users skip the
    // animation entirely so the listener never fires. Clear from here too.
    const fallback = window.setTimeout(() => {
      clearLastAdded?.(lastAddedId);
    }, 2000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(fallback);
    };
  }, [gridRef, lastAddedId, clearLastAdded]);
}

function cssEscape(value: string): string {
  // CSS.escape isn't on every test environment's window; UUIDs are safe but
  // we still wrap so future non-UUID ids don't break the selector.
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}
