import type { StreamStatusValue } from "@ksp-gonogo/sitrep-sdk";
import {
  Children,
  type ComponentPropsWithoutRef,
  createContext,
  Fragment,
  forwardRef,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styled, { css } from "styled-components";
import { AugmentSlot, useWidgetSegmentBound } from "./AugmentSlot";
import { Badge } from "./Badge";
import { badgeFace } from "./badgeFace";
import { PanelDelayRail } from "./CommandDelay/PanelDelayRail";
import { FramedDisplay } from "./FramedDisplay";
import { fitBox, fitMask } from "./fitBox";
import { focusRing, focusRingInset } from "./focusRing";
import { LiveRegion } from "./LiveRegion";
import { type BadgeEntry, usePanelBadgesContext } from "./PanelBadges";
import { SECTION_FILL_ATTR, SECTION_FULL_ATTR, Section } from "./Section";
import { PanelStatusDot } from "./status/PanelStatusDot";
import type { StatusSummary } from "./status/PanelStatusStore";
import { severityFromStreamStatus } from "./status/severity";
import { formatStreamStatus } from "./status/streamStatusWord";
import { useStatusBreakdown } from "./status/useStatusBreakdown";
import { useStatusContribution } from "./status/useStatusContribution";
import { useStatusSummary } from "./status/useStatusSummary";
import { Tooltip } from "./Tooltip";
import { titleText } from "./titleText";
import { TONE_LABEL } from "./tone";
import { useElementSize } from "./useElementSize";
import { useFittedTitle } from "./useFittedTitle";
import { PanelAsideSizeProvider, useHeaderAsideFit } from "./usePanelAsideSize";
import { filterControlOf, type RowFilter } from "./useRowFilter";
import { useKeyboardScrollable, useScrollerMetric } from "./useScrollerMetric";
import { VisuallyHidden } from "./VisuallyHidden";

interface PanelContextValue {
  scroller: HTMLElement | null;
  registerScroller: (el: HTMLElement | null) => void;
}

const PanelCtx = createContext<PanelContextValue | null>(null);

/**
 * Coordination between the panel's parts: `Panel.Body` registers the element
 * that scrolls and `Panel.Glow` observes it, so neither depends on nesting
 * order. Keep it to the scroll element.
 */
export function PanelContextProvider({ children }: { children?: ReactNode }) {
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const value = useMemo(
    () => ({ scroller, registerScroller: setScroller }),
    [scroller],
  );
  return <PanelCtx.Provider value={value}>{children}</PanelCtx.Provider>;
}

/**
 * The per-panel providers a `Panel` mounts. `Panel.Root` renders this; a
 * hand-composed panel can too. The delay-rail store is not here: a widget's
 * commands register above the `<Panel>` it returns, so that store is provided
 * above the widget.
 */
export function PanelProviders({ children }: { children?: ReactNode }) {
  return <PanelContextProvider>{children}</PanelContextProvider>;
}

/**
 * What a `Section fill` resolves to inside the box that owns the leftover
 * height. A content basis (not `flex: 1`) lets two filling sections keep their
 * own heights and split only the spare room. It still shrinks, so a drawing
 * sized from a ResizeObserver can give room back, but only down to a floor: a
 * zero minimum let the sections around it squeeze its scroller to nothing, and
 * the body scrolls past the floor instead.
 */
const SECTION_FILL_RULE = `
  & > [${SECTION_FILL_ATTR}] {
    flex: 1 1 auto;
    min-height: var(--size-section-fill-floor);
  }
`;

export const PanelContainer = styled.div<{
  $railTravels?: boolean;
  $hoverTitle?: boolean;
}>`
  /* Chrome only: border, surface and clip. The inset is Panel.Body's and the glow is Panel.Glow's. */
  background: var(--color-surface-panel);
  /* A size container, so the popped-open aside sizes itself in cqw against the panel's width. */
  container-type: inline-size;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-regular);
  /* Top only: the delay rail's band, reserved on every widget so a command in flight never pushes the title down. Sides and bottom stay zero so visual content can reach the chrome. */
  padding: var(--panel-rail-band) 0 0;
  /* When the rail travels with the header, the band is the sticky unit's first row instead. */
  ${({ $railTravels }) => ($railTravels ? "padding-top: 0;" : "")}
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
  /* A hoverTitle panel is itself the tab stop, and the grid cell clips an outset ring, so the ring is drawn inside the edge. */
  ${({ $hoverTitle }) => ($hoverTitle ? "position: relative;" : "")}
  ${({ $hoverTitle }) => ($hoverTitle ? focusRingInset : "")}
  /* A hand-composed panel can put sections straight in here, so this box owns the leftover height. */
  ${SECTION_FILL_RULE}
`;

const PanelTitle__Box = styled.h3`
  margin: 0;
  /* No top inset: PanelHeader__Row carries it, so the header pays for it once. */
  padding: var(--inset-panel-header);
  ${titleText}
  /* Flush, so the all-caps glyphs centre on the box the row aligns the aside against. */
  line-height: var(--line-height-flush);
  /* One line always: a wrapped title would push the aside down. */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

/**
 * Props for `Panel.Title`, the panel heading. Other `h3` attributes pass through.
 *
 * @category Panel
 */
export interface PanelTitleProps
  extends Omit<ComponentPropsWithoutRef<"h3">, "title"> {
  /**
   * Shorter forms of this title, longest first, for tiles the full one will not
   * fit in.
   *
   * The widest form that fits the box is drawn. When a shorter form is
   * showing, the full title stays the accessible name and the hover tooltip.
   */
  compact?: string | readonly string[];
}

/** A panel's title, in the longest form that fits. */
export const PanelTitle = forwardRef<HTMLHeadingElement, PanelTitleProps>(
  function PanelTitle({ compact, children, ...rest }, forwarded) {
    const own = useRef<HTMLHeadingElement | null>(null);
    // Candidates are measured by substituting their text into a clone, so only a string title can be compacted.
    const full = typeof children === "string" ? children : "";
    const forms =
      compact === undefined || full === ""
        ? EMPTY_COMPACT
        : typeof compact === "string"
          ? [compact]
          : compact;
    const { index, compacted } = useFittedTitle(own, full, forms);
    return (
      <Tooltip text={compacted ? full : undefined}>
        <PanelTitle__Box
          {...rest}
          ref={(node: HTMLHeadingElement | null) => {
            own.current = node;
            if (typeof forwarded === "function") {
              forwarded(node);
              return;
            }
            if (forwarded) forwarded.current = node;
          }}
          aria-label={compacted ? full : undefined}
        >
          {index === 0 ? children : forms[index - 1]}
        </PanelTitle__Box>
      </Tooltip>
    );
  },
);

/** Stable, so a title with no compact forms does not hand the fit hook a fresh array each render. */
const EMPTY_COMPACT: readonly string[] = [];

const PanelHeader__Row = styled.div`
  padding-top: var(--inset-panel-header-top);
  display: flex;
  /* Centred, which levels the collapsed dots and chevron on the single-line title. */
  align-items: center;
  justify-content: space-between;
  gap: var(--gap-panel-header);
  min-width: 0;
  /* Wraps so PanelToolbar's full basis starts its own line; the aside never wraps, because the title column absorbs the pressure first. */
  flex-wrap: wrap;
  /* Never shrink, or a short tile's body would overprint the title. */
  flex-shrink: 0;
`;

const PanelHeader__Titles = styled.div`
  min-width: 0;
  /* A zero basis, so a long title shrinks beside the aside instead of wrapping it onto a second line; useFittedTitle measures the room this leaves. */
  flex-grow: 1;
  flex-shrink: 1;
  flex-basis: 0;
  display: flex;
  align-items: center;
  & > h3 {
    flex: 1 1 auto;
    min-width: 0;
  }
`;

/**
 * An invisible, zero-width badge beside the title, so the row is always as
 * tall as a badge and one arriving in the aside fills height that was already
 * there. Its line is a generated space, so the panel's text content stays the
 * widget's own.
 */
const PanelHeader__Strut = styled.span`
  display: flex;
  flex: 0 0 0;
  width: 0;
  overflow: hidden;
  visibility: hidden;
  & > *::before {
    content: "\\00a0";
  }
`;

const PanelHeader__Aside = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-panel-aside);
  /* Never grows or wraps: an aside that stops fitting collapses to the dots. */
  justify-content: flex-end;
  flex-shrink: 0;
  /* Mirrors PanelTitle's inset so the badges line up with the title. */
  padding: var(--inset-panel-header);
`;

/**
 * The aside's collapse box. While the aside fits it shows inline; once
 * `$collapsed` is true it swaps to the per-severity status dots plus a chevron,
 * and the full aside (badges and controls) floats open on toggle. `$collapsed`
 * is a measured fit from `useHeaderAsideFit`, not a width breakpoint, so a
 * short title keeps its aside on a narrow panel.
 */
const PanelAsideExpand = styled.details<{ $collapsed?: boolean }>`
  position: relative;
  margin: 0;
  display: flex;
  align-items: center;
  /* Drops the ::details-content box, which otherwise breaks this element's shrink-to-fit sizing. */
  &::details-content {
    display: contents;
  }
  /* Exactly its content wide: the inline aside, or the dots summary once collapsed. */
  flex: 0 0 auto;

  & > summary {
    /* Wide default: no collapsed affordance, the aside just shows inline. */
    display: none;
    align-items: center;
    gap: var(--gap-panel-aside);
    list-style: none;
    cursor: pointer;
    /* Lands the dots on the title's cap band rather than its line box centre. */
    transform: translateY(-1px);
    /* Panel sets no foreground, so the currentColor chevron needs one. */
    color: var(--color-text-dim);
  }
  & > summary {
    ${focusRing}
  }
  & > summary::-webkit-details-marker {
    display: none;
  }
  & > summary [data-panel-aside-chevron] {
    /* A CSS caret, not an icon, so the header stays out of every widget's SVG queries. Points down closed. */
    flex: 0 0 auto;
    width: 6px;
    height: 6px;
    /* Extra space before the chevron only: the rotated box's corner eats into the gap. */
    margin-left: var(--gap-panel-aside);
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    /* The rotation leaves the ink centroid 1.4px low; the lift centres it on the dots. */
    transform: translateY(-1.4px) rotate(45deg);
    transition: transform var(--duration-base) var(--ease-standard);
  }
  &[open] > summary [data-panel-aside-chevron] {
    /* Points up when open; the centroid moves above centre, so the lift flips sign. */
    transform: translateY(1.4px) rotate(225deg);
  }

  & > [data-panel-aside-full] {
    /* Wide default: the full aside shows inline whatever the [open] state. */
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--gap-panel-aside);
    flex-wrap: wrap;
    min-width: 0;
  }

  ${({ $collapsed }) =>
    $collapsed &&
    css`
      & > summary {
        display: inline-flex;
      }
      /* Hidden rather than display: none, so useHeaderAsideFit's clone measurement sees it as it sees the inline state. */
      &:not([open]) > [data-panel-aside-full] {
        position: absolute;
        top: 0;
        right: 0;
        visibility: hidden;
        pointer-events: none;
      }
      /* Collapsed and open: floats over the body so its controls do not reflow the panel. */
      &[open] > [data-panel-aside-full] {
        position: absolute;
        top: calc(100% + var(--offset-popover));
        right: 0;
        /* Widget-internal stacking above the header, off the app-global z ladder. */
        z-index: 3;
        flex-direction: column;
        align-items: stretch;
        justify-content: flex-start;
        flex-wrap: nowrap;
        /* A real floor so a control has room, capped at the panel width. */
        min-width: min(14rem, 90cqw);
        max-width: 90cqw;
        padding: var(--inset-popover);
        background: var(--color-surface-panel);
        border: 1px solid var(--color-border-subtle);
        border-radius: var(--radius-regular);
        box-shadow: var(--shadow-popover-drop)
          rgba(0, 0, 0, 0.35);
      }
    `}
`;

/**
 * Title and an optional right-hand aside on one row.
 *
 * When the title and aside no longer fit side by side, the aside collapses to
 * the panel's per-severity status dots (worst first) plus a chevron, and the
 * full aside floats open on toggle. A hand-composed header gets this too.
 */
export function PanelHeader({
  title,
  compactTitle,
  aside,
  toolbar,
  ...rest
}: Omit<ComponentPropsWithoutRef<"div">, "title"> & {
  title?: ReactNode;
  /** Shorter forms of `title`, longest first. See {@link PanelTitleProps}. */
  compactTitle?: string | readonly string[];
  aside?: ReactNode;
  /**
   * A row of controls on its own line below the title. See `Panel.Toolbar`.
   */
  toolbar?: ReactNode;
}) {
  const breakdown = useStatusBreakdown();

  // `rowRef` is the room available to title and aside together; `titleRef` and `asideFullRef` are what they need. jsdom never measures, so it always sees the wide default.
  const rowRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const asideFullRef = useRef<HTMLDivElement>(null);
  const collapsed = useHeaderAsideFit(
    rowRef,
    titleRef,
    asideFullRef,
    typeof title === "string" ? title : undefined,
  );

  /**
   * The `<details>` is a disclosure only while collapsed. Inline it is forced
   * open, so assistive tech is never told that badges on screen are hidden
   * behind a trigger that does not exist. Leaving the collapsed state drops the
   * operator's open choice, so a panel that narrows again starts closed.
   */
  const [openWhileCollapsed, setOpenWhileCollapsed] = useState(false);
  useEffect(() => {
    if (!collapsed) setOpenWhileCollapsed(false);
  }, [collapsed]);

  return (
    /* `data-panel-header` is a stable targeting hook. */
    <PanelHeader__Row ref={rowRef} data-panel-header="" {...rest}>
      <PanelHeader__Titles>
        {title !== undefined && (
          <PanelTitle ref={titleRef} compact={compactTitle}>
            {title}
          </PanelTitle>
        )}
        <PanelHeader__Strut aria-hidden="true">
          <Badge>{null}</Badge>
        </PanelHeader__Strut>
      </PanelHeader__Titles>
      {aside !== undefined && (
        <PanelHeader__Aside>
          {/* A native `<details>` carries an implicit `role="group"`, so an aside's own `getByRole("group")` query must scope to its subtree. */}
          <PanelAsideExpand
            data-panel-aside-expand=""
            $collapsed={collapsed}
            open={collapsed ? openWhileCollapsed : true}
            onToggle={(e) => {
              // The forced-open inline state is not an operator choice.
              if (collapsed) setOpenWhileCollapsed(e.currentTarget.open);
            }}
          >
            <summary
              aria-label={
                breakdown.length === 0
                  ? "Panel status and controls"
                  : `${breakdown
                      .map((e) => `${e.count} ${TONE_LABEL[e.severity]}`)
                      .join(", ")}. Panel status and controls`
              }
            >
              {breakdown.map((e) => (
                <PanelStatusDot
                  key={e.severity}
                  severity={e.severity}
                  count={e.count}
                />
              ))}
              <span data-panel-aside-chevron="" aria-hidden="true" />
            </summary>
            <PanelAsideSizeProvider value={collapsed ? "collapsed" : "full"}>
              <div data-panel-aside-full="" ref={asideFullRef}>
                {aside}
              </div>
            </PanelAsideSizeProvider>
          </PanelAsideExpand>
        </PanelHeader__Aside>
      )}
      {toolbar !== undefined && <PanelToolbar>{toolbar}</PanelToolbar>}
    </PanelHeader__Row>
  );
}

/**
 * A full-width row of controls under the header, pinned like the header and
 * outside the scrolling body.
 *
 * `panelAside` is the small slot beside the title (a chip, a badge, one
 * select); a toolbar is for controls that are a row in their own right, such as
 * a map's layer pickers or a graph's series toggles. It wraps rather than
 * scrolls, so a narrow tile gets a taller toolbar.
 */
export const PanelToolbar = styled.div`
  ${fitBox("panel-toolbar")}
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--gap-control-row);
  padding: var(--inset-panel-toolbar);
  min-width: 0;
  /* Never shrink, or a short tile squeezes the controls away. */
  flex-shrink: 0;
  /* A full basis, so the toolbar always takes its own line in the wrapping header row. */
  flex-basis: 100%;
  width: 100%;
`;

/**
 * A panel body is the default density tier, and re-declares both steppable gap
 * names so a panel nested inside a compact `Card` does not inherit the card's
 * density.
 */
const PanelBody__Box = styled.div<{
  $fitToSize?: boolean;
  $loneFrame?: boolean;
  $hoverTitle?: boolean;
}>`
  --gap-related: var(--gap-related-comfortable);
  --gap-section: var(--gap-section-comfortable);
  --bleed-inline: var(--gutter-panel);
  /* The body's side and bottom inset; a lone framed drawing steps this down under a narrow container. */
  --panel-body-gutter: var(--gutter-panel);
  --panel-body-bottom: var(--inset-panel-bottom);

  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  /* Longhands, because jsdom drops a shorthand made of var() calls. */
  padding-top: var(--inset-panel-top);
  padding-right: var(--panel-body-gutter);
  padding-bottom: var(--panel-body-bottom);
  padding-left: var(--panel-body-gutter);
  /* Body is the scroller, so the inset sits inside the scrolling box and never clips overflow. */
  overflow: auto;
  ${focusRingInset}
  /* The glow shows scroll state, so the native bar is hidden. */
  scrollbar-width: none;
  -ms-overflow-style: none;
  &::-webkit-scrollbar {
    width: 0;
    height: 0;
    display: none;
  }
  /* Fit-to-size never scrolls, and centres only once measurement says the content fits: Firefox clips safe center while reporting support for it. */
  ${({ $fitToSize }) => ($fitToSize ? "flex: 1; overflow: hidden;" : "")}
  ${({ $loneFrame }) =>
    $loneFrame
      ? `@container (width < ${LONE_FRAME_BREAKPOINT}) {
           --panel-body-gutter: var(--inset-tiny);
           --panel-body-bottom: var(--inset-tiny);
         }`
      : ""}
  /* The title row is out of flow entirely (see PanelHoverTop), so the body
     takes the same thin inset a lone framed drawing gets under a narrow
     container, unconditionally: a hoverTitle panel is always that narrow. */
  ${({ $hoverTitle }) =>
    $hoverTitle
      ? `--panel-body-gutter: var(--inset-tiny);
         --panel-body-bottom: var(--inset-tiny);`
      : ""}
  ${SECTION_FILL_RULE}
  /* A lone drawing is the whole body, so nothing squeezes it and it keeps giving room back. */
  ${({ $loneFrame }) =>
    $loneFrame
      ? `& > [${SECTION_FILL_ATTR}] {
           min-height: 0;
         }`
      : ""}
`;

/**
 * The panel width below which a lone framed drawing takes the thin inset.
 * Under it the standard gutters cost such a drawing 15 to 35 percent of its
 * area; above it about 10.
 */
const LONE_FRAME_BREAKPOINT = "25rem";

/**
 * The content box, the inset, and the scrolling. Registers itself with the
 * panel context so `Panel.Glow` can observe it without reaching into the tree.
 */
export function PanelBody({
  children,
  fitToSize,
  loneFrame,
  hoverTitle,
  ...rest
}: ComponentPropsWithoutRef<"div"> & {
  fitToSize?: boolean;
  /** The body is one framed drawing and nothing else. See `Panel`'s `sections`. */
  loneFrame?: boolean;
  /** The title row is out of flow; see `Panel`'s `hoverTitle`. */
  hoverTitle?: boolean;
}) {
  const ctx = useContext(PanelCtx);
  const register = ctx?.registerScroller;
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      register?.(el);
      setScroller(el);
    },
    [register],
  );
  const tabIndex = useKeyboardScrollable(scroller);
  return (
    /* `data-panel-body` is a stable targeting hook for the scroller's visible height. */
    <PanelBody__Box
      ref={ref}
      tabIndex={tabIndex}
      data-panel-body=""
      $fitToSize={fitToSize}
      $loneFrame={loneFrame}
      data-panel-lone-frame={loneFrame ? "" : undefined}
      $hoverTitle={hoverTitle}
      {...rest}
    >
      {children}
    </PanelBody__Box>
  );
}

