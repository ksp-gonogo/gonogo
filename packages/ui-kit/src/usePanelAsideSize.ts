import {
  createContext,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/**
 * The render bucket an aside is in. `full` (inline beside the title) and
 * `collapsed` (behind the dots + expand box) are the two states the header's
 * measured-fit collapse drives. `tiny` is the reserved forward slot for a
 * content-defined intermediate mode (an aside that stays inline but renders a
 * compacted variant); nothing emits it yet, so content authored to handle it
 * degrades cleanly today and is ready when a progressive breakpoint lands.
 */
export type PanelAsideSize = "full" | "tiny" | "collapsed";

/**
 * How much spare room the full aside needs, once collapsed, before
 * `PanelHeader` lets it re-expand. This is the whole hysteresis: collapsing
 * reacts the instant content stops fitting (no dead band, so a tile that is
 * genuinely too narrow never clips), but re-expanding only fires once there is
 * real room to spare. Without the margin, a panel sitting exactly at the fit
 * boundary flips every measurement: expand (now it fits) -> the wider aside
 * no longer fits -> collapse -> repeat. A fixed `@container` breakpoint avoids
 * that shimmer by never measuring; a measured fit has to guard against it
 * explicitly, which is what this constant is.
 */
const REEXPAND_MARGIN_PX = 24;

/**
 * Pure hysteresis decision, unit-testable with no DOM: given the row's
 * available width and how much width the title + aside actually need side by
 * side, decide whether the aside should be collapsed. `prevCollapsed` is the
 * current state; the two directions have different thresholds (see
 * `REEXPAND_MARGIN_PX`).
 *
 * A `0` (unmeasured) needed or available width holds the previous state
 * rather than deciding anything: it means no real measurement has landed yet
 * (jsdom, first paint before layout, or a `ResizeObserver` that has not fired
 * once), and `full` is the safe default every existing widget test already
 * renders.
 */
export function nextAsideCollapsed(
  prevCollapsed: boolean,
  availableWidth: number,
  neededWidth: number,
): boolean {
  if (availableWidth <= 0 || neededWidth <= 0) return prevCollapsed;
  return prevCollapsed
    ? !(availableWidth > neededWidth + REEXPAND_MARGIN_PX)
    : neededWidth > availableWidth;
}

/**
 * An element's natural (unconstrained) rendered width, measured off an
 * ISOLATED clone rather than the live in-DOM element.
 *
 * Both `titleRef` and `asideRef` sit inside header boxes squeezed by the
 * row's `justify-content: space-between` and, for the aside, a further
 * `flex: 0 0 auto` `<details>` (`PanelAsideExpand`). Measuring either live is
 * not reliable at exactly the widths this hook cares about: confirmed in real
 * Chromium, nested shrink-to-fit through that chain can resolve to a value
 * far short of the content's real size once the row runs out of room for it,
 * which is precisely the "doesn't fit" case the measurement exists to catch.
 * `display: none` would be the obvious next guess, but the same live element
 * cannot be both currently visible (the wide/inline case, where the
 * measurement also has to work) and off-flow for measurement at once.
 *
 * `cloneNode` sidesteps the whole chain: pulled onto `position: fixed` with
 * no `left`/`top`/`right`/`bottom` set, a clone sizes against the INITIAL
 * containing block (the viewport) rather than any ancestor's shrink-to-fit
 * result, so it always reports the same natural width the live element would
 * show if it had all the room it wanted. The clone keeps its styled-
 * components class(es), which resolve against the SAME global stylesheet
 * regardless of where in the document the clone sits, so its measured font,
 * padding and letter-spacing match the live element exactly rather than an
 * approximation of them.
 *
 * Appended and removed in one synchronous call, with no `await` between them,
 * so nothing (a test's `getByText`, a `MutationObserver`) ever observes the
 * clone existing. Returns `0` (the same "hold the previous state" signal
 * `nextAsideCollapsed` treats as unmeasured) in jsdom, which lays out
 * nothing and reports `0` for every `getBoundingClientRect()` call: exactly
 * why every existing widget test keeps seeing the wide default.
 */
function measureNaturalElementWidth(el: HTMLElement | null): number {
  if (!el || typeof document === "undefined") return 0;
  const clone = el.cloneNode(true) as HTMLElement;
  clone.style.position = "fixed";
  clone.style.visibility = "hidden";
  clone.style.pointerEvents = "none";
  clone.style.left = "-99999px";
  clone.style.top = "-99999px";
  document.body.appendChild(clone);
  const width = clone.getBoundingClientRect().width;
  document.body.removeChild(clone);
  return width;
}

/**
 * The measured-fit collapse `PanelHeader` runs to decide whether its aside
 * belongs inline or behind the dots + expand box. Measured rather than a fixed
 * `@container (max-width: 320px)` breakpoint on the PANEL's width, because a
 * width breakpoint is content-blind: it collapses a short-title widget with
 * plenty of room for its aside just because the panel itself is narrow, hiding
 * content behind black space.
 *
 * `rowRef` is the header row, whose measured width is the room available to
 * title + aside together. `titleRef` (the rendered `PanelTitle`) and
 * `asideRef` (the `[data-panel-aside-full]` box) are both measured via
 * `measureNaturalElementWidth` (see its own doc comment for why a live
 * measurement is not reliable here).
 *
 * Recomputes on: a resize of the row or the aside (`ResizeObserver`, a no-op
 * where unavailable, matching `useElementSize`), and a content change to
 * `title`/`aside` (`useLayoutEffect`, so a title-text change is picked up even
 * when it does not happen to change the aside's own box size).
 */
export function useHeaderAsideFit(
  rowRef: RefObject<HTMLElement | null>,
  titleRef: RefObject<HTMLElement | null>,
  asideRef: RefObject<HTMLElement | null>,
  title: unknown,
  aside: unknown,
): boolean {
  const [collapsed, setCollapsed] = useState(false);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;

  const recompute = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const available = row.getBoundingClientRect().width;
    const needed =
      measureNaturalElementWidth(titleRef.current) +
      measureNaturalElementWidth(asideRef.current);
    const next = nextAsideCollapsed(collapsedRef.current, available, needed);
    if (next !== collapsedRef.current) {
      collapsedRef.current = next;
      setCollapsed(next);
    }
  }, [rowRef, titleRef, asideRef]);

  // Content changes (a title string that changed, an aside whose contents
  // changed identity) recompute even when they do not happen to trigger a
  // ResizeObserver callback on their own.
  // biome-ignore lint/correctness/useExhaustiveDependencies: title/aside are intentional recompute triggers, not values read directly in the body.
  useLayoutEffect(() => {
    recompute();
  }, [recompute, title, aside]);

  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => recompute());
    ro.observe(row);
    if (asideRef.current) ro.observe(asideRef.current);
    return () => ro.disconnect();
  }, [rowRef, asideRef, recompute]);

  return collapsed;
}

const PanelAsideSizeContext = createContext<PanelAsideSize>("full");

/**
 * Carries `PanelHeader`'s measured-fit collapse decision down to content
 * inside `panelAside`. `PanelHeader` is the only producer; content never
 * measures independently, so it can never disagree with the chrome around it
 * about which state the aside is in.
 */
export const PanelAsideSizeProvider = PanelAsideSizeContext.Provider;

/**
 * Report the aside's CURRENT render bucket to content that must compute it
 * (rather than author full+collapsed markup and let the chrome pick).
 * Defaults to `full` outside a `PanelHeader` (no provider), the same
 * assume-there-is-room default `useElementSize` and friends use, so a widget
 * under test with no `Panel` in the tree behaves exactly as before.
 */
export function usePanelAsideSize(): PanelAsideSize {
  return useContext(PanelAsideSizeContext);
}
