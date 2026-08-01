import type { StreamStatusValue } from "@ksp-gonogo/sitrep-sdk"; // erased at build; no runtime edge
import {
  type ComponentPropsWithoutRef,
  createContext,
  forwardRef,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import styled from "styled-components";
import { StreamStatusBadge } from "./StreamStatusBadge";
import { useElementSize } from "./useElementSize";

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
 * The stream status of the widget this panel belongs to, supplied by the
 * host rather than by the widget.
 *
 * A widget's status is derivable: it already declares `dataRequirements` when
 * it registers, and the host already knows how stale each of those topics is.
 * Twenty-five widgets nonetheless hand-wired their own
 * `useDataStreamStatus("data", <a key picked by hand>)` and rendered their own
 * badge, and twenty-two of those keys were simply one of the widget's own
 * declared requirements. That is a derivation, written out longhand,
 * twenty-five times, and it is worse than the derivation: a widget whose
 * SECOND topic goes stale keeps reporting "live", because only the
 * hand-picked one was ever consulted.
 *
 * So the host provides it and the panel renders it. `null` means no host is
 * providing one (a panel outside the dashboard: a settings modal, the station
 * connect view), which renders no badge at all, the same as healthy.
 *
 * The type comes from the sdk rather than `@ksp-gonogo/sitrep-client`: the kit
 * is published and the client is private, so only the sdk's mirrored copy can
 * be named here. It is a type-only import, erased at build.
 */
const PanelStatusCtx = createContext<StreamStatusValue | null>(null);

export function PanelStatusProvider({
  status,
  children,
}: {
  status: StreamStatusValue | null;
  children?: ReactNode;
}) {
  return (
    <PanelStatusCtx.Provider value={status}>{children}</PanelStatusCtx.Provider>
  );
}

/**
 * The host-derived stream status for the current widget, or `null` outside a
 * dashboard. Exposed for the rare widget that wants to react to staleness in
 * its body rather than just show the badge.
 */
export function usePanelStreamStatus(): StreamStatusValue | null {
  return useContext(PanelStatusCtx);
}

export const PanelContainer = styled.div`
  /* Chrome only. The inset belongs to Panel.Body and the glow to Panel.Glow;
     this is the border, the surface and the clip, and nothing else. */
  background: var(--color-surface-panel);
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
  padding: var(--space-12, 12px) var(--space-16, 16px) var(--space-8, 8px);
  font-size: var(--font-size-xs);
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;

export const PanelSubtitle = styled.div`
  padding: 0 var(--space-16, 16px);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  letter-spacing: 0.05em;
  /* Off the spacing ladder: -4px is half PanelTitle's 8px bottom inset, a
     derived value rather than a chosen one. Recompute it if that inset moves;
     do not point it at a rung. */
  margin-top: -4px;
`;

const PanelHeader__Row = styled.div<{ $overlay?: boolean }>`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-8, 8px);
  min-width: 0;
  /* Wrap rather than crush. Widgets are small and get smaller, and an aside
     carrying a tally or a select will not fit beside the title at every tile
     width. Given the choice between the aside dropping to its own row and the
     title being squeezed to an ellipsis, the second row is the honest one:
     both stay readable, and the panel grows by exactly the height it needs. */
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
  /* Grow to fill the line it lands on. Alone this only right-aligns the whole
     aside, which is right for the common case (a chip or two) but not for an
     aside carrying a headline readout AND badges: that widget wants its state
     reading left and only the badges floating right, which it gets by making
     its own aside content a full-width row. Growing the box is what gives it a
     row to align within; a shrink-to-fit box has none. */
  flex-grow: 1;
  /* Wraps internally too, so a multi-chip aside stacks its own contents
     rather than forcing the whole aside onto a third row. */
  flex-wrap: wrap;
  justify-content: flex-end;
  flex-shrink: 0;
  /* PanelTitle owns the left inset and the vertical rhythm; mirror both here
     so the badges line up with the title rather than the panel edge. */
  padding: var(--space-12, 12px) var(--space-16, 16px) var(--space-8, 8px);
  ${({ $overlay }) => ($overlay ? OVERLAY_BOX : "")}
