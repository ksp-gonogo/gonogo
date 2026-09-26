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
 * `Panel.Header` lets it re-expand. This is the whole hysteresis: collapsing
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
 *
 * `previousNeededWidth` is what the content needed on the last measurement.
 * The dead band guards against the ROOM moving under unchanged content; once
 * the content itself is a different width it is a new question, answered with
 * no margin. Otherwise an aside that collapsed for a badge that has since gone
 * stays collapsed, beside room it now fits in, until something resizes the
 * panel.
 */
export function nextAsideCollapsed(
  prevCollapsed: boolean,
  availableWidth: number,
  neededWidth: number,
  previousNeededWidth?: number,
): boolean {
  if (availableWidth <= 0 || neededWidth <= 0) return prevCollapsed;
  const contentChanged =
    previousNeededWidth !== undefined &&
    previousNeededWidth > 0 &&
    previousNeededWidth !== neededWidth;
  return prevCollapsed && !contentChanged
    ? !(availableWidth > neededWidth + REEXPAND_MARGIN_PX)
    : neededWidth > availableWidth;
}

/**
 * An element's natural (unconstrained) rendered width, measured off a clone
 * rather than the live element.
 *
 * Both `titleRef` and `asideRef` sit inside header boxes squeezed by the row's
 * `justify-content: space-between` and, for the aside, a further
 * `flex: 0 0 auto` `<details>` (`PanelAsideExpand`). Measuring either live is
 * not reliable at exactly the widths this hook cares about: nested
 * shrink-to-fit through that chain can resolve to a value far short of the
 * content's real size once the row runs out of room for it, which is precisely
 * the "doesn't fit" case the measurement exists to catch. And while the aside
 * is collapsed the live element is laid out as the floating box, not the row.
 *
 * The clone goes in beside the live element, under the same parent, so it
 * inherits the same font and matches the same contextual selectors (the gap
 * between aside items is one). It is taken out of flow and sized to its
 * max-content width, and `restyle` restates whatever layout the live element
 * may have left (the aside's inline row), so it reports the width the element
 * takes laid out inline with all the room it wants, whichever state the live
 * one is in.
 *
 * Inserted and removed in one synchronous call, with no `await` between them,
 * so nothing (a test's `getByText`, a `MutationObserver` callback) ever
 * observes the clone existing. Returns `0` (the "hold the previous state"
 * signal `nextAsideCollapsed` treats as unmeasured) in jsdom, which lays out
 * nothing.
 */
function measureNaturalElementWidth(
  el: HTMLElement | null,
  restyle: Partial<CSSStyleDeclaration> = {},
): number {
  const parent = el?.parentNode;
  if (!el || !parent) return 0;
  const clone = el.cloneNode(true) as HTMLElement;
  Object.assign(clone.style, {
    position: "absolute",
    visibility: "hidden",
    pointerEvents: "none",
    top: "0",
    left: "0",
    width: "max-content",
    minWidth: "0",
    maxWidth: "none",
    ...restyle,
  });
  clone.setAttribute("aria-hidden", "true");
  parent.insertBefore(clone, el.nextSibling);
  const width = clone.getBoundingClientRect().width;
  parent.removeChild(clone);
  return width;
}

/**
 * The aside's inline layout, restated on its clone: while collapsed and open,
 * the live element is a padded, bordered column floating under the summary.
 */
const ASIDE_INLINE: Partial<CSSStyleDeclaration> = {
  flexDirection: "row",
  flexWrap: "nowrap",
  padding: "0",
  border: "0",
};

/** A computed length, or 0 for one that is not a plain number (jsdom). */
function px(value: string): number {
  return Number.parseFloat(value) || 0;
}