/**
 * The default narrowest a section column may be before the panel stops offering
 * a second one: two columns in a panel about 470px wide. A string so a widget
 * can pass `100%` to opt out of columns entirely.
 */
const DEFAULT_SECTION_MIN_WIDTH = "13rem";

/**
 * Where the wide-layout decision lives: `auto-fit` + `minmax` takes as many
 * columns of at least `$min` as the panel's width allows, so sections flow
 * across a landscape tile and stack in a portrait one.
 *
 * `min($min, 100%)` keeps a narrow tile stacking instead of scrolling sideways.
 * The `max(..., 1/N of the panel)` floor makes more than N tracks impossible,
 * because a track a full-width section spans is not collapsed by `auto-fit`.
 */
const PanelSections__Grid = styled.div<{ $min: string; $columns: number }>`
  display: grid;
  grid-template-columns: repeat(
    auto-fit,
    minmax(
      max(
        min(${({ $min }) => $min}, 100%),
        ${({ $columns }) =>
          `calc((100% - ${$columns - 1} * var(--gap-panel-columns)) / ${$columns})`}
      ),
      1fr
    )
  );
  /* Wider between columns than rows: a column gap has no section title doing the separating. */
  gap: var(--gap-panel-sections) var(--gap-panel-columns);
  /* Natural heights, so a short section beside a tall one does not read as an empty box. */
  align-items: start;
  & > [${SECTION_FULL_ATTR}] {
    grid-column: 1 / -1;
  }
`;

