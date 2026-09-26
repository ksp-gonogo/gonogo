import type { StreamStatusValue } from "@ksp-gonogo/sitrep-sdk";
import {
  Children,
  type ComponentPropsWithoutRef,
  createContext,
  forwardRef,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styled, { css } from "styled-components";
import { AugmentSlot, useWidgetSegmentBound } from "./AugmentSlot";
import { Badge } from "./Badge";
import { PanelDelayRail } from "./CommandDelay/PanelDelayRail";
import { fitBox, fitMask } from "./fitBox";
import { focusRing } from "./focusRing";
import { LiveRegion } from "./LiveRegion";
import { type BadgeEntry, usePanelBadgesContext } from "./PanelBadges";
import { SECTION_FILL_ATTR, SECTION_FULL_ATTR, Section } from "./Section";
import { formatStreamStatus } from "./StreamStatusBadge";
import { PanelStatusDot } from "./status/PanelStatusDot";
import type { StatusSummary } from "./status/PanelStatusStore";
import {
  severityFromBadgeEntryTone,
  severityFromStreamStatus,
} from "./status/severity";
import { useStatusBreakdown } from "./status/useStatusBreakdown";
import { useStatusContribution } from "./status/useStatusContribution";
import { useStatusSummary } from "./status/useStatusSummary";
import { titleText } from "./titleText";
import { useElementSize } from "./useElementSize";
import { useFittedTitle } from "./useFittedTitle";
import { PanelAsideSizeProvider, useHeaderAsideFit } from "./usePanelAsideSize";

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
 * hand-composed panel can too. The delay-rail store is not here: a widget calls
 * `usePanelDelay` above the `<Panel>` it returns, so that store is provided
 * above the widget.
 */
export function PanelProviders({ children }: { children?: ReactNode }) {
  return <PanelContextProvider>{children}</PanelContextProvider>;
}

/**
 * What a `Section fill` resolves to inside the box that owns the leftover
 * height. A content basis (not `flex: 1`) lets two filling sections keep their
 * own heights and split only the spare room. It still shrinks, so a drawing
 * sized from a ResizeObserver can give room back.
 */
const SECTION_FILL_RULE = `
  & > [${SECTION_FILL_ATTR}] {
    flex: 1 1 auto;
    min-height: 0;
  }
`;

export const PanelContainer = styled.div<{ $railTravels?: boolean }>`
  /* Chrome only. The inset belongs to Panel.Body and the glow to Panel.Glow;
     this is the border, the surface and the clip, and nothing else. */
  background: var(--color-surface-panel);
  /* A size-query container so the popped-open aside expand box (see
     PanelAsideExpand) can size itself in cqw against the panel's own width
     rather than the viewport's. The aside's collapse decision itself is no
     longer an @container condition on this box (see useHeaderAsideFit in
     usePanelAsideSize.ts): a fixed width threshold here was content-blind,
     collapsing a short-title widget with room to spare just because the panel
     itself was narrow. This declaration stays for the cqw unit alone. */
  container-type: inline-size;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-regular);
  /* TOP ONLY, and it is the delay rail's band. Every widget reserves the same
     strip at its own top edge so that a command going in flight draws into
     room that was already standing there, rather than pushing the title down
     or borrowing the header's space, which is what the two earlier rails did.
     The band is the widget's top padding whether or not that widget has a
     command to show, because a consistent place to look is the point.

     The sides and the bottom stay at ZERO, deliberately: that is what lets
     visual content (charts/maps/gauges/plots) be placed outside the body and
     reach the chrome, and what lets a hand-composed panel get the same result
     as Panel without having to cancel a container padding. A uniform inset
     here would break every full-bleed widget. The remaining inset is
     Panel.Body's.

     Its 16px is the panel gutter's width, and it clears what the
     collapsed rail actually has to draw. No design document states a budget for
     this band (the "7px" and "16px" in the delay-UX docs describe a dot slider
     and the drag bar respectively, neither of which is this), so the check is:

     - the discrete grazing-glow strip is comfortable: its viewBox is 16 units
       tall and the blip's centre sits 4 units ABOVE the top edge with radius 9,
       so only the top ~5 units carry ink at all
     - the outcome summary ("3 commands failed") is the tallest thing the strip
       ever renders, at --font-size-xs: 11px normally and 12px on a coarse
       pointer. At the body line height that is a 16.8px line box on a Steam
       Deck, which 16px would clip, so the summary takes the flush line box
       instead (see PanelDelayRail__Summaries). It is single-line chrome text,
       which is exactly what --line-height-flush is for, and PanelTitle already
       uses it for the same reason
     - the stream sparkline would happily take more. Its viewBox is 30 units
       tall, stretched, so 16px scales it by 0.53 and its 0.8-unit trace lands
       at 0.43 device px, under one pixel. Rather than tax every widget forever
       for the one case, the rail variant scales its own stroke widths back up
       (see ControlDelayStream); below about 12px even that fails, the plot
       band falling under 10px where a full 0..1 excursion stops being
       distinguishable from a flat line */
  padding: var(--panel-rail-band) 0 0;
  /* Given back when the rail TRAVELS WITH THE HEADER (see PanelStickyTop): the
     band is then the first row of the sticky unit inside the body scroller, so
     reserving it here as well would stand two bands at the panel's top edge.
     The band itself is unchanged in size and in permanence, only in which box
     holds it open; every other panel shape (headless, floating header,
     hand-composed) still reserves it right here. A raw backtick in the CSS
     text of a styled template, a comment included, ends the template and
     builds an empty dist. */
  ${({ $railTravels }) => ($railTravels ? "padding-top: 0;" : "")}
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
  /* A headerless panel puts its sections straight in here, so this is the box
     with the leftover height for them. */
  ${SECTION_FILL_RULE}
`;

const PanelTitle__Box = styled.h3`
  margin: 0;
  /* No top inset: PanelHeader__Row carries the header's, so a panel whose
     header is its first element pays for it once, in the panel, rather than
     once here and again in the aside beside it. */
  padding: var(--inset-panel-header);
  ${titleText}
  /* Flush, not the browser's metrics-based "normal": this is single-line
     chrome text (never wraps, see white-space below), exactly the case
     --line-height-flush documents ("collapses the line box so an icon or a
     one-character button centres in a fixed height"). Left at "normal", the
     line box carries descender headroom this all-caps title never uses, so
     the glyphs visually ride higher than the box's own geometric centre.
     PanelHeader__Row's align-items:center centres the dots/chevron summary
     against that geometric centre, which is math-exact against the box but
     reads as too LOW against the glyphs sitting above it. Flush shrinks the
     line box down to the font's own metrics and removes most of that
     unused headroom, closing the gap between the two centres. */
  line-height: var(--line-height-flush);
  /* One line, always. A long title (a widget name plus context, e.g. a
     Strategies aside label) allowed to wrap to a second line pushes the
     chevron/aside down with it and breaks the "aside never drops to its own
     row" invariant PanelHeader__Row already enforces on the OTHER side of the
     row. min-width:0 lives on PanelHeader__Titles (the flex item), which is
     what lets this actually shrink and truncate instead of forcing the row
     wider. */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

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
      <PanelTitle__Box
        {...rest}
        ref={(node: HTMLHeadingElement | null) => {
          own.current = node;
          if (typeof forwarded === "function") forwarded(node);
          else if (forwarded) forwarded.current = node;
        }}
        aria-label={compacted ? full : undefined}
        title={compacted ? full : undefined}
      >
        {index === 0 ? children : forms[index - 1]}
      </PanelTitle__Box>
    );
  },
);

/** Stable, so a title with no compact forms does not hand the fit hook a fresh array each render. */
const EMPTY_COMPACT: readonly string[] = [];

const PanelHeader__Row = styled.div<{ $overlay?: boolean }>`
  /* The row owns the header's TOP inset, which its two boxes used to carry one
     each. A hand-composed header still needs it, since nothing guarantees it is
     the first thing in its panel. PanelStickyHeader takes it away again: inside
     a Panel the header IS guaranteed to be first, under the delay rail's
     reserved band, and that band is the panel's top padding.

     NOT in the overlay case, where it goes back on the boxes (see
     OVERLAY_TITLE_ROW_INSET). A floating header's inset is not spacing, it is
     the reach of the opaque backing that keeps the drawing underneath from
     reading through the title, and a row-level inset leaves that top strip
     transparent: OrbitView's frame caption showed through it. */
  padding-top: ${({ $overlay }) => ($overlay ? "0" : "var(--inset-panel-header-top)")};
  display: flex;
  /* Centre, not flex-start: the title is single-line and truncates
     rather than wrapping (see PanelTitle's overflow rules below), so its box
     height is a fixed one-line measure and there is no second line that
     could ever push a top-aligned aside out of register. With that settled,
     centring is what actually levels the collapsed dot row + chevron on the
     title's own text line; top-aligning them leaves the dots sitting visibly
     lower, since PanelTitle's line-height gives the glyphs some headroom
     above the box's top edge that the dots (a fixed box with none) do not
     share. */
  align-items: center;
  justify-content: space-between;
  gap: var(--gap-panel-header);
  min-width: 0;
  /* Wrapping is what gives PanelToolbar its own line: the toolbar asks for a
     full flex-basis, which only starts a new line in a wrapping row. Under
     nowrap that request became "100% of the row, BESIDE the title", so the
     title (min-width:0) was crushed to a few pixels and the toolbar spilled out
     of the panel. Map View rendered its title as "M." under the Follow toggle.

     The aside still never reaches a second row, and does not need nowrap to
     stay put: the title column absorbs all the pressure first (min-width:0,
     while the aside is flex-shrink:0), and useHeaderAsideFit's measured-fit
     collapse drops the aside to its status dots before it could ever be the
     item that no longer fits. */
  flex-wrap: wrap;
  /* Never shrink: at very short widget heights the flex column would squeeze
     the header toward zero and the body would overprint the title. */
  flex-shrink: 0;
  /* Overlay: the header stops reserving a row and floats over the content, so
     a map/plot/globe fills the whole tile and the title sits on top of its
     quiet corner. Anchors to PanelGlow__Root, which is already positioned.
     The row itself goes transparent to hit-testing (see OVERLAY_BOX). */
  ${({ $overlay }) =>
    $overlay
      ? `position: absolute;
         top: 0;
         left: 0;
         right: 0;
         pointer-events: none;
         /* Local sibling ordering inside the panel's own stacking context,
            the same rung the scroll glow uses and for the same reason: it is
            widget-internal, so it stays off the app-global z ladder. */
         z-index: 1;`
      : ""}
`;

/**
 * Backing for the two header boxes (not the row) when the header floats, so the
 * drawing shows through the gap between them. Each box takes back the pointer
 * events the full-width row gives up to keep drags reaching the content.
 */
const OVERLAY_BOX = `
  background: var(--color-surface-panel);
  pointer-events: auto;
`;

/** A floating header's top inset lives on the boxes, so the opaque backing reaches above the glyphs. */
const OVERLAY_TITLE_ROW_INSET = `padding-top: var(--inset-panel-header-top);`;

const PanelHeader__Titles = styled.div<{ $overlay?: boolean }>`
  min-width: 0;
  /* Grow into the room the row is not using, as well as shrinking out of the
     room it does not have. Shrink alone leaves this box hugging its text, and
     a title box the width of its own text cannot answer "would a longer form
     fit here": that is the measurement useFittedTitle makes, and the number
     it needs is the room available rather than the room taken. Nothing moves
     visually, the title is left-aligned in a box with no background of its
     own; the aside was already pushed right by the row's space-between. */
  flex: 1 1 auto;
  ${({ $overlay }) => ($overlay ? OVERLAY_BOX + OVERLAY_TITLE_ROW_INSET : "")}
`;

const PanelHeader__Aside = styled.div<{ $overlay?: boolean }>`
  display: flex;
  align-items: center;
  gap: var(--gap-panel-aside);
  /* Shrink to its content and sit right-aligned on the title's row. It never
     grows to a full row and never wraps: an aside that stops fitting collapses
     to the dots (the measured-fit collapse on PanelAsideExpand), it does not
     spill onto a second row. flex-shrink 0 keeps it intact; the title column
     yields the space (its min-width 0). */
  justify-content: flex-end;
  flex-shrink: 0;
  /* PanelTitle owns the left inset and the bottom rhythm; mirror both here so
     the badges line up with the title rather than the panel edge. The top is
     the row's, shared by both boxes. */
  padding: var(--inset-panel-header);
  ${({ $overlay }) => ($overlay ? OVERLAY_BOX + OVERLAY_TITLE_ROW_INSET : "")}
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
  /* ::details-content is the browser-native pseudo-element (shipped Chrome
     131, present in every engine the visual gate now runs) that wraps a
     details element's non-summary children, added upstream so the
     open/close transition has a box to animate block-size on. It generates
     its OWN box with its OWN sizing, which breaks the shrink-to-fit chain
     this element relies on for BOTH states: confirmed live, this element
     collapsed to a few px regardless of its [data-panel-aside-full] child's
     real width, in the WIDE case too (not just collapsed), pushing the
     (still correctly sized, merely mispositioned) aside almost entirely off
     the panel to the right. display: contents removes that box from layout,
     so this element's own intrinsic sizing is computed straight off
     [data-panel-aside-full] again, the behaviour every comment in this file
     already assumed. We don't animate the open/close transition, so losing
     that box costs nothing. */
  &::details-content {
    display: contents;
  }
  /* Shrink to its content: the aside sits right-aligned on the title row and
     never grows to a full row, so
     the box is exactly its content wide, inline when there is room and the
     dots + caret summary when the measured-fit collapse fires. */
  flex: 0 0 auto;

  & > summary {
    /* Wide default: no collapsed affordance, the aside just shows inline. */
    display: none;
    align-items: center;
    gap: var(--gap-panel-aside);
    list-style: none;
    cursor: pointer;
    /* Nudge the whole summary up 1px so the dots' circle centre lands on the
       title's CAP-BAND centre rather than the title line box centre: measured
       (Playwright, in the collapsed review render) the row's align-items:center
       leaves the dots ~1px below the caps, since the flush line box still keeps
       a hair of descender headroom the all-caps title never fills. Fixed chrome
       (font-size-xs, 16px dots) so this offset is constant across widgets. */
    transform: translateY(-1px);
    /* The chevron below is drawn from currentColor borders, and nothing
       between here and the document root sets one: Panel deliberately
       carries no default foreground (see the "Color is intentionally not
       set" note in app/src/styles/global.css, every panel/component owns
       its own), so an unset currentColor resolved to the UA default black,
       an invisible chevron on the dark theme. Same dim token PanelTitle
       uses, so the affordance reads as chrome beside the title rather than
       a colour of its own. */
    color: var(--color-text-dim);
  }
  & > summary {
    ${focusRing}
  }
  & > summary::-webkit-details-marker {
    display: none;
  }
  & > summary [data-panel-aside-chevron] {
    /* A CSS caret, not an icon element: keeps the header out of every widget's
       SVG query surface and keeps the DOM snapshot light. Points down closed. */
    flex: 0 0 auto;
    width: 6px;
    height: 6px;
    /* On top of summary's own gap (the even spacing between dots), an extra
       margin ONLY here doubles the visual gap between the last dot and the
       chevron specifically, without opening up the gap BETWEEN dots (a
       uniform bigger gap would do both). Needed because the layout gap
       alone reads tighter than its nominal value: the 45deg rotation below
       turns this 6x6 box into a diamond whose corner points left of its own
       un-rotated layout edge, so the rendered chevron encroaches on the
       gap ahead of it by about a fifth of the diameter. */
    margin-left: var(--gap-panel-aside);
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    /* The visible ink (the two borders forming an L) has its centroid toward
       the box's bottom-right corner; rotate(45deg) swings that centroid to
       ~1.4px BELOW the box centre, so the drawn chevron reads low against the
       dots. Lift it 1.4px (on top of the summary's own -1px) so the chevron's
       ink centre coincides with the dot circles and the title cap band. */
    transform: translateY(-1.4px) rotate(45deg);
    transition: transform var(--duration-base) var(--ease-standard);
  }
  &[open] > summary [data-panel-aside-chevron] {
    /* Points up when open: the rotation swings the ink centroid the other way
       (above centre), so the compensating lift flips sign to keep it centred. */
    transform: translateY(1.4px) rotate(225deg);
  }

  & > [data-panel-aside-full] {
    /* Wide default: the full aside shows inline regardless of the [open] state,
       so a wide panel reads exactly like a plain aside row. */
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
      /* Collapsed + closed: pulled out of the row's visible flow, but kept
         visibility: hidden rather than display: none, so it stays reachable
         to useHeaderAsideFit's clone-based re-measurement (see
         measureNaturalElementWidth in usePanelAsideSize.ts) exactly the same
         as the wide/inline state, rather than a display:none box being a
         special case the measurement would need to route around. */
      &:not([open]) > [data-panel-aside-full] {
        position: absolute;
        top: 0;
        right: 0;
        visibility: hidden;
        pointer-events: none;
      }
      /* Collapsed + open: the full aside floats over the body in a glow-backed
         box, the same surface + border language as the sticky header, so the
         controls it holds do not push the panel layout around. */
      &[open] > [data-panel-aside-full] {
        position: absolute;
        top: calc(100% + var(--offset-popover));
        right: 0;
        /* Local sibling ordering inside the panel's own stacking context: lift the
           popped box over the header's overlay (2) and the body beneath it. Not
           app-global chrome, so no named z rung. */
        z-index: 3;
        flex-direction: column;
        align-items: stretch;
        justify-content: flex-start;
        flex-wrap: nowrap;
        /* A real floor so a control (e.g. a Select) has room and is not squeezed
           to its shrink-to-nothing min-content, capped at the panel width so it
           never overflows a very narrow tile. */
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
  overlay,
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
  /**
   * Float the header over the content instead of reserving a row above it.
   * Pair with a `Panel.Body bleed`, which is what `Panel floatingHeader` does.
   */
  overlay?: boolean;
}) {
  const breakdown = useStatusBreakdown();

  // `rowRef` is the room available to title and aside together; `titleRef` and `asideFullRef` are what they need. jsdom never measures, so it always sees the wide default.
  const rowRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const asideFullRef = useRef<HTMLDivElement>(null);
  const collapsed = useHeaderAsideFit(rowRef, titleRef, asideFullRef);

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
    <PanelHeader__Row
      ref={rowRef}
      data-panel-header=""
      $overlay={overlay}
      {...rest}
    >
      <PanelHeader__Titles $overlay={overlay}>
        {title !== undefined && (
          <PanelTitle ref={titleRef} compact={compactTitle}>
            {title}
          </PanelTitle>
        )}
      </PanelHeader__Titles>
      {aside !== undefined && (
        <PanelHeader__Aside $overlay={overlay}>
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
                      .map((e) => `${e.count} ${e.severity}`)
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
      {toolbar !== undefined && (
        <PanelToolbar $overlay={overlay}>{toolbar}</PanelToolbar>
      )}
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
export const PanelToolbar = styled.div<{ $overlay?: boolean }>`
  ${fitBox("panel-toolbar")}
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--gap-control-row);
  /* Mirrors the header's horizontal inset so controls line up with the title
     above them, and carries only a bottom gap of its own: the header already
     paid the top inset. */
  padding: var(--inset-panel-header);
  min-width: 0;
  /* Same reason as the header row: at short tile heights the flex column would
     otherwise squeeze the controls toward zero. */
  flex-shrink: 0;
  /* A full basis inside the wrapping header row, so the toolbar always takes a
     line of its own below the title rather than competing with the aside for
     the first one. Living inside that row (rather than beside it) is what makes
     it float correctly under an overlay header instead of colliding with it. */
  flex-basis: 100%;
  width: 100%;
  ${({ $overlay }) => ($overlay ? OVERLAY_BOX : "")}
`;

/**
 * A panel body is the default density tier, and re-declares both steppable gap
 * names so a panel nested inside a compact `Card` does not inherit the card's
 * density.
 */
const PanelBody__Box = styled.div<{ $fitToSize?: boolean; $bleed?: boolean }>`
  --gap-related: var(--gap-related-comfortable);
  --gap-section: var(--gap-section-comfortable);

  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  padding: var(--inset-panel-body);
  /* Body IS the scroller. It owns overflow so that Panel.Glow can own only the
     glow; the inset therefore sits INSIDE the scrolling box, which is what
     stops overflow content being clipped by the padding. */
  overflow: auto;
  /* The glow communicates scroll state, so the native bar is redundant.
     Wheel, trackpad and keyboard scrolling all still work. */
  scrollbar-width: none;
  -ms-overflow-style: none;
  &::-webkit-scrollbar {
    width: 0;
    height: 0;
    display: none;
  }
  /* Fit-to-size content is sized to the tile and never scrolls. It lives here
     rather than on Panel so that hand-composing the same arrangement gives the
     same result: a top-level prop that changed WHICH subcomponents render
     would not be reproducible.

     It CENTRES, but only once measurement says the content fits, and that
     decision arrives as a prop rather than from CSS alone. Two routes were
     tried and rejected first:

       - plain centring is not an option. An overflowing flex column centred the
         ordinary way overflows at BOTH ends, so its first line sits at a
         negative offset and cannot be scrolled to
       - justify-content: safe center is specified to fix exactly that, and all
         three engines honour it in isolation (measured: plain centring puts the
         first child at -40px on chromium, firefox and webkit; safe puts it at
         0). Firefox STILL clipped the real widget at tiny-2x2

     So do not reach for @supports here either. FIREFOX REPORTS SUPPORT AND THEN
     PRODUCES THE WRONG LAYOUT, which makes a feature query a guard whose failure
     is indistinguishable from success: it would ship the bug while looking like
     a safeguard.

     Measuring sidesteps the whole disagreement: content that does not fit is
     never centred in the first place, so no engine is being asked to do the
     thing they do differently. The rule it enforces is that a tiny tile is
     never centred-and-clipped, because an unreachable first line reads as the
     widget rendering less rather than as content to scroll to.

     The wider lesson, because it cost a build: verifying a CSS FEATURE in
     isolation is not evidence about the LAYOUT built on it. This is verified by
     rendering the widgets on all three engines, not by probing the property. */
  ${({ $fitToSize }) => ($fitToSize ? "flex: 1; overflow: hidden;" : "")}
  /* Bleed: the content reaches the panel chrome on every side and never
     scrolls.

     This is the flag FramedDisplay exists to avoid, and it is deliberately
     NOT reachable on its own. Cancelling the body inset is wrong for the
     widget that is a diagram BESIDE readouts, because it unpads the readouts
     too, and a standalone opt-out is the version a mixed widget reaches for.
     That is not hypothetical: OrbitView once shipped unpadded data fields
     next to its chart that way, and a bleedBody prop on Panel reproduced it
     on MapView within a day of FramedDisplay landing, unpadding the augment
     sections under the map.

     So the only route here is floatingHeader, which no mixed widget wants:
     you would not float a title over a list. Visual content in a mixed widget
     goes in a FramedDisplay inside the ordinary padded body. */
  ${({ $bleed }) =>
    $bleed ? "flex: 1; overflow: hidden; padding: 0; gap: 0;" : ""}
  ${SECTION_FILL_RULE}
`;

/**
 * The content box, the inset, and the scrolling. Registers itself with the
 * panel context so `Panel.Glow` can observe it without reaching into the tree.
 */
export function PanelBody({
  children,
  fitToSize,
  bleed,
  ...rest
}: ComponentPropsWithoutRef<"div"> & {
  fitToSize?: boolean;
  bleed?: boolean;
}) {
  const ctx = useContext(PanelCtx);
  const register = ctx?.registerScroller;
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      register?.(el);
    },
    [register],
  );
  return (
    /* `data-panel-body` is a stable targeting hook for the scroller's visible height. */
    <PanelBody__Box
      ref={ref}
      data-panel-body=""
      $fitToSize={fitToSize}
      $bleed={bleed}
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
  /* Wider between columns than between rows: the column gap is the only thing
     separating two unrelated sections that now sit side by side, where the row
     gap has a section title under it doing some of that work. */
  gap: var(--gap-panel-sections) var(--gap-panel-columns);
  /* Sections keep their natural height rather than stretching to the tallest in
     the row. A three-row section stretched to match a ten-row neighbour reads as
     a box with a large empty bottom, which is exactly the wasted space this is
     meant to reclaim. */
  align-items: start;
  & > [${SECTION_FULL_ATTR}] {
    grid-column: 1 / -1;
  }
`;

/**
 * The tiny-tile layout: fills the space left under the header and centres the
 * widget's content in it, but only while measurement says the content fits.
 * Wraps the children alone, so the header is neither centred nor measured.
 */
function PanelFitBody({ children }: { children?: ReactNode }) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const fits = useContentFits(outerRef, innerRef);
  return (
    <PanelBody__FitOuter ref={outerRef} $fits={fits} data-panel-fit-body="">
      <PanelBody__FitContent ref={innerRef} $fits={fits}>
        {children}
      </PanelBody__FitContent>
    </PanelBody__FitOuter>
  );
}

const PanelBody__FitOuter = styled.div<{ $fits?: boolean }>`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  /* Does NOT clip, and that is measured rather than assumed. At tiny-2x2 this
     box resolves to 11px while Twr's 24px readout sits in it, overflowing 6.5px
     into the body's gap above, where nothing paints over it. That overflow is
     the shipped appearance. Clipping here cut the readout in half; the body
     above already owns the real boundary, the panel edge.

     No inset of its own either, and both halves of that were measured.
     Tightening the BODY moved the title 12px left, because the header is the
     body's child too. Adding 4px HERE instead cost Twr the vertical room its
     24px readout needs and clipped it in half: the local box this replaces had
     no padding, and a tiny tile has no spare room to give away. The body's own
     inset is the inset. */
  ${({ $fits }) =>
    $fits ? "justify-content: center;" : "justify-content: flex-start;"}
`;

const PanelBody__FitContent = styled.div<{ $fits?: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  /* Aligned the same way as the box around it. Squeezed to the box, this is
     where content taller than the box overflows, so centring here would push
     the first line up under the header whatever the box does. */
  ${({ $fits }) =>
    $fits ? "justify-content: center;" : "justify-content: flex-start;"}
  gap: var(--gap-tiny-content);
  min-height: 0;
  /* A query container, so a tiny presentation can size its headline against the
     tile with cqw units. SpaceCenterStatus already did exactly this from its own
     local box, and the readout it feeds resolves against the SMALL VIEWPORT when
     no container ancestor exists, so dropping it does not degrade, it produces a
     font sized off the screen. Owning it here is the difference between the one
     widget that thought of it and every widget getting it. */
  container-type: inline-size;
`;

/**
 * Whether the content currently fits its box, so a tiny tile can centre only
 * when centring cannot push the first line out of reach. Measured because
 * Firefox clips `safe center` in practice.
 *
 * Centred overflow splits evenly above and below; the part above may use only
 * `roomAbove` before it becomes unscrollable, so content fits while it is no
 * taller than the box plus twice that room. True when there is nothing to
 * measure.
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
      setFits(
        contentFitsCentred(
          contentExtent(content),
          box.clientHeight,
          roomAbove(box),
        ),
      );
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
 * The room centred content may overflow into above its box. Under the header,
 * that is the body's gap plus the empty inset at the foot of the title, which
 * the transparent header draws nothing in. As the body's first child, it is
 * the body's top padding.
 */
function roomAbove(box: HTMLElement): number {
  const body = box.parentElement;
  if (!body) return 0;
  const style = getComputedStyle(body);
  const above = box.previousElementSibling;
  if (above === null) return Number.parseFloat(style.paddingTop) || 0;
  const title = above.querySelector("[data-panel-header] h3");
  const titleFoot = title ? getComputedStyle(title).paddingBottom : "0";
  return (
    (Number.parseFloat(style.rowGap) || 0) + (Number.parseFloat(titleFoot) || 0)
  );
}

/**
 * Whether content of `content` height, centred in a box `box` tall, keeps its
 * top edge within `room` of the box's top.
 */
export function contentFitsCentred(
  content: number,
  box: number,
  room: number,
): boolean {
  return content <= box + 2 * room;
}

const ScrollAreaRoot = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  /* Grow to fill the remaining height of a flex-column parent so the inner
     element's own flex:1 can engage overflow, instead of the outer box sizing
     to content and spilling past the panel's overflow:hidden edge. */
  flex: 1;
  min-height: 0;
`;

/**
 * Inner scroll element. Carries a stable `data-scroll-area-inner` attribute so
 * a `styled(ScrollArea)` can target it to lay out the scrolling children.
 */
const ScrollAreaInner = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
  /* Hide the native scrollbar: the glow indicators communicate scroll state.
     Trackpads/wheels still scroll; keyboard PageUp/Down/arrows still work. */
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
  /* Flush with the scroller's own edges. There is no pad-var escape hatch: the
     panel needs none because Panel.Body's inset is inside the scroller, and a
     widget that appeared to need one was really nesting a SECOND scroller as
     its whole body, whose glow then drew inside the outer body's inset.
     Deleting that nesting is the fix; four widgets had it. */
  left: 0;
  right: 0;
  ${({ $position, $topOffset }) =>
    $position === "top" ? `top: ${$topOffset ?? "0"};` : "bottom: 0;"}
  /* 44px is the container both layers fade within; each layer sets its OWN
     reach through its gradient stops below (mask ~50%, affordance ~40%).
     Height is outside the ratchet's scanned properties, so it stays a
     literal. */
  height: 44px;
  /* The audit reads how deep this actually masks out of the gradient below, so
     the height staying a literal costs it nothing. See fitMask. */
  ${fitMask("panel-scroll-glow")}
  pointer-events: none;
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  transition: opacity var(--duration-base) var(--ease-standard);
  /* TWO stacked layers, uniform on every edge (the first gradient in a
     comma-separated background paints on TOP of the later one):

     1. Affordance (top): the ~20%-lighter-than-panel tint at partial alpha,
        fading out fast (by ~40% of the reach). The subtle "there is more,
        scroll" highlight right at the boundary.
     2. Mask (bottom): var(--color-surface-panel) at FULL opacity, held solid
        across the title band (to ~27% of the box) then blurring to transparent
        by ~50%: short enough that the dark does not bleed far into the body,
        long enough to cover the title completely. FULL opacity is the
        load-bearing part. A semi-transparent tint cannot cover scrolled
        content, it ghosts it; only a fully opaque base masks it, so the sticky
        title reads over clean panel colour rather than over the content
        behind it.

     Both keep colour token-derived, so a future light theme inherits them from
     --color-surface-panel. */
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
  /* Local sibling ordering inside the panel's own stacking context (the glow
     over the scrolling element). Off the app-global z ladder on purpose: any
     named rung would lift a widget-internal overlay over dashboard chrome. */
  z-index: 1;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

/**
 * Scrolling region with glow indicators at the top and bottom edges when there
 * is content to scroll to. A panel body already scrolls and glows; use this for
 * a second scrolling region inside a widget (a sidebar list, a terminal log).
 *
 * Forwards its ref to the inner scroll element; `className` styles the root.
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

  return (
    <ScrollAreaRoot {...rest}>
      <ScrollAreaInner ref={attachInner} data-scroll-area-inner="">
        {children}
      </ScrollAreaInner>
      <ScrollOverflowGlow $position="top" $visible={overflow.top} />
      <ScrollOverflowGlow $position="bottom" $visible={overflow.bottom} />
    </ScrollAreaRoot>
  );
});

/**
 * Where the sidebar sits relative to the body, in logical terms: `end` is the
 * right edge in LTR and the left in RTL, and the trailing edge when the sidebar
 * sits under the body. `end` is the default because a sidebar is secondary
 * content and should follow the body in reading order.
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

/* Positioning context for a floating header that must cover the body track only. */
const PanelFloatHost = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
`;

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
  /* Every track is minmax(0, ...), including the flexible one. Without the
     min-0 a track floors at its content's min-content size, so a sidebar
     carrying its own ScrollArea sizes to the un-scrolled content, overflows
     the panel, and gets hard-clipped by the container's overflow:hidden
     instead of scrolling. SystemView learned this the slow way and left the
     note that this rule is copied from. */
  ${({ $axis, $side, $size }) =>
    $axis === "inline"
      ? `grid-template-columns: ${sidebarTracks($side, $size)};
         grid-template-rows: minmax(0, 1fr);`
      : `grid-template-columns: minmax(0, 1fr);
         grid-template-rows: ${sidebarTracks($side, $size)};`}

  /* Visual placement only. The sidebar is always written AFTER the body, so
     reading and tab order never depend on which edge it is drawn against, and
     it moves with the order property rather than by being emitted first. Same
     principle as the floating header, which is a paint change and not a
     structural one.

     Owned here rather than by Panel.Sidebar so exactly one place knows the
     arrangement: a split whose tracks said start beside a sidebar whose order
     said end would be a silently broken hand-composition. */
  ${({ $side }) =>
    $side === "start" ? "& > [data-panel-sidebar] { order: -1; }" : ""}

  /* The rail band, given to the sidebar track when the rail travels with the
     header. The band is the WIDGET's top inset, uniform across every panel, and
     inside a sticky unit it belongs to the BODY's scroller alone; the sidebar
     is a sibling track that cannot see it, so without this the one region of a
     panel with no band would be the sidebar, starting flush against the border
     while the body beside it kept the strip. Same reasoning, and the same
     owner, as the order and inset rules above: exactly one place knows the
     arrangement. */
  ${({ $railBand }) =>
    $railBand
      ? `& > [data-panel-sidebar] {
           padding-block-start: var(--panel-rail-band);
         }`
      : ""}

  /* Give back the sidebar's inset on the edge that faces the BODY, which pays a
     16px inset of its own there: two of them make the gutter between the two
     regions twice the one between two sections, and the sidebar pays for it out
     of a track that is often only 8rem wide.

     Only on the inline axis. Stacked, the sidebar spans the panel's full width
     and both of its inline edges face the panel's border, so both keep the full
     inset; the block gutter is the two regions' own 12px and 8px, which is the
     same pair any two stacked regions of a panel already sit at.

     Here rather than on Panel.Sidebar for the reason the order rule above is:
     exactly one place knows the arrangement, and a sidebar whose padding
     assumed an edge the tracks put elsewhere is a silently broken
     hand-composition. */
  ${({ $axis, $side }) =>
    $axis === "inline"
      ? /* Child combinators the whole way down, so a ScrollArea the sidebar's
           own CONTENT carries keeps its own padding. */
        `& > [data-panel-sidebar] > * > [data-scroll-area-inner] {
           padding-inline-${$side === "start" ? "end" : "start"}: 0;
         }`
      : ""}
`;

export interface PanelSplitProps extends ComponentPropsWithoutRef<"div"> {
  /** See `PanelSidebarSide`. Defaults to `end`. */
  side?: PanelSidebarSide;
  /**
   * Size of the sidebar track: a width on the inline axis, a height on the
   * block axis. Defaults to `14rem` and `40%` respectively.
   */
  size?: string;
  /** The body track holds the delay rail's band inside its scroller, so give the sidebar a matching top inset. */
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
  /* Longhands, not the shorthand the body writes. jsdom's CSS parser drops a
     shorthand whose parts are var() calls, so the shorthand form computes to 0
     there and the rule cannot be asserted at all; the longhands survive it.
     Same declaration either way in a real engine. */
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
  /* Grid items floor at min-content in both axes by default, which would let
     the ScrollArea below grow the track rather than scroll inside it. */
  min-width: 0;
  min-height: 0;
`;

/**
 * Secondary content beside or below the body: an almanac for the diagram, a
 * legend for the plot, a detail pane for the selected row.
 *
 * It carries its own `ScrollArea` and is never inside `Panel.Body`, so
 * scrolling it does not scroll the drawing it annotates. It carries the body's
 * inset too; inside a `Panel.Split` the edge facing the body gives its inset
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

/**
 * Observe the registered scroller and derive a value from it, recomputed on
 * scroll and on any size or child-list change to the scroller. Drivable in
 * jsdom by dispatching a `scroll` event.
 */
function useScrollerMetric<T>(
  el: HTMLElement | null,
  compute: (el: HTMLElement) => T,
  isEqual: (a: T, b: T) => boolean,
  initial: T,
): T {
  const [value, setValue] = useState<T>(initial);
  // Latest closures without re-subscribing: the effect keys off `el` alone.
  const computeRef = useRef(compute);
  computeRef.current = compute;
  const equalRef = useRef(isEqual);
  equalRef.current = isEqual;

  useEffect(() => {
    if (!el) return;
    const update = () => {
      const next = computeRef.current(el);
      setValue((prev) => (equalRef.current(prev, next) ? prev : next));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    const mo = new MutationObserver(() => {
      for (const child of Array.from(el.children)) ro.observe(child);
      update();
    });
    mo.observe(el, { childList: true });
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
      mo.disconnect();
    };
  }, [el]);

  return value;
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

/*
 * `Panel` is exclusively a composition of the named subcomponents, with no
 * markup of its own, so a widget can reproduce any variant by hand. Title and
 * toolbar sit beside the scrolling body, so the header stays pinned.
 */
export interface PanelProps extends ComponentPropsWithoutRef<"div"> {
  /**
   * Panel heading. Supplying it opts into the composed model: the panel renders
   * its own title and pads its body. Named so it does not collide with the
   * div's own `title` tooltip attribute.
   */
  panelTitle?: ReactNode;
  /**
   * The panel's body, as one or more sections: the preferred way to give a
   * panel content. Each entry is normally a `Section`; Panel owns how they
   * flow, down one column in a portrait tile and across two or three in a
   * landscape one. A single node is fine, and a conditional `null` entry does
   * not render.
   *
   * A widget that is wholly a drawing (a map, a globe) keeps children and uses
   * `floatingHeader` instead. Not to be confused with the boolean
   * `panelSections`, which is about the augment slot. A bare boolean is
   * rejected so `sections={false}` cannot render an empty panel.
   */
  sections?: Exclude<ReactNode, boolean> | readonly ReactNode[];
  /**
   * Narrowest a section column may be before the panel gives up on offering a
   * second one. Defaults to `DEFAULT_SECTION_MIN_WIDTH`.
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
   * Standard badge pills rendered in the header aside, sourced from the
   * widget's automatic `<id>.badges` contribution slot unless set here. An
   * explicit value replaces the ambient one rather than merging with it. Badges
   * render alongside whatever `panelAside` supplies.
   */
  panelBadges?: readonly BadgeEntry[];
  /**
   * This panel's own stream status, for the grades the host does not derive.
   *
   * The host already contributes the blackout grades (`recorded`,
   * `last-before-blackout`), which are stamped per subject. Every other grade is
   * opt-in, because `absent` means opposite things per topic. Set this for a
   * panel reading one specific topic, or to `"none"` to suppress the badge. It
   * merges worst-first with the host's contribution.
   */
  panelStatus?: StreamStatusValue | "none";
  /**
   * A full-width row of controls under the header, pinned outside the
   * scrolling body. For widgets whose controls are a row in their own right
   * (a map's layer pickers, a graph's series toggles); a single chip or select
   * belongs in `panelAside` instead. See `Panel.Toolbar`.
   */
  panelToolbar?: ReactNode;
  /**
   * The header floats over the content rather than reserving a row above it,
   * and the body bleeds to the panel chrome and stops scrolling.
   *
   * For a widget that is wholly a drawing (an orbit view, a globe). The title
   * and aside keep a panel-coloured backing so they stay legible. A widget with
   * a diagram and readouts wants `FramedDisplay` inside the ordinary body
   * instead. Independent of `fitToSize`, which keeps an ordinary header.
   */
  floatingHeader?: boolean;
  /**
   * Content is sized to fit and never scrolls. Forwarded to `Panel.Body`
   * rather than handled here, so manual composition stays reproducible.
   *
   * Beats `fill` on a section: under this prop every section stays an ordinary
   * grid item, since a filling section would eat the space the centring is
   * measured against.
   */
  fitToSize?: boolean;
  /**
   * A pinned strip at the very bottom of the panel, OUTSIDE the scrolling
   * body: the one readout an operator must never have to scroll for (Ship
   * Systems' power meter, a mission clock). Renders after the glow region
   * with its own top border, so body content scrolls behind the glow and
   * the footer stays put. Keep it to a single row; anything taller belongs
   * in the body or a sidebar.
   */
  panelFooter?: ReactNode;
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
   * Which edge the sidebar sits against, logically. See `PanelSidebarSide`.
   * Defaults to `end`.
   */
  sidebarSide?: PanelSidebarSide;
  /**
   * Size of the sidebar track: a width when it sits beside the body, a height
   * when it sits under it. Defaults to `14rem` and `40%` respectively.
   */
  sidebarSize?: string;
  /**
   * Whether this panel hosts the universal `sections` augment segment at the
   * end of its body. Defaults to true, which is what makes the extension point
   * universal: an author binds `${componentId}.sections` for any widget without
   * that widget having declared, named, or positioned a slot.
   *
   * Set false only when the widget renders `<WidgetSections>` itself (inside a
   * tab, a named section, a column of a split); both mounts would otherwise
   * render every bound augment twice.
   */
  panelSections?: boolean;
}

/** The augment segments `Panel` mounts for every widget. */
export const FRAMEWORK_AUGMENT_SEGMENTS = ["sections", "actions"] as const;

const NO_SEGMENT_PROPS: Record<string, never> = Object.freeze({});

/**
 * The universal `${componentId}.sections` augment slot: body sections an Uplink
 * appends below what the host widget renders, needing nothing from the host.
 *
 * `Panel` mounts one at the end of its body already, so a widget renders this
 * itself only to put the seam somewhere else, and must then pass
 * `panelSections={false}`. Outside a widget context it renders nothing.
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
      <Badge severity={summary.severity} size="sm">
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
 * scroller, so the rail always sits on the header. Only for the in-flow
 * header: a floating or headless panel keeps the rail in the container's band.
 */
const PanelStickyTop = styled.div`
  position: sticky;
  /* Reach the scroller's true top edge, cancelling the body's own top inset. */
  top: calc(-1 * var(--inset-panel-top));
  z-index: 2;
  /* Cancel the body's inset so the unit spans the full panel width and lands at
     the scroller's true top; only the body content below keeps the inset. */
  margin: calc(-1 * var(--inset-panel-top)) calc(-1 * var(--gutter-panel)) 0;
  display: flex;
  flex-direction: column;
  /* Never squeeze: at very short widget heights the scroller's flex column
     would otherwise crush the band and the title toward zero. */
  flex-shrink: 0;

  /* The rail's own negative margin is how it pulls up into the CONTAINER's
     reserved padding. There is no padding to pull into here, the band is this
     unit's own first row, so it is given back. The band's height is unchanged:
     the rail frame's own min-height is what stands it up either way. */
  & > [data-panel-rail-frame] {
    margin-top: 0;
  }
`;

/* The standard header inside the sticky unit. The unit's negative margins cancel the body's inset for the header alone. */
const PanelStickyHeader = styled(PanelHeader)`
  /* The sticky position, the z lift and the inset cancellation all live on
     PanelStickyTop, which is the box that carries the rail as well. What stays
     here is what belongs to the HEADER in that placement.

     It stays TRANSPARENT: the panel glow under it is its backing, so scrolled
     content reads faintly through/behind it rather than the header being an
     opaque bar. The rail above it is the opposite, fully opaque, because a
     reading that content can be read through is a reading that can be misread;
     that is also why the top glow starts at the header rather than at the unit
     (see railBandAbove on PanelGlow), so the header keeps exactly the backing
     it has always had. */
  /* The panel's top inset is the rail band above this header, so the header
     does not carry one of its own here. See PanelHeader__Row, which does carry
     it for every OTHER placement. */
  padding-top: 0;
  /* The sticky header is transparent, and the scroll glow behind it is a
     uniform lighter tint that affords scrolling without masking. So the ONE header
     designed to read over the glow AND over scrolled content gets a brighter
     title than the standard dim chrome token: a notch up from
     --color-text-dim, token-derived so a future light theme inherits it. Only
     here, not on the plain/overlay PanelTitle (the overlay header has its own
     opaque backing and needs no lift). */
  & h3 {
    color: color-mix(
      in srgb,
      var(--color-text-dim),
      var(--color-text-primary) 45%
    );
  }
`;

function PanelRoot({
  panelTitle,
  compactTitle,
  panelAside,
  panelBadges,
  panelStatus,
  panelToolbar,
  panelFooter,
  floatingHeader,
  fitToSize,
  panelSidebar,
  sidebarSide,
  sidebarSize,
  panelSections = true,
  sections,
  sectionMinWidth = DEFAULT_SECTION_MIN_WIDTH,
  children,
  ...rest
}: PanelProps) {
  /*
   * A status change never gives a headerless panel a header: that would
   * restructure the widget on a data transition. Badges alone do, so they are
   * resolved first: an explicit `panelBadges` wins, else the ambient provider.
   */
  const contextBadges = usePanelBadgesContext();
  // Asked as a boolean first, because an aside that exists at all is a padded box.
  const hasActionAugments = useWidgetSegmentBound("actions");
  const badges = panelBadges ?? contextBadges ?? [];
  const badgePills =
    badges.length === 0
      ? null
      : badges.map((b) => {
          /* An absent or `neutral` tone is a decorative chip with no severity, so it never paints itself nominal. */
          const severity =
            b.tone === undefined || b.tone === "neutral"
              ? undefined
              : severityFromBadgeEntryTone(b.tone);
          return (
            <Badge
              key={b.id}
              severity={severity}
              /* A decorative chip stays out of the collapsed header's dot summary. */
              report={severity === undefined ? undefined : { id: b.id }}
            >
              {b.label}
            </Badge>
          );
        });
  const hasHeader =
    panelTitle !== undefined ||
    panelAside !== undefined ||
    panelToolbar !== undefined ||
    badgePills !== null ||
    hasActionAugments;

  /*
   * The header status merges alarms, `report` badges and the stream status
   * into one summary through the per-item status store. The stream half is the
   * widget's own `panelStatus`: "absent" means opposite things per topic, so
   * the host derives only the per-subject blackout grades.
   */
  const status = panelStatus ?? null;
  // A healthy stream contributes nothing, so it never draws a green pill.
  const streamStatus: StreamStatusValue | null =
    hasHeader && status !== null && status !== "none" && status !== "live"
      ? status
      : null;
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
  const statusBadge =
    !hasHeader || summaryDuplicatesABadgePill ? null : summary !== null ? (
      <PanelSummaryBadge summary={summary} />
    ) : streamStatus === null || streamLabel === null ? null : (
      <Badge severity={severityFromStreamStatus(streamStatus)} size="sm">
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
  const sectionNodes = Children.toArray(sections as ReactNode);
  const hasSections = sectionNodes.length > 0;
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
  const content = !hasSections ? (
    children
  ) : (
    <>
      {children}
      {sectionRuns}
    </>
  );

  if (!hasHeader) {
    return (
      <PanelContainer {...rest}>
        <PanelDelayRail />
        {content}
        {panelSections && !hasSections && <WidgetSections />}
        {panelFooter !== undefined && <PanelFooter>{panelFooter}</PanelFooter>}
      </PanelContainer>
    );
  }

  /**
   * Whether the delay rail travels with the header inside the body scroller:
   * every headed panel but the floating one. The container, the split, the glow
   * and the sticky unit all read it and must agree.
   */
  const railTravels = !floatingHeader;

  // A floating header paints over a non-scrolling bleed body; every other header is one sticky header inside the scroller.
  const header = floatingHeader ? (
    <PanelHeader
      title={panelTitle}
      compactTitle={compactTitle}
      aside={aside}
      toolbar={panelToolbar}
      overlay
    />
  ) : (
    <PanelStickyHeader
      title={panelTitle}
      compactTitle={compactTitle}
      aside={aside}
      toolbar={panelToolbar}
    />
  );

  const body = (
    <PanelBody fitToSize={fitToSize} bleed={floatingHeader}>
      {!floatingHeader && (
        <PanelStickyTop data-panel-sticky-top="">
          <PanelDelayRail />
          {header}
        </PanelStickyTop>
      )}
      {fitToSize ? <PanelFitBody>{content}</PanelFitBody> : content}
      {panelSections && !hasSections && <WidgetSections />}
    </PanelBody>
  );

  // With a sidebar, a floating header is re-hosted against the body track alone so it does not cover the sidebar.
  const floatingBody =
    floatingHeader && panelSidebar !== undefined ? (
      <PanelFloatHost>
        {header}
        {body}
      </PanelFloatHost>
    ) : (
      body
    );

  const bodyRegion =
    panelSidebar === undefined ? (
      body
    ) : (
      // `railBand` hands the sidebar track the band the rail holds open inside the body scroller.
      <PanelSplit side={sidebarSide} size={sidebarSize} railBand={railTravels}>
        {floatingBody}
        {/* After the body in the DOM; `sidebarSide` moves it visually only. */}
        <PanelSidebar>{panelSidebar}</PanelSidebar>
      </PanelSplit>
    );

  return (
    <PanelProviders>
      <PanelContainer $railTravels={railTravels} {...rest}>
        {/* A floating header has no sticky unit, so its rail draws in the container's band. */}
        {floatingHeader && <PanelDelayRail />}
        <PanelGlow railBandAbove={railTravels}>
          {floatingHeader && panelSidebar === undefined && header}
          {bodyRegion}
        </PanelGlow>
        {panelFooter !== undefined && <PanelFooter>{panelFooter}</PanelFooter>}
        {/* Mounted empty, so the first status is a change to a region already watched; outside the aside, so collapsing does not unmount it. */}
        <LiveRegion visuallyHidden>{statusAnnouncement}</LiveRegion>
      </PanelContainer>
    </PanelProviders>
  );
}

export const Panel = Object.assign(PanelRoot, {
  Context: PanelContextProvider,
  Providers: PanelProviders,
  Delay: PanelDelayRail,
  Container: PanelContainer,
  Header: PanelHeader,
  Toolbar: PanelToolbar,
  Footer: PanelFooter,
  Title: PanelTitle,
  Glow: PanelGlow,
  Body: PanelBody,
  Section,
  Split: PanelSplit,
  Sidebar: PanelSidebar,
  StatusDot: PanelStatusDot,
  useStatusSummary,
});
