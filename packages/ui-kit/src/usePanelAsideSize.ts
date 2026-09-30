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
 * How a panel header's aside is currently drawn: `full`, inline beside the
 * title, or `collapsed`, behind the status dots and the toggle that opens it.
 *
 * @category Panel
 */
export type PanelAsideSize = "full" | "collapsed";

/**
 * How much spare room the full aside needs, once collapsed, before it
 * re-expands. Collapsing reacts the instant content stops fitting; without this
 * margin a panel sitting exactly at the boundary flips on every measurement.
 */
const REEXPAND_MARGIN_PX = 24;

/**
 * Whether the aside should be collapsed, given the row's available width and
 * the width the title and aside need side by side. The two directions have
 * different thresholds (see `REEXPAND_MARGIN_PX`).
 *
 * A `0` (unmeasured) width holds the previous state rather than deciding
 * anything.
 *
 * `previousNeededWidth` is what the content needed on the last measurement. The
 * dead band guards against the room moving under unchanged content; once the
 * content itself changes width it is a new question, answered with no margin,
 * so an aside that collapsed for a badge that has since gone re-expands.
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
 * An element's natural (unconstrained) rendered width, measured off a clone.
 *
 * The live title and aside sit in a flex chain whose shrink-to-fit can resolve
 * far short of the content's real size exactly when the row runs out of room,
 * and a collapsed aside is laid out as the floating box, not the row. The clone
 * goes in beside the live element so it inherits the same font and contextual
 * selectors; `restyle` restates the aside's inline layout.
 *
 * `text`, when given, replaces the clone's content before measuring. The title
 * element's own live text can already be `useFittedTitle`'s compacted form
 * (the two hooks share no state), and measuring that would ask "does the short
 * form fit" instead of "does the aside need to give the FULL form room",
 * so a title that had already been shortened would report itself small enough
 * that the aside never collapsed to let it grow back.
 *
 * Inserted and removed in one synchronous call so nothing observes the clone.
 * Returns `0`, which `nextAsideCollapsed` treats as unmeasured, where nothing
 * is laid out (jsdom).
 */
function measureNaturalElementWidth(
  el: HTMLElement | null,
  restyle: Partial<CSSStyleDeclaration> = {},
  text?: string,
): number {
  const parent = el?.parentNode;
  if (!el || !parent) return 0;
  const clone = el.cloneNode(true) as HTMLElement;
  if (text !== undefined) clone.textContent = text;
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
 * belongs inline or behind the dots and expand box. Measured rather than a
 * width breakpoint, which is content-blind and would collapse a short title's
 * aside that has room.
 *
 * `rowRef` is the header row: its content width is the room available.
 * `titleRef` is the rendered `Panel.Title`, and `asideRef` the
 * `[data-panel-aside-full]` box. What the two need side by side is the title's
 * natural width, the row's gap, the aside box's horizontal padding, and the
 * aside's natural width.
 *
 * `fullTitle`, when given, is measured in place of whatever text is currently
 * live in `titleRef`. `Panel.Title` runs its own, separate fit (`useFittedTitle`)
 * and may already be showing a compacted form; measuring that would ask
 * whether the SHORT form fits rather than whether the aside must give way for
 * the full one, and a title that had already shortened would then report
 * itself small enough that the aside never collapsed, locking the short form
 * in for good.
 *
 * Content changes are read from a `MutationObserver`'s pending records after
 * each render rather than by comparing the `title` and `aside` nodes, which are
 * new on every render and would force a layout each time.
 */
export function useHeaderAsideFit(
  rowRef: RefObject<HTMLElement | null>,
  titleRef: RefObject<HTMLElement | null>,
  asideRef: RefObject<HTMLElement | null>,
  fullTitle?: string,
): boolean {
  const [collapsed, setCollapsed] = useState(false);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const neededRef = useRef<number | undefined>(undefined);
  const fullTitleRef = useRef(fullTitle);
  fullTitleRef.current = fullTitle;

  const recompute = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const rowStyle = getComputedStyle(row);
    const available =
      row.getBoundingClientRect().width -
      px(rowStyle.paddingLeft) -
      px(rowStyle.paddingRight);
    const title = measureNaturalElementWidth(
      titleRef.current,
      {},
      fullTitleRef.current,
    );
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

  // Runs after every render, and measures only when the elements were swapped or something inside them changed.
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
 * Carries `Panel.Header`'s collapse decision down to content inside
 * `panelAside`. Content never measures independently, so it cannot disagree
 * with the chrome about which state the aside is in.
 */
export const PanelAsideSizeProvider = PanelAsideSizeContext.Provider;

/**
 * Whether the panel header's aside is drawn `full` or `collapsed`, for content
 * inside `panelAside` that draws differently in each. The header decides and
 * this reads that decision, so the content always agrees with it. `full`
 * outside a `Panel.Header`.
 *
 * @category Panel
 */
export function usePanelAsideSize(): PanelAsideSize {
  return useContext(PanelAsideSizeContext);
}