/**
 * The tiny-tile layout: fills every pixel between the header's foot and the
 * panel's clip edge and centres the widget's content in it, but only while
 * measurement says the content fits. Wraps the children alone, so the header
 * is neither centred nor measured.
 */
function PanelFitBody({
  children,
  hoverTitle,
}: {
  children?: ReactNode;
  hoverTitle?: boolean;
}) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const fits = useContentFits(outerRef, innerRef);
  return (
    <PanelBody__FitOuter ref={outerRef} $fits={fits} data-panel-fit-body="">
      <PanelBody__FitContent
        ref={innerRef}
        $fits={fits}
        $hoverTitle={hoverTitle}
      >
        {children}
      </PanelBody__FitContent>
    </PanelBody__FitOuter>
  );
}

const PanelBody__FitOuter = styled.div<{ $fits?: boolean }>`
  flex: 1;
  min-height: 0;
  /* Takes back the body's gap above and its bottom inset, so the box is all the room a tiny tile has and centring is measured against it. Reads the body's own custom property rather than the raw token, so a stepped-down bottom inset (loneFrame, hoverTitle) is taken back by exactly as much. */
  margin-top: calc(-1 * var(--gap-related));
  margin-bottom: calc(-1 * var(--panel-body-bottom));
  display: flex;
  flex-direction: column;
  /* Never clips: the body owns the real boundary. */
  ${({ $fits }) =>
    $fits ? "justify-content: center;" : "justify-content: flex-start;"}
`;

const PanelBody__FitContent = styled.div<{
  $fits?: boolean;
  $hoverTitle?: boolean;
}>`
  display: flex;
  flex-direction: column;
  align-items: center;
  /* Aligned like its box: centring here would push overflowing content up under the header. */
  ${({ $fits }) =>
    $fits ? "justify-content: center;" : "justify-content: flex-start;"}
  /* The delay rail band above still reserves its own strip on a hoverTitle
     panel (see PanelProps.hoverTitle), so the box this centres within is
     shorter at the top than the panel actually is, by the band's own height.
     Centred content would read as sitting low by half of it, the same way it
     would if the box below a real header were centred on the whole panel
     instead of the room under that header. The band has no visible header to
     read as the reason, so the shift here is what keeps the figure reading as
     centred on the panel while the box itself stays exactly what fitToSize's
     own docs promise: never clipped, and unaffected while the content does
     not fit.

     The flex centring above absorbs half of any margin change into its own
     free-space split (a flex item's centred position moves by m/2 for a
     margin-top of m, not m), so the full band's height is what actually
     buys the half-band visual shift this needs. */
  ${({ $fits, $hoverTitle }) =>
    $fits && $hoverTitle
      ? "margin-top: calc(-1 * var(--panel-rail-band));"
      : ""}
  gap: var(--gap-tiny-content);
  min-height: 0;
  /* A query container, so a tiny presentation sizes its headline in cqw against the tile rather than the viewport. */
  container-type: inline-size;
`;

/**
 * Whether the content currently fits its box, so a tiny tile centres only
 * when centring cannot push the first line up under the header. Measured
 * because Firefox clips `safe center` in practice. True when there is nothing
 * to measure.
 */
function useContentFits(
  boxRef: { current: HTMLElement | null },
  contentRef: { current: HTMLElement | null },
): boolean {
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content) return;
    const measure = () => {
      setFits(contentFits(contentExtent(content), box.clientHeight));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    /* The content box is squeezed to the box, so it stops resizing once its
       children outgrow it. Each child is observed as well, and a child added
       later is picked up as it arrives. */
    const observer = new ResizeObserver(measure);
    const observeAll = () => {
      observer.observe(box);
      observer.observe(content);
      for (const child of Array.from(content.children)) observer.observe(child);
    };
    observeAll();
    const children = new MutationObserver(() => {
      observeAll();
      measure();
    });
    children.observe(content, { childList: true });
    return () => {
      observer.disconnect();
      children.disconnect();
    };
  }, [boxRef, contentRef]);
  return fits;
}

/**
 * How tall the content is, whatever its box does: from the top of its first
 * child to the bottom of its last. The box itself is squeezed to the room left
 * under the header and its children overflow it, so its own height says
 * nothing once they no longer fit, and its scroll height counts only the half
 * of a centred overflow that went downwards.
 */
function contentExtent(content: HTMLElement): number {
  const rects = Array.from(content.children, (child) =>
    child.getBoundingClientRect(),
  );
  if (rects.length === 0) return content.scrollHeight;
  return (
    Math.max(...rects.map((r) => r.bottom)) -
    Math.min(...rects.map((r) => r.top))
  );
}

/**
 * Whether content of `content` height, centred in a box `box` tall, stays
 * inside it. The box already runs from the header's foot to the clip edge, so
 * there is no room past either end to overflow into.
 */
export function contentFits(content: number, box: number): boolean {
  return content <= box;
}

const ScrollAreaRoot = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  /* Fills the flex-column parent so the inner scroller engages rather than spilling past the panel edge. */
  flex: 1;
  min-height: 0;
  /* Out to the panel's edges, its content back on the column, so a strip inside that bleeds is not clipped by this scroller. */
  margin-inline: calc(-1 * var(--bleed-inline));
