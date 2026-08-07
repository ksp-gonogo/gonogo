import { createContext, type RefObject, useContext } from "react";

/**
 * A ref to the element the delay rail publishes `--panel-rail-height` onto: the
 * panel's own container, an ancestor of the rail (first child of the body
 * scroller) and of the sticky header that rests below the rail. `Panel` provides
 * its container ref here; the rail reads `ref.current` in its ResizeObserver
 * effect and sets the var there.
 *
 * A ref, NOT the element via state: capturing the container element into state
 * would re-render every Panel once on mount (ref-callback -> setState), a cost
 * paid by every panel on the dashboard for a value only the rail's effect ever
 * reads. A stable ref carries the element with no re-render: the rail's passive
 * effect runs after commit, by which point every ref in the tree is attached,
 * so `ref.current` is populated when the rail needs it. A DOM query
 * (`rail.closest('[data-panel-container]')`) is the other alternative, rejected
 * so no `data-panel-*` attr sprouts on every panel container (which would move
 * every widget's DOM snapshot).
 *
 * `null` outside a `Panel` (a bare rail in a test with no provider), where the
 * rail simply skips publishing.
 */
export const PanelRailTargetContext =
  createContext<RefObject<HTMLDivElement> | null>(null);

/** The ref to the element the delay rail publishes its measured height onto, or
 * `null` with no `Panel`. Read `.current` in an effect (populated post-commit),
 * never during render. Typed to the container's element (`PanelContainer` is a
 * `div`); the rail only needs its `.style`. */
export function usePanelRailTarget(): RefObject<HTMLDivElement> | null {
  return useContext(PanelRailTargetContext);
}
