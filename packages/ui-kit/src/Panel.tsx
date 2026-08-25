import type { StreamStatusValue } from "@ksp-gonogo/sitrep-sdk"; // erased at build; no runtime edge
import {
  type ComponentPropsWithoutRef,
  createContext,
  forwardRef,
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
import { PanelRailTargetContext } from "./CommandDelay/PanelRailTarget";
import { type BadgeEntry, usePanelBadgesContext } from "./PanelBadges";
import { formatStreamStatus, StreamStatusBadge } from "./StreamStatusBadge";
import { PanelStatusDot } from "./status/PanelStatusDot";
import type { StatusSummary } from "./status/PanelStatusStore";
import { severityFromStreamStatus } from "./status/severity";
import { useStatusBreakdown } from "./status/useStatusBreakdown";
import { useStatusContribution } from "./status/useStatusContribution";
import { useStatusSummary } from "./status/useStatusSummary";
import { useElementSize } from "./useElementSize";
import { PanelAsideSizeProvider, useHeaderAsideFit } from "./usePanelAsideSize";

interface PanelContextValue {
  scroller: HTMLElement | null;
  registerScroller: (el: HTMLElement | null) => void;
}

const PanelCtx = createContext<PanelContextValue | null>(null);

/**
 * Coordination between the panel's parts. `Panel.Body` registers the element
 * that scrolls; `Panel.Glow` observes it.
 *
 * This exists so neither subcomponent has to reach into the other, and so the
 * pieces do not depend on nesting order. Keep it to the scroll element: a
 * context that accrues speculative fields becomes the same kind of unowned
 * contract that the glow-pad CSS vars were, which is the bug this rework
 * removes.
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
 * The per-panel providers a `Panel` mounts. Currently just the scroller-
 * coordination context, kept as a named seam so later per-panel providers have
 * one place to join. The delay-rail store is deliberately NOT here: a widget
 * calls `usePanelDelay` in its body, ABOVE the `<Panel>` it returns, so a
 * Panel-held store would be unreachable from there. The delay store is provided
 * ABOVE the widget instead (app-side `GridItemContent`, exactly like
 * `PanelStatusStoreProvider`); the rail, inside the Panel, reads that
 * above-store via `useActiveHandles()`. `Panel.Root` renders this; a
 * hand-composed panel can too.
 */
export function PanelProviders({ children }: { children?: ReactNode }) {
  return <PanelContextProvider>{children}</PanelContextProvider>;
}

export const PanelContainer = styled.div`
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
  border-radius: var(--radius-md, 4px);
  /* No uniform content inset here: the inset is Panel.Body's, so that visual
     content (charts/maps/gauges/plots) can be placed outside the body and
     reach the chrome, and so a hand-composed panel gets the same result as
     Panel without having to cancel a container padding. */
  padding: 0;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
`;

/* The header IS text, so it carries its own inset rather than relying on the
   container's. Rendered as a direct child by ~every widget, so self-padding
   here keeps all headers readable with no per-widget change. */
export const PanelTitle = styled.h3`
  margin: 0;
  /* Halved top inset (--space-6, from --space-12) so the sticky header sits
     close to the panel's true top edge rather than leaving a band of bare
     header above it. */
  padding: var(--space-6, 6px) var(--space-16, 16px) var(--space-8, 8px);
  font-size: var(--font-size-xs);
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--color-text-dim);
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
  line-height: var(--line-height-flush, 1);
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

const PanelHeader__Row = styled.div<{ $overlay?: boolean }>`
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
  gap: var(--space-8, 8px);
  min-width: 0;
  /* The aside NEVER wraps to a second row. When it stops fitting beside the
     title the panel COLLAPSES it (to the status dots) via useHeaderAsideFit's
     measured-fit collapse below, which is the whole point of the redesign, so
     there is no drop-to-its-own-row fallback: title left, aside top-right, one
     row, always. The title column (min-width:0) truncates within its own box
     instead. */
  flex-wrap: nowrap;
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

/* Applied to the two header boxes (not to the row) when the header floats over
   the content. Backing only the boxes is the point: the gap between the titles
   and the aside stays transparent, so the drawing underneath shows through
   between them rather than behind a full-width bar. The surface matches the
   panel's own so the text reads as panel chrome that the content runs beneath,
   not as a card sitting on top of it.

   `pointer-events: auto` restores what the row gives up: the row spans the full
   width invisibly, so it takes them away to keep drags reaching the map, and
   each box takes them back for the controls it actually holds. */
const OVERLAY_BOX = `
  background: var(--color-surface-panel);
  pointer-events: auto;
`;

const PanelHeader__Titles = styled.div<{ $overlay?: boolean }>`
  min-width: 0;
  ${({ $overlay }) => ($overlay ? OVERLAY_BOX : "")}
`;

const PanelHeader__Aside = styled.div<{ $overlay?: boolean }>`
  display: flex;
  align-items: center;
  gap: var(--space-4, 4px);
  /* Shrink to its content and sit right-aligned on the title's row. It never
     grows to a full row and never wraps: an aside that stops fitting collapses
     to the dots (the measured-fit collapse on PanelAsideExpand), it does not
     spill onto a second row. flex-shrink 0 keeps it intact; the title column
     yields the space (its min-width 0). */
  justify-content: flex-end;
  flex-shrink: 0;
  /* PanelTitle owns the left inset and the vertical rhythm; mirror both here
     so the badges line up with the title rather than the panel edge. */
  padding: var(--space-6, 6px) var(--space-16, 16px) var(--space-8, 8px);
  ${({ $overlay }) => ($overlay ? OVERLAY_BOX : "")}
`;

/**
 * The aside's collapse box (Task 9, reworked for operator review: the
 * collapse trigger itself). At the panel's full width, or wherever
 * `useHeaderAsideFit` reports content that genuinely fits, the aside shows
 * inline (the default rules below, and what jsdom sees, since it never runs a
 * real `ResizeObserver` cycle). Once `$collapsed` is true, it swaps to the
 * summary, the per-severity status dots plus a chevron, and the FULL aside
 * (badges AND controls) floats open in a glow-backed box on toggle.
 *
 * `$collapsed` is JS state (`useHeaderAsideFit`, in usePanelAsideSize.ts),
 * deliberately not a `@container` condition on a fixed panel-width threshold:
 * a fixed breakpoint is content-blind by construction, and collapses a
 * short-title widget with room to spare for its aside just because the PANEL
 * is narrow. The measured fit and its hysteresis (why collapsing
 * and re-expanding use different thresholds) are documented on
 * `nextAsideCollapsed`.
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
    gap: var(--space-4, 4px);
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
  & > summary::-webkit-details-marker {
    display: none;
  }
  & > summary [data-panel-aside-chevron] {
    /* A CSS caret, not an icon element: keeps the header out of every widget's
       SVG query surface and keeps the DOM snapshot light. Points down closed. */
    flex: 0 0 auto;
    box-sizing: border-box;
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
    margin-left: var(--space-4, 4px);
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    /* The visible ink (the two borders forming an L) has its centroid toward
       the box's bottom-right corner; rotate(45deg) swings that centroid to
       ~1.4px BELOW the box centre, so the drawn chevron reads low against the
       dots. Lift it 1.4px (on top of the summary's own -1px) so the chevron's
       ink centre coincides with the dot circles and the title cap band. */
    transform: translateY(-1.4px) rotate(45deg);
    transition: transform var(--duration-base, 150ms) var(--ease-standard, ease);
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
    gap: var(--space-4, 4px);
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
        top: calc(100% + var(--space-4, 4px));
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
        padding: var(--space-8, 8px);
        background: var(--color-surface-panel);
        border: 1px solid var(--color-border-subtle);
        border-radius: var(--radius-md, 4px);
        box-shadow: 0 var(--space-4, 4px) var(--space-12, 12px)
          rgba(0, 0, 0, 0.35);
      }
    `}
`;