`;

/**
 * Inner scroll element. Carries a stable `data-scroll-area-inner` attribute so
 * a `styled(ScrollArea)` can target it to lay out the scrolling children.
 */
const ScrollAreaInner = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-inline: var(--bleed-inline);
  ${focusRingInset}
  /* The glow indicators show scroll state, so the native bar is hidden. */
  scrollbar-width: none;
  -ms-overflow-style: none;
  &::-webkit-scrollbar {
    width: 0;
    height: 0;
    display: none;
  }
`;

const ScrollOverflowGlow = styled.div<{
  $position: "top" | "bottom";
  $visible: boolean;
  /** How far below the scroller's top edge the top glow starts: the rail band's height when the rail travels inside the scroller. */
  $topOffset?: string;
}>`
  position: absolute;
  /* Flush with the scroller's edges: the body's inset is inside the scroller, so nothing pads this. */
  left: 0;
  right: 0;
  ${({ $position, $topOffset }) =>
    $position === "top" ? `top: ${$topOffset ?? "0"};` : "bottom: 0;"}
  /* The box both layers fade within; each sets its own reach in its gradient stops. */
  height: 44px;
  /* The audit reads the mask depth from the gradient, so the literal height costs it nothing. */
  ${fitMask("panel-scroll-glow")}
  pointer-events: none;
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  transition: opacity var(--duration-base) var(--ease-standard);
  /* A light affordance tint over a fully opaque panel-colour mask; only an opaque mask keeps scrolled content from ghosting through the sticky title. */
  background:
    linear-gradient(
      ${({ $position }) => ($position === "top" ? "to bottom" : "to top")},
      color-mix(
        in srgb,
        color-mix(in srgb, var(--color-surface-panel), white 20%) 55%,
        transparent
      ),
      transparent 40%
    ),
    linear-gradient(
      ${({ $position }) => ($position === "top" ? "to bottom" : "to top")},
      var(--color-surface-panel) 0%,
      var(--color-surface-panel) 27%,
      transparent 50%
    );
  /* Widget-internal stacking, off the app-global z ladder so it never lifts over dashboard chrome. */
  z-index: 1;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

/**
 * A scrolling region with a glow at the top and bottom edges while there is
 * content to scroll to. A panel body already scrolls and glows; use this for a
 * second scrolling region inside a widget (a sidebar list, a terminal log).
 * Its native scrollbar is hidden, and it takes keyboard focus when its content
 * overflows so it can be scrolled from the keyboard.
 *
 * The ref is forwarded to the inner scroll element; `className` and other
 * `div` attributes go to the outer root. A `styled(ScrollArea)` can reach the
 * inner element through its `data-scroll-area-inner` attribute.
 *
 * @category Panel
 */
export const ScrollArea = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<"div">
>(function ScrollArea({ children, ...rest }, ref) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [inner, setInner] = useState<HTMLDivElement | null>(null);
  const attachInner = useCallback((el: HTMLDivElement | null) => {
    innerRef.current = el;
    setInner(el);
  }, []);

  useImperativeHandle(ref, () => innerRef.current as HTMLDivElement);

  const overflow = useScrollerMetric(
    inner,
    scrollOverflow,
    sameOverflow,
    NO_OVERFLOW,
  );
  const innerTabIndex = useKeyboardScrollable(inner);

  return (
    <ScrollAreaRoot {...rest}>
      <ScrollAreaInner
        ref={attachInner}
        tabIndex={innerTabIndex}
        data-scroll-area-inner=""
      >
        {children}
      </ScrollAreaInner>
      <ScrollOverflowGlow $position="top" $visible={overflow.top} />
      <ScrollOverflowGlow $position="bottom" $visible={overflow.bottom} />
    </ScrollAreaRoot>
  );
});

/**
 * Where a panel's sidebar sits relative to the body, in logical terms: `end` is
 * the right edge in LTR and the left in RTL, and the bottom when the sidebar
 * sits under the body. {@link Panel} defaults to `end`. The sidebar always
 * follows the body in the DOM, whichever side it is drawn on.
 *
 * @category Panel
 */
export type PanelSidebarSide = "start" | "end";

/** Sidebar beside the body (inline) or under it (block). Derived, never passed. */
type PanelSidebarAxis = "inline" | "block";

/** Resolve a `px` or `rem` length to pixels; undefined for any other unit. */
function resolveCssLength(value: string): number | undefined {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return undefined;
  if (value.endsWith("px")) return n;
  if (value.endsWith("rem")) {
    const root =
      typeof document === "undefined"
        ? 16
        : Number.parseFloat(
            getComputedStyle(document.documentElement).fontSize || "16",
          );
    return n * (Number.isFinite(root) ? root : 16);
  }
  return undefined;
}

// A column beside the body wants an absolute width; a strip under it competes for the tile's height, so it takes a share.
const SIDEBAR_INLINE_SIZE = "14rem";
const SIDEBAR_BLOCK_SIZE = "40%";

function sidebarTracks(side: "start" | "end", size: string): string {
  return side === "start"
    ? `minmax(0, ${size}) minmax(0, 1fr)`
    : `minmax(0, 1fr) minmax(0, ${size})`;
}

const PanelSplit__Box = styled.div<{
  $axis: PanelSidebarAxis;
  $side: "start" | "end";
  $size: string;
  $railBand?: boolean;
}>`
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: grid;
  gap: 0;
  /* Every track is minmax(0, ...), or a sidebar with its own ScrollArea floors at its content and is clipped instead of scrolling. */
  ${({ $axis, $side, $size }) =>
    $axis === "inline"
      ? `grid-template-columns: ${sidebarTracks($side, $size)};
         grid-template-rows: minmax(0, 1fr);`
      : `grid-template-columns: minmax(0, 1fr);
         grid-template-rows: ${sidebarTracks($side, $size)};`}

  /* Visual placement only: the sidebar always follows the body in the DOM, so reading and tab order never depend on its side. */
  ${({ $side }) =>
    $side === "start" ? "& > [data-panel-sidebar] { order: -1; }" : ""}

  /* The sidebar gets the rail band when the rail travels with the header, since only the body's scroller holds it. */
  ${({ $railBand }) =>
    $railBand
      ? `& > [data-panel-sidebar] {
           padding-block-start: var(--panel-rail-band);
         }`
      : ""}

  /* On the inline axis the sidebar gives back its inset on the edge facing the body, which already pays one. */
  ${({ $axis, $side }) =>
    $axis === "inline"
      ? /* Child combinators the whole way down, so a ScrollArea the sidebar's
           own CONTENT carries keeps its own padding. */
        `& > [data-panel-sidebar] > * > [data-scroll-area-inner] {
           padding-inline-${$side === "start" ? "end" : "start"}: 0;
         }`
      : ""}
`;

/**
 * Props for the grid that holds a panel's body and sidebar. {@link Panel}
 * draws this grid itself when `panelSidebar` is set, taking `sidebarSide` and
 * `sidebarSize` as `side` and `size`.
 *
 * @category Panel
 */
export interface PanelSplitProps extends ComponentPropsWithoutRef<"div"> {
  /** Which edge the sidebar sits against. See {@link PanelSidebarSide}. Defaults to `end`. */
  side?: PanelSidebarSide;
  /**
   * Size of the sidebar track: a width on the inline axis, a height on the
   * block axis. Defaults to `14rem` and `40%` respectively.
   */
  size?: string;
  /** Gives the sidebar a top inset matching the delay rail's band, which the body track holds inside its scroller. */
  railBand?: boolean;
}

/**
 * The grid that holds `Panel.Body` and `Panel.Sidebar`.
 *
 * The axis is measured on this box, whose size does not change when the grid
 * flips axes; measuring the body instead would oscillate. A container query
 * would impose size containment on a box that must hand its height down.
 */
export function PanelSplit({
  side = "end",
  size,
  railBand,
  children,
  ...rest
}: PanelSplitProps) {
  // Seeded square, so an unmeasured panel gets the side-by-side arrangement.
  const { ref, size: measured } = useElementSize<HTMLDivElement>({
    w: 1,
    h: 1,
  });
  /*
   * The inline axis also needs absolute room: the body must keep at least as
   * much width as the sidebar takes, or the sidebar goes under. Applied only
   * once measured, so the 1x1 seed does not read as "no room".
   */
  const sidebarInline = resolveCssLength(size ?? SIDEBAR_INLINE_SIZE);
  const roomBeside =
    measured.w <= 1 ||
    sidebarInline === undefined ||
    measured.w >= sidebarInline * 2;
  const axis: PanelSidebarAxis =
    measured.w >= measured.h && roomBeside ? "inline" : "block";

  const resolvedSize =
    size ?? (axis === "inline" ? SIDEBAR_INLINE_SIZE : SIDEBAR_BLOCK_SIZE);
  return (
    /* `data-panel-split` is a stable targeting hook carrying the resolved axis. */
    <PanelSplit__Box
      ref={ref}
      data-panel-split={axis}
      $axis={axis}
      $side={side}
      $size={resolvedSize}
      $railBand={railBand}
      {...rest}
    >
      {children}
    </PanelSplit__Box>
  );
}

/** The sidebar's scroller. The inset goes inside it, since padding outside a scroller clips what scrolls under it. */
const PanelSidebar__Scroll = styled(ScrollArea)`
  /* Longhands, because jsdom drops a shorthand made of var() calls. */
  & > [data-scroll-area-inner] {
    padding-top: var(--inset-panel-top);
    padding-right: var(--gutter-panel);
    padding-bottom: var(--inset-panel-bottom);
    padding-left: var(--gutter-panel);
  }