`;

/**
 * Title, optional subtitle, and an optional right-hand aside on one row.
 *
 * The aside is why this exists. Twenty-seven of forty-three widgets had grown
 * a bespoke `TitleRow`/`Header` styled div for exactly this, and what went in
 * it was not varied: a stream-status badge (37 occurrences), an `AugmentSlot`
 * for Uplink badges (19), the odd state `Badge` or `Select`. Twenty-seven
 * hand-rolled rows for two recurring things is a missing name, so this is the
 * name.
 */
export function PanelHeader({
  title,
  subtitle,
  aside,
  toolbar,
  overlay,
  ...rest
}: Omit<ComponentPropsWithoutRef<"div">, "title"> & {
  title?: ReactNode;
  subtitle?: ReactNode;
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
  return (
    /* `data-panel-header` is a stable targeting hook, the same contract as
       ScrollArea's `data-scroll-area-inner`. The row splits titles and aside
       into two boxes so they can align independently, which means walking up
       from the title with `closest("div")` reaches the titles box and NOT the
       aside beside it. Anything that wants "the whole header" should say so
       by name rather than by counting ancestors. */
    <PanelHeader__Row data-panel-header="" $overlay={overlay} {...rest}>
      <PanelHeader__Titles $overlay={overlay}>
        {title !== undefined && <PanelTitle>{title}</PanelTitle>}
        {subtitle !== undefined && <PanelSubtitle>{subtitle}</PanelSubtitle>}
      </PanelHeader__Titles>
      {aside !== undefined && (
        <PanelHeader__Aside $overlay={overlay}>{aside}</PanelHeader__Aside>
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
     would not be reproducible. */
  ${({ $fitToSize }) => ($fitToSize ? "flex: 0 1 auto; overflow: hidden;" : "")}
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
  /* Extend past the scroll container so the glow sits flush with the panel
     chrome rather than the inner edge. Zero unless a consumer publishes the
     pad vars (a widget that puts its own inset between the two); the panel
     itself needs none, because Panel.Body's inset is inside the scroller. */
  left: calc(-1 * var(--scroll-glow-pad-x, 0px));
  right: calc(-1 * var(--scroll-glow-pad-x, 0px));
  ${({ $position }) =>
    $position === "top"
      ? "top: calc(-1 * var(--scroll-glow-pad-y, 0px));"
      : "bottom: calc(-1 * var(--scroll-glow-pad-y, 0px));"}
  height: calc(16px + var(--scroll-glow-pad-y, 0px));
  pointer-events: none;
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  transition: opacity var(--duration-base, 150ms) var(--ease-standard, ease);
  /* Full-width linear fade anchored on the chrome edge, brightest right at
     the scrollable boundary and tapering inward across the whole width. A
     centred radial ellipse read as a discrete glowing blob floating over the
     content; a full-width edge fade reads as the content itself dissolving
     under a soft overlay at the edge, which is the intended "there's more,
     scroll" affordance. */
  background: linear-gradient(
    ${({ $position }) => ($position === "top" ? "to bottom" : "to top")},
    rgba(255, 255, 255, 0.13),
    rgba(255, 255, 255, 0)
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
 * `auto` means the panel chooses. Today that is: the axis from the tile's
 * shape (see `PanelSplit`) and `end` within it, which is what the two
 * arrangements a sidebar widget actually wants both resolve to, a right-hand
 * column on a wide tile and a bottom strip on a tall one.
 */
export type PanelSidebarSide = "auto" | "start" | "end";

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
  /** See `PanelSidebarSide`. Defaults to `auto`. */
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
  side = "auto",
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
  const resolvedSide = side === "auto" ? "end" : side;
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
      $side={resolvedSide}
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
 * unitless zero sat in it unnoticed so the glow never rendered at all. There
 * is no pad var between the panel's own parts now, because the inset lives
 * inside the scroller.
 */
export function PanelGlow({
  children,
  ...rest
}: ComponentPropsWithoutRef<"div">) {
  const ctx = useContext(PanelCtx);
  const el = ctx?.scroller ?? null;
  const [overflow, setOverflow] = useState({ top: false, bottom: false });

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

  useEffect(() => {
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
// Every piece below is reachable as `Panel.Container` / `.Title` / `.Subtitle`
// / `.Glow` / `.Body`.
//
// `Panel.Glow` WRAPS the scrolling region rather than sitting beside it, so it
// owns both the glow's behaviour and the inset compensation it needs. That
// replaces a `--scroll-glow-pad-*` var contract shared between three
// components with no owner, which is exactly how a unitless `0` sat in the
// scrollable shell making `calc(-1 * 0)` invalid, so the glow never rendered
// there at all.
//
// Title, subtitle and toolbar sit inside the glow but BESIDE the body rather
// than in it, and the body is the scroller, so the header stays pinned while
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
  panelSubtitle?: ReactNode;
  /**
   * Content for the right of the header row, beside the stream-status badge:
   * state chips, an `AugmentSlot` for Uplink badges, a small control such as a
   * select or a show/hide button.
   *
   * Named `aside` rather than `badges` because it is not only badges. It began
   * as a badge slot and immediately started carrying PowerSystems' resource
   * select and CrewManifest's meters toggle, which is the normal case rather
   * than an abuse: whatever a widget puts next to its title belongs here.
   *
   * Keep it small all the same. This is a header slot, not a second body;
   * anything that wants real layout should be in the body or in a
   * hand-composed `Panel.Header`.
   */
  panelAside?: ReactNode;
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
}

function PanelRoot({
  panelTitle,
  panelSubtitle,
  panelAside,
  panelStatus,
  panelToolbar,
  floatingHeader,
  fitToSize,
  panelSidebar,
  sidebarSide,
  sidebarSize,
  children,
  ...rest
}: PanelProps) {
  // A panel only shows a status badge if it ALREADY has a header. An
  // unmigrated widget (children only, its own bespoke title row inside) must
  // not sprout a header and a padded body the moment its stream degrades:
  // that would restructure the widget on a data transition, which is both a
  // layout surprise and impossible to see coming in review. Such a widget
  // simply keeps showing no badge until it moves to `panelTitle`.
  const hasHeader =
    panelTitle !== undefined ||
    panelSubtitle !== undefined ||
    panelAside !== undefined ||
    panelToolbar !== undefined;

  const derived = usePanelStreamStatus();
  const status = panelStatus ?? derived;
  const statusBadge =
    !hasHeader || status === null || status === "none" ? null : (
      <StreamStatusBadge status={status} />
    );
  // `undefined`, not `null`: PanelHeader treats undefined as "no aside at all"
  // and skips the box, where a null child would still render the padded slot.
  const aside =
    panelAside === undefined && statusBadge === null ? undefined : (
      <>
        {panelAside}
        {statusBadge}
      </>
    );

  if (!hasHeader) {
    return <PanelContainer {...rest}>{children}</PanelContainer>;
  }
  const body = (
    <PanelBody fitToSize={fitToSize} bleed={floatingHeader}>
      {children}
    </PanelBody>
  );
  return (
    <PanelContextProvider>
      <PanelContainer {...rest}>
        <PanelGlow>
          <PanelHeader
            title={panelTitle}
            subtitle={panelSubtitle}
            aside={aside}
            toolbar={panelToolbar}
            overlay={floatingHeader}
          />
          {/* Header order is deliberate: the header is written first so it
              stays first in the DOM, and therefore first in reading and tab
              order, whether it floats or reserves a row. Overlay is a paint
              change, not a structural one.

              No sidebar means no split either: the body stays a direct child
              of the glow, the exact element tree every existing widget already
              renders. Adding an always-present grid wrapper would have been
              tidier to write and would have re-laid-out forty widgets that
              never asked for one. */}
          {panelSidebar === undefined ? (
            body
          ) : (
            <PanelSplit side={sidebarSide} size={sidebarSize}>
              {body}
              {/* Written after the body on purpose; `sidebarSide` moves it
                  visually and never in the DOM. */}
              <PanelSidebar>{panelSidebar}</PanelSidebar>
            </PanelSplit>
          )}
        </PanelGlow>
      </PanelContainer>
    </PanelContextProvider>
  );
}

export const Panel = Object.assign(PanelRoot, {
  Context: PanelContextProvider,
  Container: PanelContainer,
  Header: PanelHeader,
  Toolbar: PanelToolbar,
  Title: PanelTitle,
  Subtitle: PanelSubtitle,
  Glow: PanelGlow,
  Body: PanelBody,
  Split: PanelSplit,
  Sidebar: PanelSidebar,
  Status: PanelStatusProvider,
  useStreamStatus: usePanelStreamStatus,
});