/**
 * Title and an optional right-hand aside on one row.
 *
 * The aside is why this exists. Twenty-seven of forty-three widgets had grown
 * a bespoke `TitleRow`/`Header` styled div for exactly this, and what went in
 * it was not varied: a stream-status badge (37 occurrences), an `AugmentSlot`
 * for Uplink badges (19), the odd state `Badge` or `Select`. Twenty-seven
 * hand-rolled rows for two recurring things is a missing name, so this is the
 * name.
 *
 * Wherever `useHeaderAsideFit` finds the title + aside no longer fit the
 * header row side by side, the aside collapses to the panel's own
 * per-severity status DOTS (one `PanelStatusDot` per `useStatusBreakdown`
 * entry, worst-first) plus a chevron, and the FULL aside (badges AND
 * controls) floats open in a glow-backed `<details>` box on toggle. This is
 * generic `PanelHeader` behaviour, not specific to `Panel`/`PanelRoot`: a
 * hand-composed header gets it too, which is why the breakdown read lives
 * here rather than in `PanelRoot`.
 */
export function PanelHeader({
  title,
  aside,
  toolbar,
  overlay,
  ...rest
}: Omit<ComponentPropsWithoutRef<"div">, "title"> & {
  title?: ReactNode;
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

  // The measured-fit collapse: `rowRef` is the room available to title +
  // aside together, `titleRef` + `asideFullRef` are what they actually need.
  // See `useHeaderAsideFit` for the measurement and its hysteresis. `jsdom`
  // never fires a real ResizeObserver cycle or gives `<canvas>` a 2D backend,
  // so it always sees `collapsed === false`, the wide default every existing
  // widget test already renders.
  const rowRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const asideFullRef = useRef<HTMLDivElement>(null);
  const collapsed = useHeaderAsideFit(
    rowRef,
    titleRef,
    asideFullRef,
    title,
    aside,
  );

  /**
   * The `<details>` below is a disclosure only while the aside is COLLAPSED:
   * that is the one state with a summary to click and content genuinely behind
   * it. Inline, the summary is `display: none` and the full aside renders
   * whatever `[open]` says, so a closed `<details>` would claim that badges
   * sitting on screen are collapsed behind a trigger that does not exist. A
   * screen reader believes that claim, and so does Playwright's webkit
   * visibility check, which reads the `[open]` structure rather than the CSS
   * (that disagreement is why `e2e (webkit)` called a rendered header badge
   * hidden while chromium and firefox, which consult `checkVisibility()`,
   * called it visible).
   *
   * So `open` is forced while inline and owned by the operator while
   * collapsed. Leaving the collapsed state drops whatever they had popped
   * open, so a panel that narrows again starts closed rather than springing
   * its box back over the body.
   */
  const [openWhileCollapsed, setOpenWhileCollapsed] = useState(false);
  useEffect(() => {
    if (!collapsed) setOpenWhileCollapsed(false);
  }, [collapsed]);

  return (
    /* `data-panel-header` is a stable targeting hook, the same contract as
       ScrollArea's `data-scroll-area-inner`. The row splits titles and aside
       into two boxes so they can align independently. */
    <PanelHeader__Row
      ref={rowRef}
      data-panel-header=""
      $overlay={overlay}
      {...rest}
    >
      <PanelHeader__Titles $overlay={overlay}>
        {title !== undefined && <PanelTitle ref={titleRef}>{title}</PanelTitle>}
      </PanelHeader__Titles>
      {aside !== undefined && (
        <PanelHeader__Aside $overlay={overlay}>
          {/* The aside lives in a measured-fit collapse box: while it fits it
              shows inline; once it does not it collapses to the summary (the
              per-severity status dots + a chevron) and the FULL aside, badges
              AND controls, floats open on toggle. jsdom never completes a
              measurement cycle, so it sees the wide default (the aside inline
              in the box). */}
          {/* A native `<details>`: it carries an implicit `role="group"`, so a
              widget aside that itself uses `getByRole("group")` must scope that
              query to its own subtree (this box is the panel-level group). */}
          <PanelAsideExpand
            data-panel-aside-expand=""
            $collapsed={collapsed}
            open={collapsed ? openWhileCollapsed : true}
            onToggle={(e) => {
              // Guarded on `collapsed` so the forced-open inline state does not
              // record itself as an operator choice and reopen the box on the
              // next collapse.
              if (collapsed) setOpenWhileCollapsed(e.currentTarget.open);
            }}
          >
            <summary aria-label="Panel status and controls">
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
 * Distinct from `panelAside`, which is the small slot BESIDE the title: a chip,
 * a badge, one select. A toolbar is for widgets whose controls are a row in
 * their own right (a map's layer and projection pickers, a graph's series
 * toggles and time window). Putting those in the aside squeezes the title at
 * every realistic tile width; putting them in the body scrolls them away from
 * the content they steer.
 *
 * It wraps rather than scrolls, so a narrow tile gets a taller toolbar and the
 * controls stay reachable. If a widget's toolbar is tall enough at tile width
 * for that to hurt, the controls belong behind a disclosure, not in a row.
 */
export const PanelToolbar = styled.div<{ $overlay?: boolean }>`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-8, 8px);
  /* Mirrors the header's horizontal inset so controls line up with the title
     above them, and carries only a bottom gap of its own: the header already
     paid the top inset. */
  padding: 0 var(--space-16, 16px) var(--space-8, 8px);
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

const PanelBody__Box = styled.div<{ $fitToSize?: boolean; $bleed?: boolean }>`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-8, 8px);
  padding: var(--space-8, 8px) var(--space-16, 16px) var(--space-12, 12px);
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
  /* Plain concatenation, NOT a nested template literal: a backtick inside a
     styled template breaks the parse and builds an empty dist. */
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
    /* `data-panel-body` is a stable targeting hook, the same contract as
       PanelHeader's `data-panel-header`. A widget with a full-height element
       beside scrolling content needs the SCROLLER's visible height, which is
       this box, and walking up by ancestor count would break the moment the
       composition changed. */
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
 * The tiny-tile layout: fills the space left under the header and centres the
 * widget's content in it, but only while measurement says the content fits.
 *
 * Wraps the widget's children ALONE. The header is a child of the body too, so
 * centring at the body level centres the title along with the reading and makes
 * the header part of what is measured, which is not what a tiny presentation
 * means by centred.
 */
function PanelFitBody({ children }: { children?: ReactNode }) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const fits = useContentFits(outerRef, innerRef);
  return (
    <PanelBody__FitOuter ref={outerRef} $fits={fits} data-panel-fit-body="">
      <PanelBody__FitContent ref={innerRef}>{children}</PanelBody__FitContent>
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
  /* Plain concatenation, NOT a nested template literal: a backtick inside a
     styled template breaks the parse and builds an empty dist. */
  ${({ $fits }) =>
    "justify-content: " + ($fits ? "center" : "flex-start") + ";"}
`;

const PanelBody__FitContent = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-4, 4px);
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
 * when centring cannot push the first line out of reach.
 *
 * Measured rather than expressed in CSS because the CSS answer, `safe center`,
 * is honoured by all three engines in isolation and still clipped the real
 * widget on Firefox. Comparing the two heights asks no engine to agree about
 * anything.
 *
 * Answers true when there is nothing to measure, which is what a test
 * environment with no ResizeObserver gets: at zero measured height content
 * trivially fits, and no layout is being asserted there anyway.
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
      // Measured against the space under the HEADER, not against this box's own
      // height, and the difference is the whole behaviour. `flex: 1` resolves
      // this box to whatever is left, which at tiny-2x2 is 11px against a 24px
      // readout, so comparing content to it says "does not fit" for a widget
      // that visibly does. What the rule actually protects against is centring
      // pushing the first line somewhere it cannot be read, so the question is
      // whether the content fits the PANEL's content area.
      const body = box.parentElement;
      const header = body?.querySelector("[data-panel-header]");
      const available =
        body != null
          ? body.clientHeight -
            (header ? header.getBoundingClientRect().height : 0)
          : box.clientHeight;
      // scrollHeight, not clientHeight: the content box is what OVERFLOWS, and
      // its own client height is capped by the parent it is overflowing.
      setFits(content.scrollHeight <= available);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(content);
    return () => observer.disconnect();
  }, [boxRef, contentRef]);
  return fits;
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
 * Inner scroll element. Rendered with a stable `data-scroll-area-inner`
 * attribute (set inline below) so consumers can target it from
 * `styled(ScrollArea)\`& [data-scroll-area-inner] { ... }\`` to apply padding
 * or layout (display:flex/gap) to the scrolling children.
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
}>`
  position: absolute;
  /* Flush with the scroller's own edges. There is no pad-var escape hatch: the
     panel needs none because Panel.Body's inset is inside the scroller, and a
     widget that appeared to need one was really nesting a SECOND scroller as
     its whole body, whose glow then drew inside the outer body's inset.
     Deleting that nesting is the fix; four widgets had it. */
  left: 0;
  right: 0;
  ${({ $position }) => ($position === "top" ? "top: 0;" : "bottom: 0;")}
  /* 44px is the container both layers fade within; each layer sets its OWN
     reach through its gradient stops below (mask ~50%, affordance ~40%).
     Height is outside the ratchet's scanned properties, so it stays a
     literal. */
  height: 44px;
  pointer-events: none;
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  transition: opacity var(--duration-base, 150ms) var(--ease-standard, ease);
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
 * Scrolling region with subtle white glow indicators at the top/bottom edges
 * when there's scroll content in that direction. Use anywhere an internal
 * region of a widget can overflow (e.g. lists, terminal output, file trees).
 *
 * A whole panel body does NOT need this: `Panel` already scrolls and glows.
 * Reach for it for a SECOND scrolling region inside a widget (a sidebar list
 * beside a diagram, a terminal log above a prompt).
 *
 * Forwards its ref to the inner scroll element so consumers can imperatively
 * scroll. Accepts standard div props on the root; pass className via
 * `styled(ScrollArea)` to apply layout to the root.
 */
export const ScrollArea = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<"div">
>(function ScrollArea({ children, ...rest }, ref) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ top: false, bottom: false });

  useImperativeHandle(ref, () => innerRef.current as HTMLDivElement);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;

    const update = () => {
      const top = el.scrollTop > 1;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      setOverflow((prev) =>
        prev.top === top && prev.bottom === bottom ? prev : { top, bottom },
      );
    };

    update();
    el.addEventListener("scroll", update, { passive: true });

    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const child of Array.from(el.children)) {
      ro.observe(child);
    }

    const mo = new MutationObserver(() => {
      for (const child of Array.from(el.children)) {
        ro.observe(child);
      }
      update();
    });
    mo.observe(el, { childList: true });

    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  return (
    <ScrollAreaRoot {...rest}>
      <ScrollAreaInner ref={innerRef} data-scroll-area-inner="">
        {children}
      </ScrollAreaInner>
      <ScrollOverflowGlow $position="top" $visible={overflow.top} />
      <ScrollOverflowGlow $position="bottom" $visible={overflow.bottom} />
    </ScrollAreaRoot>
  );
});

// ---------------------------------------------------------------------------
// Sidebar: a second region beside (or below) the body
// ---------------------------------------------------------------------------

/**
 * Where the sidebar sits relative to the body, in LOGICAL terms rather than
 * left/right/top/bottom.
 *
 * One prop covers both axes that way, and `end` is the right edge in LTR and
 * the left edge in RTL for free, because grid tracks and `order` both flow in
 * the inline direction the writing mode defines.
 *
 * `end` is the default because a sidebar is secondary content: an almanac
 * annotating a diagram should not precede the diagram in reading order, and
 * placing it at `start` would put it there visually while the DOM says
 * otherwise.
 *
 * There is deliberately no `auto`. The AXIS is always derived (see
 * `PanelSplit`), so an `auto` side would only ever have meant `end`, and a
 * value that is identical to another value is a promise the API is not
 * keeping. Dropping it says what actually happens; it can be added later if
 * the panel ever gains a real reason to pick a side.
 */
export type PanelSidebarSide = "start" | "end";

/** Sidebar beside the body (inline) or under it (block). Derived, never passed. */
type PanelSidebarAxis = "inline" | "block";

/* Defaults differ per axis because the two arrangements are not the same
   measurement. A column beside a diagram wants an absolute width, wide enough
   for a label/value pair and no wider whatever the tile does. A strip under it
   is competing with the diagram for the tile's height, so it wants a share
   rather than a number, or a short tile loses the diagram entirely. */
/**
 * Resolve a CSS length to pixels, for the two units a sidebar size is realistically
 * written in. Returns undefined for anything else (percentages, ch, clamp), and
 * the caller then falls back to the aspect reading rather than guessing.
 */
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

const SIDEBAR_INLINE_SIZE = "14rem";
const SIDEBAR_BLOCK_SIZE = "40%";

function sidebarTracks(side: "start" | "end", size: string): string {
  return side === "start"
    ? `minmax(0, ${size}) minmax(0, 1fr)`
    : `minmax(0, 1fr) minmax(0, ${size})`;
}

/* Positioning context for a floating header that must cover the body track
   only. Carries no visual style of its own. */
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
`;

export interface PanelSplitProps extends ComponentPropsWithoutRef<"div"> {
  /** See `PanelSidebarSide`. Defaults to `end`. */
  side?: PanelSidebarSide;
  /**
   * Size of the sidebar track: a width on the inline axis, a height on the
   * block axis. Defaults to `14rem` and `40%` respectively.
   */
  size?: string;
}

/**
 * The grid that holds `Panel.Body` and `Panel.Sidebar`.
 *
 * It exists as a named part because `Panel` is exclusively a composition of
 * named parts: a sidebar arrangement a widget could not reproduce by hand
 * would be the one arrangement in this file that is not reachable.
 *
 * The axis is MEASURED rather than queried. A container query would express
 * "wider than tall" more directly, but two things argue against it: jsdom
 * evaluates no container queries at all, so the axis switch, the one piece of
 * behaviour here that is a decision rather than a rule, could not be tested;
 * and `container-type: size` imposes size containment in both axes on a box
 * whose whole job is to hand its height to two scrolling children.
 *
 * Measuring THIS box is deliberate: its border box is fixed by `flex: 1` and
 * does not change when the grid template flips between axes. Measuring the
 * body instead would shrink it when the sidebar mounts, flip the reading, and
 * oscillate.
 */
export function PanelSplit({
  side = "end",
  size,
  children,
  ...rest
}: PanelSplitProps) {
  // Seeded square, which the `>=` below resolves to the inline axis: an
  // unmeasured panel (first paint, and jsdom forever) gets the side-by-side
  // arrangement, the one that suits the tile shapes widgets default to.
  const { ref, size: measured } = useElementSize<HTMLDivElement>({
    w: 1,
    h: 1,
  });
  // Aspect alone is not enough, and a render proved it: a 6x6 tile is square,
  // so `w >= h` chose the inline axis, and a 14rem sidebar on a ~232px tile
  // left about 8px for the body. The diagram vanished entirely.
  //
  // So the inline axis also needs absolute room: the body must keep at least as
  // much as the sidebar takes. Below that the sidebar goes under, where it has
  // the full width and the body keeps its own.
  //
  // Only applied once really measured. The seed is 1x1, and treating that as
  // "no room" would flip every unmeasured panel (first paint, and jsdom, which
  // runs no layout) to the block axis.
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
    /* `data-panel-split` is a stable targeting hook, the same contract as
       `data-panel-header` and `data-panel-body`, and it carries the resolved
       axis so the decision is inspectable from outside. */
    <PanelSplit__Box
      ref={ref}
      data-panel-split={axis}
      $axis={axis}
      $side={side}
      $size={resolvedSize}
      {...rest}
    >
      {children}
    </PanelSplit__Box>
  );
}

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
 * It carries its OWN `ScrollArea` and is never inside `Panel.Body`, which is
 * the whole point of it being a region rather than more body content:
 * scrolling an almanac must not scroll the diagram it annotates off the tile.
 */
export function PanelSidebar({
  children,
  ...rest
}: ComponentPropsWithoutRef<"div">) {
  return (
    <PanelSidebar__Box data-panel-sidebar="" {...rest}>
      <ScrollArea>{children}</ScrollArea>
    </PanelSidebar__Box>
  );
}

/**
 * Observe the registered scroller and derive a value from it, recomputed on
 * scroll and on any size or child-list change to the scroller. The single
 * implementation of "watch the scroller and compute something", shared by the
 * glow (which wants top/bottom overflow booleans) and the ghost (which wants
 * "is the header scrolled out of view"), so the two decorators of the same
 * scroller cannot drift apart. It reuses the exact scroll + ResizeObserver +
 * MutationObserver pattern the glow already had, and stays drivable in jsdom
 * by dispatching a `scroll` event, which is why the ghost keys off it rather
 * than an IntersectionObserver.
 */
function useScrollerMetric<T>(
  el: HTMLElement | null,
  compute: (el: HTMLElement) => T,
  isEqual: (a: T, b: T) => boolean,
  initial: T,
): T {
  const [value, setValue] = useState<T>(initial);
  // Latest closures without re-subscribing: the effect keys off `el` alone, so
  // a caller passing a fresh `compute`/`isEqual` each render does not tear down
  // and rebuild the observers every time.
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
 * Owns the overflow glow and NOTHING else. It does not scroll; it decorates
 * whatever does.
 *
 * It finds the scroller through the panel context rather than by inspecting
 * its children, which means it does not depend on nesting order: it can wrap
 * the body or sit beside it and still work. That is what keeps hand-composed
 * panels behaving identically to `Panel`.
 *
 * The previous arrangement passed `--scroll-glow-pad-*` between Panel,
 * PanelBody and ScrollArea: three participants, no owner, and an invalid
 * unitless zero sat in it unnoticed so the glow never rendered at all. Giving
 * it an owner left the vars behind as an escape hatch, and they then sat with
 * NO PUBLISHER anywhere in the repo, permanently resolving to their `0px`
 * fallback while one widget carried a comment describing a bleed that
 * therefore never happened. They are gone entirely now. A widget that appears
 * to need one is nesting a second scroller as its whole body; delete that
 * instead.
 */
export function PanelGlow({
  children,
  ...rest
}: ComponentPropsWithoutRef<"div">) {
  const ctx = useContext(PanelCtx);
  const el = ctx?.scroller ?? null;

  useEffect(() => {
    if (!ctx && process.env.NODE_ENV !== "production") {
      // Loud rather than silent: without a context this renders correctly and
      // does nothing, which is precisely how the last glow bug survived.
      console.warn(
        "Panel.Glow rendered outside a Panel.Context, so it has no scroller " +
          "to observe and will never show. Wrap it in Panel.Context (or use " +
          "Panel, which does).",
      );
    }
  }, [ctx]);

  const overflow = useScrollerMetric(
    el,
    (e) => ({
      top: e.scrollTop > 1,
      bottom: e.scrollTop + e.clientHeight < e.scrollHeight - 1,
    }),
    (a, b) => a.top === b.top && a.bottom === b.bottom,
    { top: false, bottom: false },
  );

  return (
    <PanelGlow__Root {...rest}>
      {children}
      <ScrollOverflowGlow $position="top" $visible={overflow.top} />
      <ScrollOverflowGlow $position="bottom" $visible={overflow.bottom} />
    </PanelGlow__Root>
  );
}

// ---------------------------------------------------------------------------
// The compound Panel
//
// Governing principle: `Panel` is EXCLUSIVELY the composition of named
// subcomponents, with no bespoke markup or styling of its own. If it grew a
// `<div>`, a widget needing a variant could no longer reproduce it by hand.
// Every piece below is reachable as `Panel.Container` / `.Title` / `.Glow` /
// `.Body`.
//
// `Panel.Glow` WRAPS the scrolling region rather than sitting beside it, so it
// owns both the glow's behaviour and the inset compensation it needs. That
// replaced a `--scroll-glow-pad-*` var contract shared between three
// components with no owner, which is exactly how a unitless `0` sat in the
// scrollable shell making `calc(-1 * 0)` invalid, so the glow never rendered
// there at all. The vars themselves are now deleted too: left in place as an
// escape hatch they acquired no publisher, which is the same failure one step
// quieter.
//
// Title and toolbar sit inside the glow but BESIDE the body rather than in
// it, and the body is the scroller, so the header stays pinned while
// the content scrolls under the glow. (The retired `PanelScrollable` wrapped
// all its children in the scroll area, so a widget passing a title got a title
// that scrolled away; that is what this arrangement fixes.)
// ---------------------------------------------------------------------------

export interface PanelProps extends ComponentPropsWithoutRef<"div"> {
  /**
   * Panel heading. Supplying it opts into the composed model: the panel
   * renders its own title and pads its body.
   *
   * Named `panelTitle` rather than `title` so it cannot collide with the div's
   * own `title` attribute, which HTML types as a tooltip string. Taking that
   * name would have meant omitting the real attribute, silently removing the
   * ability to give a panel a tooltip.
   *
   * Widgets that instead render `PanelTitle` as a child get the older unpadded
   * passthrough, so the migration can move one widget at a time and each
   * render change is attributable to that widget. That fallback goes when the
   * named subcomponent exports are retired.
   */
  panelTitle?: ReactNode;
  /**
   * Content for the right of the header row, beside the stream-status badge:
   * state chips, an `AugmentSlot` for Uplink badges, a small control such as a
   * select or a show/hide button.
   *
   * Named `aside` rather than `badges` because it is not only badges. It began
   * as a badge slot and immediately started carrying PowerSystems' resource
   * select and CrewStatus's meters toggle, which is the normal case rather
   * than an abuse: whatever a widget puts next to its title belongs here.
   *
   * Keep it small all the same. This is a header slot, not a second body;
   * anything that wants real layout should be in the body or in a
   * hand-composed `Panel.Header`.
   */
  panelAside?: ReactNode;
  /**
   * Standard badge pills rendered in the header aside, sourced from the
   * widget's automatic `<id>.badges` contribution slot (contribution-slots
   * spec §13.2) unless explicitly set here. Renders through the kit's own
   * `Badge`, so every widget's badges share one visual vocabulary instead of
   * each widget hand-rolling a pill. An explicit value here REPLACES the
   * ambient context value rather than merging with it (same relationship
   * `panelStatus` has to the derived stream status): a panel that wants both
   * concatenates them itself before passing the prop.
   *
   * Distinct from `panelAside`, which stays the escape hatch for non-badge
   * content (a select, a toggle, a headline readout): the two compose, badges
   * render alongside whatever `panelAside` supplies, never instead of it.
   */
  panelBadges?: readonly BadgeEntry[];
  /**
   * Override the host-derived stream status.
   *
   * Leave it unset: the panel reads the status the host derived from this
   * widget's own `dataRequirements`, which is both less wiring and more
   * accurate than a hand-picked representative key. Set it only for a panel
   * whose staleness genuinely is not its widget's (a sub-panel reading one
   * specific topic), or to `"none"` to suppress the badge entirely.
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
   * For a widget that is WHOLLY a drawing: an orbit view, a globe. Its content
   * wants the whole tile, and cropping it to leave room for a title is the
   * wrong trade at the sizes these run at. The title and the aside keep a
   * panel-coloured backing so they stay legible over whatever passes beneath.
   *
   * Wholly is the load-bearing word. A widget with a diagram AND readouts
   * wants `FramedDisplay` around the diagram inside the ordinary padded body,
   * not this: the body inset it cancels is the one those readouts need. That
   * this prop also floats the header is what keeps it honest, because a widget
   * with readouts in it would never ask for a title floating over them.
   *
   * Deliberately NOT folded into `fitToSize`, though they do go together. That
   * prop is already set by widgets which want their content sized to the tile
   * and still want an ordinary header, and every one of them would sprout a
   * floating title the day the two merged. Two questions, two props: does the
   * content scroll, and does the header sit above it or on it.
   */
  floatingHeader?: boolean;
  /**
   * Content is sized to fit and never scrolls. Forwarded to `Panel.Body`
   * rather than handled here, so manual composition stays reproducible.
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
   * Leaving it unset changes nothing at all. There is no grid, no extra box,
   * and the body is the same element it has always been, so a widget that
   * does not ask for a sidebar cannot be affected by one existing.
   *
   * The sidebar is a REGION, not a column of body content. Content that
   * scrolls with the body belongs in the body; this is for content whose
   * scrolling must not move what it annotates.
   */
  panelSidebar?: ReactNode;
  /**
   * Which edge the sidebar sits against, logically. See `PanelSidebarSide`.
   * Defaults to `auto`.
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
   * Set false ONLY when the widget renders `<WidgetSections>` itself because
   * end-of-body is the wrong place for it (inside a tab, inside a named
   * section, as a column of a landscape split). Both mounts firing would render
   * every bound augment twice, silently, so a widget that places its own must
   * say so here.
   */
  panelSections?: boolean;
}

// The augment segments `Panel` mounts for EVERY widget, the augment-side
// counterpart of `contributionsRuntime`'s `FRAMEWORK_SEGMENTS`. Recorded as a
// list so the two universal segments are greppable from one place even though
// they mount in two different parts of the panel.
export const FRAMEWORK_AUGMENT_SEGMENTS = ["sections", "actions"] as const;

// Frozen so the empty props object handed to both segment slots is one stable
// reference rather than a fresh literal per render.
const NO_SEGMENT_PROPS: Record<string, never> = Object.freeze({});

/**
 * The universal `${componentId}.sections` augment slot: body sections an Uplink
 * appends below what the host widget renders, needing nothing from the host.
 *
 * `Panel` mounts one at the end of its body already, so a widget renders this
 * itself only to put the seam somewhere else, and must then pass
 * `panelSections={false}` so the two mounts do not both fire. Outside a widget
 * context it renders nothing, same as any segment slot.
 *
 * A component owning its own extension point, rather than the orchestrator
 * owning it on the component's behalf: the shape `FilterList` established for
 * the `filters` contribution segment.
 */
export function WidgetSections(): ReactElement {
  return <AugmentSlot segment="sections" props={NO_SEGMENT_PROPS} />;
}

/**
 * The winning status contribution, rendered as the header aside badge and given
 * a brief transition cue when its severity changes: the summary pulses once on a
 * severity change then settles quiet, so an operator's eye is drawn to a panel
 * that just got worse (or recovered) without a persistent animation nagging.
 * Reduced-motion guarded. The badge announces (`live`), since a summary change
 * is exactly the kind of state transition a screen-reader user benefits from.
 */
function PanelSummaryBadge({ summary }: { summary: StatusSummary }) {
  // A remount key that ticks on every severity change restarts the one-shot CSS
  // animation (the same restart trick a keyed list item uses); the previous
  // severity is held in a ref so a label-only change does not pulse.
  const prevSeverity = useRef(summary.severity);
  const [pulseKey, setPulseKey] = useState(0);
  useEffect(() => {
    if (prevSeverity.current !== summary.severity) {
      prevSeverity.current = summary.severity;
      setPulseKey((k) => k + 1);
    }
  }, [summary.severity]);
  return (
    <PanelSummaryBadge__Pulse key={pulseKey} $pulse={pulseKey > 0}>
      <Badge severity={summary.severity} size="sm" live>
        {summary.label}
      </Badge>
    </PanelSummaryBadge__Pulse>
  );
}

const PanelSummaryBadge__Pulse = styled.span<{ $pulse: boolean }>`
  display: inline-flex;
  ${({ $pulse }) =>
    $pulse &&
    css`
      @media (prefers-reduced-motion: no-preference) {
        animation: panel-status-pulse var(--duration-slow, 600ms)
          var(--ease-emphasis, ease-out);
      }
    `}
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
  padding: var(--space-6, 6px) var(--space-16, 16px) var(--space-8, 8px);
  background: var(--color-surface-panel);
`;

/* The standard header, reparented as the FIRST in-flow child of the scroller
   so title and body scroll as one unit. The negative margins cancel the body's
   own top/side inset for the header alone, so `PanelTitle`'s own inset governs
   and the title lands exactly where the pinned band put it (top-left, same
   inset); only the body content below keeps the body's padding. `PanelHeader`
   itself is untouched, this is purely how `PanelRoot` assembles it. */
const PanelStickyHeader = styled(PanelHeader)`
  /* Sticks below the delay rail (which publishes its height into
     --panel-rail-height) while the body scrolls under it, so title + aside stay
     in view without a scroll-away ghost. It stays TRANSPARENT: the panel glow
     under it is its backing, so scrolled content reads faintly through/behind it
     rather than the header being an opaque bar. z-index lifts it over the
     scrolling content and the overflow glow. */
  position: sticky;
  /* Reach the panel's true top edge. No rail: stick at MINUS the body's top
     padding, cancelling the inset so the header reaches the true top. Rail
     present: the rail sits flush at the true top (its wrap cancels the same
     inset) and publishes its height, so the header sticks exactly at that
     height, directly under the rail, no extra padding term. */
  top: var(--panel-rail-height, calc(-1 * var(--space-8, 8px)));
  z-index: 2;
  /* Cancel the body's inset horizontally so the header spans the full panel
     width; the negative top keeps the title at the body's own inset and lines
     the header up with the pulled-up sticky offset. */
  margin: calc(-1 * var(--space-8, 8px)) calc(-1 * var(--space-16, 16px)) 0;
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
  children,
  ...rest
}: PanelProps) {
  // A panel only shows a status badge if it ALREADY has a header. An
  // unmigrated widget (children only, its own bespoke title row inside) must
  // not sprout a header and a padded body the moment its stream degrades:
  // that would restructure the widget on a data transition, which is both a
  // layout surprise and impossible to see coming in review. Such a widget
  // simply keeps showing no badge until it moves to `panelTitle`.
  // Standard badge pills for this widget: an explicit `panelBadges` prop wins,
  // else the ambient `PanelBadgesProvider` the orchestrator mounts (Task 2.4),
  // else none. Rendered through the kit's own `Badge` so every widget's badges
  // share one vocabulary. Computed before `hasHeader` because badges alone are
  // enough to give an otherwise-headerless panel a header.
  const contextBadges = usePanelBadgesContext();
  // The universal `${componentId}.actions` augment segment renders in the
  // header aside. Asked as a boolean first because an aside that exists at all
  // is a box with padding: splicing an always-mounted slot in would give every
  // headed panel in the app an empty one.
  const hasActionAugments = useWidgetSegmentBound("actions");
  const badges = panelBadges ?? contextBadges ?? [];
  const badgePills =
    badges.length === 0 ? null : (
      <>
        {badges.map((b) => (
          <Badge key={b.id} tone={b.tone ?? "neutral"}>
            {b.label}
          </Badge>
        ))}
      </>
    );
  const hasHeader =
    panelTitle !== undefined ||
    panelAside !== undefined ||
    panelToolbar !== undefined ||
    badgePills !== null ||
    hasActionAugments;

  // The panel's header status comes from the per-item PanelStatusStore, so an
  // active alarm and any `report` badge merge into ONE summary rather than
  // each splicing a single value into the aside.
  //
  // The stream half is the WIDGET'S own to supply, via `panelStatus`. The host
  // deliberately does NOT derive one across every topic a widget declares: one
  // worst-of pill for five topics cannot say which of them is degraded, and
  // "absent" means opposite things per topic (an empty `vessel.maneuvers` is a
  // normal state, an absent `vessel.orbit` is not). Stale and reckoned Values
  // ride the wire per Value, so currency is already carried at a finer
  // granularity than a panel-wide summary could express, and a lossy summary
  // that can read as a fault when there is none is worse than none.
  const status = panelStatus ?? null;
  // Live/none/absent-of-status contribute nothing (the floor), so a healthy
  // stream keeps today's "no green pill" rule. A degraded status folds in as
  // the "stream" contribution; `panelStatus="none"` suppresses it outright.
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

  // A ref to the panel's own container element so `PanelDelayRail` can publish
  // `--panel-rail-height` onto it (an ancestor of both the rail and the ghost)
  // through `PanelRailTargetContext`, with no DOM query. A ref, not state, so
  // capturing the container costs no extra render: the rail reads `ref.current`
  // in its effect, which runs after the container ref is attached.
  const railTargetRef = useRef<HTMLDivElement>(null);

  // With a store in the tree the header renders the winning contribution; with
  // none (a standalone panel in the settings modal or the station connect view,
  // and every unit test that wraps only `Panel.Status`) it falls back to the
  // legacy stream badge, so that path keeps behaving exactly as before.
  const statusBadge = !hasHeader ? null : summary !== null ? (
    <PanelSummaryBadge summary={summary} />
  ) : streamStatus === null ? null : (
    <StreamStatusBadge status={streamStatus} />
  );
  // `undefined`, not `null`: PanelHeader treats undefined as "no aside at all"
  // and skips the box, where a null child would still render the padded slot.
  const aside =
    panelAside === undefined &&
    statusBadge === null &&
    badgePills === null &&
    !hasActionAugments ? undefined : (
      <>
        {panelAside}
        {/* The universal `actions` segment: header controls an Uplink adds to
            ANY widget, in the same place the universal `badges` contribution
            lands. Ahead of the badges and the status badge, which are readouts;
            a control the operator can press should not be the last thing to
            find. */}
        {hasActionAugments && (
          <AugmentSlot segment="actions" props={NO_SEGMENT_PROPS} />
        )}
        {badgePills}
        {statusBadge}
      </>
    );

  if (!hasHeader) {
    return (
      <PanelContainer {...rest}>
        {children}
        {/* Same universal seam as the headed path below: an unmigrated widget
            (its own title row inside its children) is still a widget, and an
            author binding `${componentId}.sections` has no way to know which
            panel shape it renders. */}
        {panelSections && <WidgetSections />}
        {panelFooter !== undefined && <PanelFooter>{panelFooter}</PanelFooter>}
      </PanelContainer>
    );
  }

  // A `floatingHeader` is the one overlay case: it paints over a non-scrolling
  // `bleed` body (a map/globe/plot fills the tile) rather than sticking above
  // scrolling content. Every OTHER header, standard or with a `panelToolbar`, is
  // ONE sticky header inside the scroller (see `body` below): it sticks at
  // `top: var(--panel-rail-height)` so title + aside (+ toolbar) stay in view
  // while the body scrolls under it. One mechanism, and no scroll-away ghost.
  const header = floatingHeader ? (
    <PanelHeader
      title={panelTitle}
      aside={aside}
      toolbar={panelToolbar}
      overlay
    />
  ) : (
    <PanelStickyHeader
      title={panelTitle}
      aside={aside}
      toolbar={panelToolbar}
    />
  );

  const body = (
    <PanelBody fitToSize={fitToSize} bleed={floatingHeader}>
      {/* The signal-delay rail rides at the true top of the scroller, above the
          header: in-flight command countdowns sit over the title and the sticky
          header / ghost rest below its published height. Renders nothing when no
          command is in flight, so a no-command panel's DOM is unchanged. */}
      <PanelDelayRail />
      {/* The sticky header rides INSIDE the scroller, directly under the rail: it
          sticks at `top: var(--panel-rail-height)` so title + aside (+ toolbar)
          stay in view while the body scrolls under it. Only a floating (overlay)
          header lives outside the scroller. */}
      {!floatingHeader && header}
      {fitToSize ? <PanelFitBody>{children}</PanelFitBody> : children}
      {/* The universal `${componentId}.sections` augment segment: body sections
          an Uplink appends to ANY widget, with the widget declaring, naming and
          positioning nothing. Renders no DOM until something binds. A widget
          that needs the seam elsewhere renders `<WidgetSections>` itself and
          turns this off, so the two mounts never both fire. */}
      {panelSections && <WidgetSections />}
    </PanelBody>
  );

  // A floating header is absolutely positioned against the nearest positioned
  // ancestor. With no sidebar that is the glow, which is what a drawing widget
  // wants: the title paints over the whole tile. With a sidebar it would paint
  // over the SIDEBAR too, hiding its first item behind the title box, so the
  // header is re-hosted against the body track alone and the sidebar keeps its
  // full height. This is what lets a drawing widget have both.
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
      // No sidebar means no split either: the body stays a direct child of the
      // glow, the exact element tree every existing widget already renders. The
      // header rides the body scroller here exactly as the standard case, so
      // the sidebar's own ScrollArea is untouched.
      <PanelSplit side={sidebarSide} size={sidebarSize}>
        {floatingBody}
        {/* Written after the body on purpose; `sidebarSide` moves it visually
            and never in the DOM. */}
        <PanelSidebar>{panelSidebar}</PanelSidebar>
      </PanelSplit>
    );

  return (
    <PanelProviders>
      <PanelRailTargetContext.Provider value={railTargetRef}>
        <PanelContainer ref={railTargetRef} {...rest}>
          <PanelGlow>
            {/* Only a floating (overlay) header sits outside the scroller, as a
                sibling above it painting over the bleed body. Every other header
                is a sticky child of the scroller (in `body`), so there is no
                scroll-away ghost to re-surface. */}
            {/* Only when there is no sidebar: with one, the header is hosted
                inside the body track instead (see `floatingBody`). */}
            {floatingHeader && panelSidebar === undefined && header}
            {bodyRegion}
          </PanelGlow>
          {/* After the glow region, so it sits below the scroller and stays
              pinned while the body scrolls. */}
          {panelFooter !== undefined && (
            <PanelFooter>{panelFooter}</PanelFooter>
          )}
        </PanelContainer>
      </PanelRailTargetContext.Provider>
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
  Split: PanelSplit,
  Sidebar: PanelSidebar,
  // The single interface the title-redesign ghost dot consumes. Producing the
  // summary is this file's concern; painting it (the ghost) is the title spec's.
  useStatusSummary,
});