`;

const PanelSidebar__Box = styled.div`
  display: flex;
  flex-direction: column;
  /* Grid items floor at min-content, which would let the ScrollArea grow the track instead of scrolling. */
  min-width: 0;
  min-height: 0;
`;

/**
 * Secondary content beside or below the body: an almanac for the diagram, a
 * legend for the plot, a detail pane for the selected row.
 *
 * It carries its own `ScrollArea` and is never inside `Panel.Body`, so
 * scrolling it does not scroll the drawing it annotates. It carries the body's
 * inset too; inside the split grid `panelSidebar` draws, the edge facing the body gives its inset
 * back, since the body already pays one there.
 */
export function PanelSidebar({
  children,
  ...rest
}: ComponentPropsWithoutRef<"div">) {
  return (
    <PanelSidebar__Box data-panel-sidebar="" {...rest}>
      <PanelSidebar__Scroll>{children}</PanelSidebar__Scroll>
    </PanelSidebar__Box>
  );
}

interface ScrollOverflow {
  top: boolean;
  bottom: boolean;
}

const NO_OVERFLOW: ScrollOverflow = { top: false, bottom: false };

/** Whether there is more to scroll to above and below the current position. */
function scrollOverflow(el: HTMLElement): ScrollOverflow {
  return {
    top: el.scrollTop > 1,
    bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
  };
}

function sameOverflow(a: ScrollOverflow, b: ScrollOverflow): boolean {
  return a.top === b.top && a.bottom === b.bottom;
}

const PanelGlow__Root = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
`;

/**
 * Owns the overflow glow and nothing else. It does not scroll; it decorates
 * whatever does, found through the panel context, so it can wrap the body or
 * sit beside it.
 */
export function PanelGlow({
  children,
  railBandAbove,
  ...rest
}: ComponentPropsWithoutRef<"div"> & {
  /** The scroller's first row is the delay rail's opaque band, so start the top glow below it. */
  railBandAbove?: boolean;
}) {
  const ctx = useContext(PanelCtx);
  const el = ctx?.scroller ?? null;

  useEffect(() => {
    if (!ctx && process.env.NODE_ENV !== "production") {
      // Without a context this renders correctly and does nothing, so say so.
      console.warn(
        "Panel.Glow rendered outside a Panel.Context, so it has no scroller " +
          "to observe and will never show. Wrap it in Panel.Context (or use " +
          "Panel, which does).",
      );
    }
  }, [ctx]);

  const overflow = useScrollerMetric(
    el,
    scrollOverflow,
    sameOverflow,
    NO_OVERFLOW,
  );

  return (
    <PanelGlow__Root {...rest}>
      {children}
      <ScrollOverflowGlow
        $position="top"
        $visible={overflow.top}
        $topOffset={railBandAbove ? "var(--panel-rail-band)" : undefined}
      />
      <ScrollOverflowGlow $position="bottom" $visible={overflow.bottom} />
    </PanelGlow__Root>
  );
}

/**
 * What {@link PanelProps.inactive} takes: the reason as one line, or the
 * reason plus a hint at what would bring the panel back.
 *
 * @category Panel
 */
export type PanelInactiveReason = string | { reason: string; hint?: string };

/**
 * Props for {@link Panel}. Any other `div` attribute passes through to the
 * panel's container.
 *
 * @category Panel
 */
export interface PanelProps extends ComponentPropsWithoutRef<"div"> {
  /**
   * Panel heading. Supplying it opts into the composed model: the panel renders
   * its own title and pads its body. Named so it does not collide with the
   * div's own `title` tooltip attribute.
   */
  panelTitle?: ReactNode;
  /**
   * Why this panel has nothing to show and is off entirely: the header stays,
   * the body, sidebar, footer and trend give way to the reason. A string, or
   * `{ reason, hint }` for a second line saying what would bring it back.
   * Reserve it for a widget that has decided there is nothing to present at
   * all; any other emptiness (an empty list, a section awaiting data) stays
   * the widget's own.
   */
  inactive?: PanelInactiveReason;
  /**
   * The panel's body, as one or more sections: the preferred way to give a
   * panel content. Each entry is normally a `Section`; Panel owns how they
   * flow, down one column in a portrait tile and across two or three in a
   * landscape one. A single node is fine, and a conditional `null` entry does
   * not render.
   *
   * A widget that is wholly a drawing (a map, a globe) passes one
   * `<Section fill>` holding it. Not to be confused with the boolean
   * `panelSections`, which is about the augment slot. A bare boolean is
   * rejected so `sections={false}` cannot render an empty panel.
   */
  sections?: Exclude<ReactNode, boolean> | readonly ReactNode[];
  /**
   * Narrowest a section column may be before the panel stops offering a
   * second one. Defaults to `13rem`, which gives two columns in a panel about
   * 470px wide.
   *
   * Raise it for a widget whose sections carry long rows and read badly at the
   * default width; set it to `100%` for one that should never columnise at all.
   */
  sectionMinWidth?: string;
  /**
   * Shorter forms of `panelTitle`, longest first, for tiles the full one will
   * not fit in, including the widget's own `minSize`. See
   * {@link PanelTitleProps.compact}.
   */
  compactTitle?: string | readonly string[];
  /**
   * Content for the right of the header row, beside the stream-status badge:
   * state chips, an `AugmentSlot` for Uplink badges, a small control such as a
   * select or a show/hide button. Keep it small: anything that wants real
   * layout belongs in the body or a hand-composed `Panel.Header`.
   */
  panelAside?: ReactNode;
  /**
   * The widget's own state badges (paused, no signal, full), drawn as standard
   * pills in the header aside ahead of the badges contributed to the widget's
   * `${componentId}.badges` slot. A contributed badge sharing an id with one of
   * these is dropped. Badges render alongside whatever `panelAside` supplies.
   */
  panelBadges?: readonly PanelBadge[];
  /**
   * This panel's own stream status, shown as a badge in the header aside and
   * announced when it changes. `live` shows nothing, and `"none"` suppresses
   * the badge.
   *
   * The dashboard already derives the blackout grades (`recorded`,
   * `last-before-blackout`) across the widget's declared channels; every other
   * grade shows only when set here, since `absent` means different things for
   * different Topics. Set it for a panel reading one specific Topic. It merges,
   * worst first, with the dashboard's own status and any `report` badges.
   */
  panelStatus?: StreamStatusValue | "none";
  /**
   * A full-width row of controls under the header, pinned outside the
   * scrolling body. For widgets whose controls are a row in their own right
   * (a map's layer pickers, a graph's series toggles); a single chip or select
   * belongs in `panelAside` instead. Drawn in a `Panel.Toolbar`.
   */
  panelToolbar?: ReactNode;
  /**
   * A `useRowFilter` filter over the whole body, its control pinned in the
   * toolbar row under the header so it stays above the list it narrows while
   * the body scrolls. A filter over one list among others belongs in a
   * `FilterRegion` around that list instead.
   */
  panelFilter?: RowFilter;
  /**
   * Lays the content out for a small tile: centred in the room under the
   * header while it fits, top-aligned when it does not.
   *
   * It overrides `fill` on a section: with this set, every section stays an
   * ordinary grid item.
   */
  fitToSize?: boolean;
  /**
   * The tiny tile's header: the title row leaves the flow and the content
   * centres on the whole panel. The title stays an accessible heading, hidden
   * visually and drawn as a small pill top-left while the panel is hovered or
   * focused. The panel itself becomes a tab stop, named by that heading. The
   * header aside (badges, the status summary) stays drawn, pinned top-right,
   * and the delay rail keeps its strip above the content.
   */
  hoverTitle?: boolean;
  /**
   * A pinned strip at the very bottom of the panel, OUTSIDE the scrolling
   * body: the one readout an operator must never have to scroll for (a power
   * meter, a mission clock). It has its own top border and stays put while the
   * body scrolls. Keep it to a single row; anything taller belongs in the body
   * or a sidebar.
   */
  panelFooter?: ReactNode;
  /**
   * A trend across the panel's whole bottom edge, with no inset and on the
   * panel's own surface: the sparkline under a small readout. Handed the
   * strip's measured size, since a sparkline draws to fixed pixels.
   */
  panelTrend?: (size: { w: number; h: number }) => ReactNode;
  /**
   * Secondary content beside or below the body, in its own scrolling region:
   * an almanac for a diagram, a legend for a plot, a detail pane for the
   * selected row.
   *
   * It is a region, not a column of body content: for content whose scrolling
   * must not move what it annotates. Unset, the panel renders no split at all.
   */
  panelSidebar?: ReactNode;
  /**
   * Which edge the sidebar sits against, logically. See {@link PanelSidebarSide}.
   * Defaults to `end`.
   */
  sidebarSide?: PanelSidebarSide;
  /**
   * Size of the sidebar track: a width when it sits beside the body, a height
   * when it sits under it. Defaults to `14rem` and `40%` respectively.
   */
  sidebarSize?: string;
  /**
   * Whether this panel mounts the standard `${componentId}.sections` augment
   * slot at the end of its body. Defaults to true, so an Uplink can add a
   * section to any widget without the widget declaring a slot.
   *
   * Set false only when the widget renders {@link WidgetSections} itself
   * (inside a tab, a named section, a column of a sidebar); with both mounted,
   * every bound augment renders twice.
   */
  panelSections?: boolean;
}

