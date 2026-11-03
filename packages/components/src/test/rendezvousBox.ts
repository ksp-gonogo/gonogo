import { act } from "@ksp-gonogo/test-utils";
import {
  flushResizeObservers,
  installSizedResizeObserver,
} from "./widgetDomSnapshot";

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

/**
 * Lets everything a test's last emit scheduled land inside `act`: the size
 * observers, and the frame the stream minted for that emit, which arrives on
 * an animation frame after the test body would otherwise have returned.
 */
export async function settleRendezvous(): Promise<void> {
  await flushResizeObservers();
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  });
}

/**
 * Gives every element a width of `charWidth` pixels a character and a height of
 * one row where it has text, for the length of a test, so the figures' fit
 * against the room they have can be exercised where jsdom lays nothing out.
 * Returns what undoes it.
 */
export function installTextWidths(charWidth = 7, rowHeight = 18): () => void {
  const width = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetWidth",
  );
  const height = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return (this.textContent ?? "").length * charWidth;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return (this.textContent ?? "").length > 0 ? rowHeight : 0;
    },
  });
  return () => {
    if (width)
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", width);
    if (height)
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", height);
  };
}