/**
 * The measured-fit collapse `Panel.Header` runs to decide whether its aside
 * belongs inline or behind the dots + expand box. Measured rather than a fixed
 * `@container (max-width: 320px)` breakpoint on the PANEL's width, because a
 * width breakpoint is content-blind: it collapses a short-title widget with
 * plenty of room for its aside just because the panel itself is narrow, hiding
 * content behind black space.
 *
 * `rowRef` is the header row: its content width is the room available.
 * `titleRef` is the rendered `Panel.Title`, and `asideRef` the
 * `[data-panel-aside-full]` box. What the two need side by side is the title's
 * natural width, the row's gap between the boxes, the aside box's own
 * horizontal padding, and the aside's natural width; see
 * `measureNaturalElementWidth` for why the naturals come off a clone.
 *
 * Recomputes on a resize of the row or the aside, and on any change to what the
 * title or the aside hold. The content check reads a `MutationObserver`'s
 * pending records after each render instead of comparing the `title`/`aside`
 * nodes, which are new objects on every render and would re-measure, and force
 * a layout, every time the panel rendered at all. A change made without the
 * header rendering (a badge inside the aside updating itself) reaches the
 * observer's callback instead.
 */
export function useHeaderAsideFit(
  rowRef: RefObject<HTMLElement | null>,
  titleRef: RefObject<HTMLElement | null>,
  asideRef: RefObject<HTMLElement | null>,
): boolean {
  const [collapsed, setCollapsed] = useState(false);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const neededRef = useRef<number | undefined>(undefined);

  const recompute = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const rowStyle = getComputedStyle(row);
    const available =
      row.getBoundingClientRect().width -
      px(rowStyle.paddingLeft) -
      px(rowStyle.paddingRight);
    const title = measureNaturalElementWidth(titleRef.current);
    const aside = measureNaturalElementWidth(asideRef.current, ASIDE_INLINE);
    const asideBox = asideRef.current?.closest<HTMLElement>(
      "[data-panel-aside-expand]",
    )?.parentElement;
    const asideBoxStyle = asideBox ? getComputedStyle(asideBox) : null;
    const needed =
      title === 0 || aside === 0
        ? title + aside
        : title +
          px(rowStyle.columnGap) +
          px(asideBoxStyle?.paddingLeft ?? "") +
          px(asideBoxStyle?.paddingRight ?? "") +
          aside;
    const next = nextAsideCollapsed(
      collapsedRef.current,
      available,
      needed,
      neededRef.current,
    );
    if (needed > 0) neededRef.current = needed;
    if (next !== collapsedRef.current) {
      collapsedRef.current = next;
      setCollapsed(next);
    }
  }, [rowRef, titleRef, asideRef]);

  const watched = useRef<{
    title: HTMLElement | null;
    aside: HTMLElement | null;
    observer: MutationObserver | null;
  }>({ title: null, aside: null, observer: null });

  // Runs after every render, and measures only when the elements were swapped
  // or something inside them changed.
  useLayoutEffect(() => {
    const title = titleRef.current;
    const aside = asideRef.current;
    const w = watched.current;
    if (w.observer === null || w.title !== title || w.aside !== aside) {
      w.observer?.disconnect();
      w.title = title;
      w.aside = aside;
      w.observer =
        typeof MutationObserver === "undefined"
          ? null
          : new MutationObserver(() => recompute());
      for (const el of [title, aside]) {
        if (el) {
          w.observer?.observe(el, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
          });
        }
      }
      recompute();
      return;
    }
    if (w.observer.takeRecords().length > 0) recompute();
  });

  useEffect(() => {
    const w = watched.current;
    return () => {
      w.observer?.disconnect();
      w.observer = null;
    };
  }, []);

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
 * Carries `Panel.Header`'s measured-fit collapse decision down to content
 * inside `panelAside`. `Panel.Header` is the only producer; content never
 * measures independently, so it can never disagree with the chrome around it
 * about which state the aside is in.
 */
export const PanelAsideSizeProvider = PanelAsideSizeContext.Provider;

/**
 * Report the aside's CURRENT render bucket to content that must compute it
 * (rather than author full+collapsed markup and let the chrome pick).
 * Defaults to `full` outside a `Panel.Header` (no provider), the same
 * assume-there-is-room default `useElementSize` and friends use, so a widget
 * under test with no `Panel` in the tree behaves exactly as before.
 */
export function usePanelAsideSize(): PanelAsideSize {
  return useContext(PanelAsideSizeContext);
}