/**
 * A widget's own header badge: a standard badge entry, optionally with a
 * tooltip saying why it shows.
 *
 * @category Panel
 */
export interface PanelBadge extends BadgeEntry {
  title?: string;
}

/** The widget's own badges first, then the contributed ones whose ids it does not already use. */
function mergeBadges(
  own: readonly PanelBadge[] | undefined,
  contributed: readonly BadgeEntry[] | null,
): readonly PanelBadge[] {
  if (own === undefined || own.length === 0) return contributed ?? [];
  if (contributed === null || contributed.length === 0) return own;
  const taken = new Set(own.map((b) => b.id));
  return [...own, ...contributed.filter((b) => !taken.has(b.id))];
}

/**
 * The standard augment segments {@link Panel} mounts for every widget:
 * `sections` and `actions`. Each completes to the slot id
 * `${componentId}.<segment>` for the widget the panel belongs to, so an Uplink
 * can bind `"<widget-id>.sections"` or `"<widget-id>.actions"` with
 * `registerAugment` for any widget, whether or not the widget declares slots of
 * its own. Neither segment passes props (see {@link AugmentSegmentRegistry}).
 *
 * - `sections`: body content added after everything the widget draws. When the
 *   widget passes `sections`, each bound augment is its own item in the last
 *   section grid, so it flows into a column beside the widget's own sections.
 *   A widget can move it with {@link WidgetSections}
 * - `actions`: controls in the panel header's right-hand aside, after the
 *   widget's own `panelAside` and before its badges. While nothing available
 *   is bound, the header draws no aside for it
 *
 * @category Panel
 */
export const FRAMEWORK_AUGMENT_SEGMENTS = ["sections", "actions"] as const;

const NO_SEGMENT_PROPS: Record<string, never> = Object.freeze({});

/**
 * Renders every augment bound to the current widget's standard
 * `${componentId}.sections` slot, in priority order, skipping any whose
 * `requires` Domain is not present. The augments get no props.
 *
 * {@link Panel} already mounts this at the end of its body, so a widget
 * renders it itself only to place the sections somewhere else (inside a tab,
 * a named section), and must then pass `panelSections={false}` to its `Panel`.
 * Outside a widget it renders nothing.
 *
 * @example
 * ```tsx
 * <Panel
 *   panelTitle="Power"
 *   panelSections={false}
 *   sections={
 *     <Tabs
 *       tabs={[
 *         { id: "bus", label: "Bus", content: <BusView /> },
 *         { id: "more", label: "More", content: <WidgetSections /> },
 *       ]}
 *     />
 *   }
 * />
 * ```
 *
 * @category Panel
 */
export function WidgetSections(): ReactElement {
  return <AugmentSlot segment="sections" props={NO_SEGMENT_PROPS} />;
}

/**
 * The winning status contribution, rendered as the header aside badge. It
 * pulses once when its severity changes, then settles (reduced-motion
 * guarded). The panel's own status region announces the change, not this badge.
 */
function PanelSummaryBadge({ summary }: { summary: StatusSummary }) {
  /*
   * Every severity change restarts the one-shot pulse by alternating between
   * two identical keyframe names, which a browser treats as a new animation.
   * A label-only change does not pulse.
   */
  const prevSeverity = useRef(summary.severity);
  const [pulseCount, setPulseCount] = useState(0);
  useEffect(() => {
    if (prevSeverity.current !== summary.severity) {
      prevSeverity.current = summary.severity;
      setPulseCount((k) => k + 1);
    }
  }, [summary.severity]);
  return (
    <PanelSummaryBadge__Pulse $pulse={pulseCount}>
      <Badge tone={summary.severity} size="sm">
        {summary.label}
      </Badge>
    </PanelSummaryBadge__Pulse>
  );
}

const PanelSummaryBadge__Pulse = styled.span<{ $pulse: number }>`
  display: inline-flex;
  ${({ $pulse }) =>
    $pulse > 0 &&
    css`
      @media (prefers-reduced-motion: no-preference) {
        animation: ${$pulse % 2 === 0 ? "panel-status-pulse" : "panel-status-pulse-b"}
          var(--duration-slow) var(--ease-emphasis);
      }
    `}
  @keyframes panel-status-pulse-b {
    0% {
      transform: scale(1);
    }
    35% {
      transform: scale(1.14);
    }
    100% {
      transform: scale(1);
    }
  }
  @keyframes panel-status-pulse {
    0% {
      transform: scale(1);
    }
    35% {
      transform: scale(1.14);
    }
    100% {
      transform: scale(1);
    }
  }
`;

/**
 * The pinned bottom strip `panelFooter` renders into: a flex-column sibling
 * AFTER the glow region, so it never scrolls and never shrinks. Mirrors the
 * body's horizontal inset so footer content lines up with the rows above it.
 */
export const PanelFooter = styled.div`
  flex-shrink: 0;
  border-top: 1px solid var(--color-border-subtle);
  padding: var(--inset-panel-footer);
  background: var(--color-surface-panel);
`;

/**
 * The delay rail and the header, as one sticky unit at the top of the body
 * scroller, so the rail always sits on the header.
 */
const PanelStickyTop = styled.div`
  position: sticky;
  /* Reach the scroller's true top edge, cancelling the body's own top inset. */
  top: calc(-1 * var(--inset-panel-top));
  z-index: 2;
  /* Cancel the body's inset so the unit spans the full panel width. */
  margin: calc(-1 * var(--inset-panel-top)) calc(-1 * var(--panel-body-gutter))
    0;
  display: flex;
  flex-direction: column;
  /* Never shrink, or a short tile crushes the band and the title. */
  flex-shrink: 0;

  /* The band is this unit's own first row, so the rail frame does not pull up into container padding. */
  & > [data-panel-rail-frame] {
    margin-top: 0;
  }
`;

/** The full-bleed strip `panelTrend` draws into, measured so the trend can be drawn to its pixels. */
function PanelTrend({
  render,
}: {
  render: (size: { w: number; h: number }) => ReactNode;
}) {
  const { ref, size } = useElementSize<HTMLDivElement>({ w: 0, h: 0 });
  return (
    <PanelTrend__Strip ref={ref} data-panel-trend="">
      {size.w > 0 && size.h > 0 && render(size)}
    </PanelTrend__Strip>
  );
}

const PanelTrend__Strip = styled.div`
  flex: 0 0 var(--size-panel-trend);
  height: var(--size-panel-trend);
  min-width: 0;
  overflow: hidden;
`;

/* A filter control takes the toolbar row's whole width, so its search box is not squeezed beside other controls. */
const PanelFilterSlot = styled.div`
  flex: 1 1 100%;
  min-width: 0;
`;

/* The standard header inside the sticky unit. The unit's negative margins cancel the body's inset for the header alone. */
const PanelStickyHeader = styled(PanelHeader)`
  /* Transparent: the panel glow under it is its backing. */
  /* The rail band above is this header's top inset. */
  padding-top: 0;
  /* The one header that reads over scrolled content gets a title a notch brighter than the dim chrome token. */
  & h3 {
    color: color-mix(
      in srgb,
      var(--color-text-dim),
      var(--color-text-primary) 45%
    );
  }
`;

/**
 * The tiny tile's title-and-aside strip, out of flow above the centred
 * content: the title pill at the start, the aside pushed to the end. Empty
 * itself, so the whole panel stays clickable under it; only its children
 * re-enable pointer events.
 */
const PanelHoverTop = styled.div`
  position: absolute;
  top: var(--inset-tiny);
  left: var(--inset-tiny);
  right: var(--inset-tiny);
  /* Above the panel's own content (PanelGlow, trend, footer), local sibling ordering inside this panel's own stacking context. Not app-global chrome, so no named z rung. */
  z-index: 3;
  display: flex;
  align-items: flex-start;
  gap: var(--gap-panel-aside);
  pointer-events: none;
`;

/**
 * The tiny tile's title: an accessible heading at rest, sr-only through
 * `VisuallyHidden`, drawn as a pill hugging its text on hover or focus. Keyed
 * on `:focus` rather than `:focus-visible`, so a tap reveals it too.
 */
