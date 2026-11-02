import { installSizedResizeObserver } from "./widgetDomSnapshot";

/** The measured box of the default 6x9 Rendezvous tile, so its circles have room to draw. */
export const RENDEZVOUS_BOX = { w: 926, h: 772 } as const;

/**
 * Gives the Rendezvous view a measured box and asks for reduced motion, for
 * the length of a test: the turret then jumps straight to the wanted level
 * instead of animating over a second, so a level change lands at once.
 * Returns what undoes both.
 */
export function installRendezvousBox(
  box: { w: number; h: number } = RENDEZVOUS_BOX,
): () => void {
  const restoreObserver = installSizedResizeObserver(box);
  const before = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  return () => {
    restoreObserver();
    window.matchMedia = before;
  };
}