const PanelHoverTitlePill = styled(VisuallyHidden)`
  margin: 0;
  ${titleText}
  font-size: var(--font-size-caption);
  line-height: var(--line-height-flush);
  max-width: 100%;
  text-overflow: ellipsis;
  ${PanelContainer}:hover &,
  ${PanelContainer}:focus & {
    position: static;
    width: auto;
    height: auto;
    clip: auto;
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-pill);
    padding: var(--inset-chip);
  }
`;

/** The tiny tile's aside, pinned top-right and always visible: unlike the pill it needs no reveal. */
const PanelHoverAside = styled.div`
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--gap-panel-aside);
  pointer-events: auto;
`;

/**
 * `useId()`'s output is not scoped to the component that calls it: React
 * allocates from one sequence across the whole render, so a call added here
 * unconditionally shifts every OTHER widget's own `useId()`-derived strings
 * downstream of it (Navball's SVG clip path is one, generated deep inside a
 * widget that never sets `hoverTitle` at all). Two component identities,
 * chosen by the stable `hoverTitle` prop before either renders, keep the
 * call scoped to the panels that actually draw a tiny header; every other
 * panel's own ids are untouched.
 */
function PanelRoot(props: PanelProps): ReactElement {
  return props.hoverTitle ? (
    <PanelRootWithHoverTitle {...props} />
  ) : (
    <PanelRootImpl {...props} hoverTitleId={undefined} />
  );
}

function PanelRootWithHoverTitle(props: PanelProps): ReactElement {
  const hoverTitleId = useId();
  return <PanelRootImpl {...props} hoverTitleId={hoverTitleId} />;
}

function PanelRootImpl({
  panelTitle,
  compactTitle,
  panelAside,
  panelBadges,
  panelStatus,
  panelToolbar,
  panelFilter,
  panelFooter,
  panelTrend,
  inactive,
  fitToSize,
  hoverTitle,
  hoverTitleId,
  panelSidebar,
  sidebarSide,
  sidebarSize,
  panelSections = true,
  sections,
  sectionMinWidth = DEFAULT_SECTION_MIN_WIDTH,
  children,
  ...rest
}: PanelProps & { hoverTitleId: string | undefined }): ReactElement {
  const contextBadges = usePanelBadgesContext();
  // Asked as a boolean first, because an aside that exists at all is a padded box.
  const hasActionAugments = useWidgetSegmentBound("actions");
  const hasSectionAugments = useWidgetSegmentBound("sections");
  const badges = mergeBadges(panelBadges, contextBadges);
  const badgePills =
    badges.length === 0
      ? null
      : badges.map((b) => {
          const { label, tone, title } = badgeFace(b);
          return (
            <Tooltip key={b.id} text={title} focusable>
              <Badge
                tone={tone}
                /* A decorative chip stays out of the collapsed header's dot summary. */
                report={
                  tone === undefined || tone === "neutral"
                    ? undefined
                    : { id: b.id }
                }
              >
                {label}
              </Badge>
            </Tooltip>
          );
        });
  const toolbar =
    panelFilter === undefined ? (
      panelToolbar
    ) : (
      <>
        {panelToolbar}
        <PanelFilterSlot>{filterControlOf(panelFilter)}</PanelFilterSlot>
      </>
    );
  /*
   * The header status merges alarms, `report` badges and the stream status
   * into one summary through the per-item status store. The stream half is the
   * widget's own `panelStatus`: "absent" means opposite things per topic, so
   * the host derives only the per-subject blackout grades.
   */
  const status = panelStatus ?? null;
  // A healthy stream contributes nothing, so it never draws a green pill.
  const streamStatus: StreamStatusValue | null =
    status !== null && status !== "none" && status !== "live" ? status : null;
  useStatusContribution(
    streamStatus
      ? {
          id: "stream",
          severity: severityFromStreamStatus(streamStatus),
          label: formatStreamStatus(streamStatus) ?? "",
        }
      : null,
  );
  const summary = useStatusSummary();
  /* A badge that already draws its own pill must not also win the summary, or its label shows twice. */
  const summaryDuplicatesABadgePill =
    summary !== null && badges.some((b) => b.id === summary.id);

  // With no status store in the tree, fall back to the stream badge.
  const streamLabel =
    streamStatus === null ? null : formatStreamStatus(streamStatus);
  const statusBadge = summaryDuplicatesABadgePill ? null : summary !== null ? (
    <PanelSummaryBadge summary={summary} />
  ) : streamStatus === null || streamLabel === null ? null : (
    <Badge tone={severityFromStreamStatus(streamStatus)} size="sm">
      {streamLabel}
    </Badge>
  );
  /* Prefixed with a plain title, so a change is heard as belonging to a widget. */
  const statusLabel = summary?.label ?? streamLabel;
  const statusAnnouncement =
    statusLabel === null || statusLabel === ""
      ? ""
      : typeof panelTitle === "string"
        ? `${panelTitle}: ${statusLabel}`
        : `Status: ${statusLabel}`;
  // `undefined`, not `null`: a null child would still render the padded aside box.
  const aside =
    panelAside === undefined &&
    statusBadge === null &&
    badgePills === null &&
    !hasActionAugments ? undefined : (
      <>
        {panelAside}
        {/* Controls come ahead of the readout badges. */}
        {hasActionAugments && (
          <AugmentSlot segment="actions" props={NO_SEGMENT_PROPS} />
        )}
        {badgePills}
        {statusBadge}
      </>
    );

  /*
   * With sections, the universal `sections` augment segment moves inside the
   * grid, so an Uplink's section flows into a column beside the host's own.
   * `AugmentSlot` renders a fragment, so each bound augment is its own grid item.
   */
  const isInactive = inactive !== undefined;
  const sectionNodes = isInactive
    ? []
    : Children.toArray(sections as ReactNode);
  const hasSections = sectionNodes.length > 0;
  /* The body is one framed drawing and nothing else: no hand-composed children,
     no bound sections augment (it would add content beside the frame), not
     fitToSize, and the one section is a filling one holding only a frame. */
  const loneFrame =
    children === undefined &&
    !(panelSections && hasSectionAugments) &&
    !fitToSize &&
    sectionNodes.length === 1 &&
    holdsOnlyAFrame(sectionNodes[0]);
  /*
   * A filling section is lifted out of the grid into the body, the box that
   * knows the leftover height, since no grid row can be named for it. The
   * ordinary sections either side become grids of their own, keeping authored
   * order. Off under `fitToSize`.
   */
  const runs: { fill: boolean; nodes: ReactNode[] }[] = [];
  for (const node of sectionNodes) {
    const fill =
      !fitToSize &&
      isValidElement<{ fill?: boolean }>(node) &&
      node.props.fill === true;
    const open = runs.at(-1);
    if (!fill && open !== undefined && !open.fill) open.nodes.push(node);
    else runs.push({ fill, nodes: [node] });
  }
  /* The universal segment lands in the last grid; a body whose every section fills gets one opened for it. */
  if (panelSections && hasSections && !runs.some((run) => !run.fill)) {
    runs.push({ fill: false, nodes: [] });
  }
  const augmentRun = panelSections
    ? runs.reduce((last, run, i) => (run.fill ? last : i), -1)
    : -1;
  /* How many sections take a column, which floors the grid's track width. */
  const flowingIn = (nodes: ReactNode[]) =>
    Math.max(
      1,
      nodes.filter(
        (node) =>
          !(
            isValidElement<{ full?: boolean }>(node) && node.props.full === true
          ),
      ).length,
    );
  const sectionRuns: ReactNode[] = [];
  for (const run of runs) {
    const index = sectionRuns.length;
    if (run.fill) {
      /* A filling section is never coalesced, so its run is exactly one node. */
      sectionRuns.push(run.nodes[0]);
      continue;
    }
    sectionRuns.push(
      <PanelSections__Grid
        key={`sections-${index}`}
        $min={sectionMinWidth}
        $columns={flowingIn(run.nodes)}
      >
        {run.nodes}
        {index === augmentRun && <WidgetSections />}
      </PanelSections__Grid>,
    );
  }
  const content = isInactive ? (
    <PanelInactiveBody reason={inactive} />
  ) : !hasSections ? (
    children
  ) : (
    <>
      {children}
      {sectionRuns}
    </>
  );

  const body = (
    <PanelBody
      fitToSize={fitToSize}
      loneFrame={loneFrame}
      hoverTitle={hoverTitle}
    >
      <PanelStickyTop data-panel-sticky-top="">
        <PanelDelayRail tiny={hoverTitle} />
        {!hoverTitle && (
          <PanelStickyHeader
            title={panelTitle}
            compactTitle={compactTitle}
            aside={aside}
            toolbar={toolbar}
          />
        )}
      </PanelStickyTop>
      {fitToSize ? (
        <PanelFitBody hoverTitle={hoverTitle}>{content}</PanelFitBody>
      ) : (
        content
      )}
      {panelSections && !hasSections && !isInactive && <WidgetSections />}
    </PanelBody>
  );

  return (
    <PanelProviders>
      <PanelContainer
        $railTravels
        $hoverTitle={hoverTitle}
        {...(hoverTitle
          ? {
              tabIndex: 0,
              role: "group",
              "aria-labelledby": hoverTitleId,
              "data-tiny-panel": "",
            }
          : {})}
        {...rest}
      >
        <PanelGlow railBandAbove>
          {panelSidebar === undefined || isInactive ? (
            body
          ) : (
            <PanelSplit side={sidebarSide} size={sidebarSize} railBand>
              {body}
              {/* After the body in the DOM; `sidebarSide` moves it visually only. */}
              <PanelSidebar>{panelSidebar}</PanelSidebar>
            </PanelSplit>
          )}
        </PanelGlow>
        {!isInactive && panelTrend !== undefined && (
          <PanelTrend render={panelTrend} />
        )}
        {!isInactive && panelFooter !== undefined && (
          <PanelFooter>{panelFooter}</PanelFooter>
        )}
        {hoverTitle && (
          <PanelHoverTop data-panel-hover-title="">
            <PanelHoverTitlePill as="h3" id={hoverTitleId}>
              {panelTitle}
            </PanelHoverTitlePill>
            {aside !== undefined && <PanelHoverAside>{aside}</PanelHoverAside>}
          </PanelHoverTop>
        )}
        {/* Mounted empty, so the first status is a change to a region already watched; outside the aside, so collapsing does not unmount it. */}
        <LiveRegion visuallyHidden>{statusAnnouncement}</LiveRegion>
      </PanelContainer>
    </PanelProviders>
  );
}

/** The one body an inactive panel draws: the reason, centred, announced politely. */
function PanelInactiveBody({ reason }: { reason: PanelInactiveReason }) {
  const { reason: message, hint } =
    typeof reason === "string" ? { reason, hint: undefined } : reason;
  return (
    <PanelInactive__Body role="status" aria-live="polite">
      <PanelInactive__Reason>{message}</PanelInactive__Reason>
      {hint !== undefined && <PanelInactive__Hint>{hint}</PanelInactive__Hint>}
    </PanelInactive__Body>
  );
}

const PanelInactive__Body = styled.div`
  flex: 0 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--gap-caption);
  text-align: center;
  padding: var(--inset-refusal);
`;

const PanelInactive__Reason = styled.div`
  color: var(--color-text-muted);
  font-size: var(--font-size-caption);
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
`;

const PanelInactive__Hint = styled.div`
  color: var(--color-text-faint);
  font-size: var(--font-size-caption);
  letter-spacing: 0.04em;
`;

/**
 * Whether a section is a filling `Section` whose whole content is one
 * `FramedDisplay`, reached through plain elements and fragments that each hold
 * only the next.
 */
function holdsOnlyAFrame(section: ReactNode): boolean {
  if (!isValidElement<{ fill?: boolean; children?: ReactNode }>(section)) {
    return false;
  }
  if (section.type !== Section || section.props.fill !== true) return false;
  let node: ReactNode = section.props.children;
  for (;;) {
    const only = Children.toArray(node);
    if (only.length !== 1) return false;
    const [child] = only;
    if (!isValidElement<{ children?: ReactNode }>(child)) return false;
    if (child.type === FramedDisplay) return true;
    if (child.type !== Fragment && typeof child.type !== "string") return false;
    node = child.props.children;
  }
}

/**
 * The frame every widget draws in: a bordered surface with a pinned header
 * (title plus a right-hand aside of controls and badges), a scrolling body
 * with a glow at whichever edge has more to scroll to, and optional toolbar,
 * sidebar, trend strip and footer. Give it content through `sections`: each
 * entry is normally a `Section`, and the panel flows them down one column in
 * a portrait tile and across two or three in a landscape one. A `Section fill`
 * takes the height left over. The panel also reserves a strip above the
 * header for the delay rail, which shows this widget's commands in flight.
 *
 * The header aside holds, in order, `panelAside`, the `actions` augments,
 * the badges (the widget's own `panelBadges`, then contributed ones), and a
 * status badge for the worst of the panel's reported states. When the title
 * and aside no longer fit side by side, the aside collapses to one status dot
 * per severity plus a toggle that opens it.
 *
 * ## Standard slots
 *
 * Every widget drawn in a `Panel` carries three extension slots without
 * declaring them, each named `${componentId}.<segment>` after the widget's
 * registered id (`"crew-status.badges"`, for example):
 *
 * - `${componentId}.sections`: an augment slot, bound with `registerAugment`.
 *   Each augment renders after everything the widget draws in its body; when
 *   the widget passes `sections`, each augment is its own item in the last
 *   section grid, so returning a `Section` flows it into a column beside the
 *   widget's own. Its component gets no props. A widget can move the slot with
 *   {@link WidgetSections} and `panelSections={false}`
 * - `${componentId}.actions`: an augment slot for controls in the header
 *   aside, after `panelAside` and before the badges. Its component gets no
 *   props. Nothing is reserved for it while nothing is bound
 * - `${componentId}.badges`: a contribution slot, filled with an Uplink
 *   handle's `registerContribution`, whose `compute` returns `BadgeEntry`
 *   items (`id`, `label`, `tone`, and an optional `held` grade). The panel
 *   draws them after the widget's own `panelBadges`, dropping any whose id the
 *   widget already uses. A held entry shows its grade's word in place of its
 *   label (see {@link badgeFace}), and any entry with a tone other than
 *   `neutral` also feeds the panel's status summary
 *
 * An augment in `sections` or `actions` renders only while the Domain named in
 * its `requires` is present, and a badge contribution computes only while its
 * `requires` Domain is present, so an Uplink whose mod is not running leaves
 * the widget unchanged. An augment reads its own Topics; for what the widget
 * is focused on, it reads the widget's scope with `useWidgetScope`. The
 * segment lists are {@link FRAMEWORK_AUGMENT_SEGMENTS} and
 * {@link FRAMEWORK_CONTRIBUTION_SEGMENTS}.
 *
 * ## Parts
 *
 * `Panel` renders its parts and draws no markup of its own, so a widget can
 * compose a variant by hand from `Panel.Container` (the bordered frame),
 * `Panel.Context` (links the body's scroller to the glow), `Panel.Delay` (the
 * delay rail), `Panel.Header`, `Panel.Title`, `Panel.Toolbar`, `Panel.Glow`,
 * `Panel.Body` (the scrolling, inset content box), `Panel.Section`,
 * `Panel.Sidebar` and `Panel.Footer`.
 *
 * @example
 * A typical widget body:
 * ```tsx
 * <Panel
 *   panelTitle="Fuel Status"
 *   compactTitle="Fuel"
 *   panelBadges={lowFuel ? [{ id: "low", label: "Low", tone: "warn" }] : undefined}
 *   panelFooter={
 *     <Text>
 *       Total <Unit value={total} />
 *     </Text>
 *   }
 *   sections={[
 *     <Section key="stages" title="Stages">
 *       <StageList stages={stages} />
 *     </Section>,
 *     <Section key="tanks" title="Tanks">
 *       <TankList tanks={tanks} />
 *     </Section>,
 *   ]}
 * />
 * ```
 *
 * @example
 * An Uplink adding a section and a header badge to another widget through its
 * standard slots:
 * ```tsx
 * import {
 *   defineUplinkClient,
 *   registerAugment,
 *   useTelemetry,
 * } from "@ksp-gonogo/sitrep-sdk";
 * import { Section, Text, Unit } from "@ksp-gonogo/ui-kit";
 *
 * export const EXAMPLE = defineUplinkClient({
 *   id: "example",
 *   version: "0.0.1",
 *   name: "Example",
 * });
 *
 * function CadenceSection() {
 *   const heartbeat = useTelemetry("example.heartbeat");
 *   if (heartbeat.state !== "observed") return null;
 *   return (
 *     <Section title="Example">
 *       <Text>
 *         Last beat at UT <Unit value={heartbeat.value.ut} />
 *       </Text>
 *     </Section>
 *   );
 * }
 *
 * registerAugment({
 *   id: "example-cadence-section",
 *   augments: "space-center-status.sections",
 *   requires: "example",
 *   channels: ["example.heartbeat"],
 *   component: CadenceSection,
 *   owner: EXAMPLE,
 * });
 *
 * EXAMPLE.registerContribution({
 *   id: "cadence-badge",
 *   contributes: "space-center-status.badges",
 *   deps: ["example.heartbeat"],
 *   requires: "example",
 *   compute: (topics) =>
 *     topics["example.heartbeat"]
 *       ? [{ id: "cadence", label: "Publishing", tone: "info" }]
 *       : null,
 * });
 * ```
 *
 * @category Panel
 */
export const Panel = Object.assign(PanelRoot, {
  Context: PanelContextProvider,
  Delay: PanelDelayRail,
  Container: PanelContainer,
  Header: PanelHeader,
  Toolbar: PanelToolbar,
  Footer: PanelFooter,
  Title: PanelTitle,
  Glow: PanelGlow,
  Body: PanelBody,
  Section,
  Sidebar: PanelSidebar,
});
