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

const PanelHeader__Row = styled.div`
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
`;

const PanelHeader__Titles = styled.div`
  min-width: 0;
`;

const PanelHeader__Aside = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-4, 4px);
  /* Wraps internally too, so a multi-chip aside stacks its own contents
     rather than forcing the whole aside onto a third row. */
  flex-wrap: wrap;
  justify-content: flex-end;
  flex-shrink: 0;
  /* PanelTitle owns the left inset and the vertical rhythm; mirror both here
     so the badges line up with the title rather than the panel edge. */
  padding: var(--space-12, 12px) var(--space-16, 16px) var(--space-8, 8px);
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
  ...rest
}: Omit<ComponentPropsWithoutRef<"div">, "title"> & {
  title?: ReactNode;
  subtitle?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    /* `data-panel-header` is a stable targeting hook, the same contract as
       ScrollArea's `data-scroll-area-inner`. The row splits titles and aside
       into two boxes so they can align independently, which means walking up
       from the title with `closest("div")` reaches the titles box and NOT the
       aside beside it. Anything that wants "the whole header" should say so
       by name rather than by counting ancestors. */
    <PanelHeader__Row data-panel-header="" {...rest}>
      <PanelHeader__Titles>
        {title !== undefined && <PanelTitle>{title}</PanelTitle>}
        {subtitle !== undefined && <PanelSubtitle>{subtitle}</PanelSubtitle>}
      </PanelHeader__Titles>
      {aside !== undefined && <PanelHeader__Aside>{aside}</PanelHeader__Aside>}
    </PanelHeader__Row>
  );
}

const PanelBody__Box = styled.div<{ $fitToSize?: boolean }>`
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
`;

/**
 * The content box, the inset, and the scrolling. Registers itself with the
 * panel context so `Panel.Glow` can observe it without reaching into the tree.
 */
export function PanelBody({
  children,
  fitToSize,
  ...rest
}: ComponentPropsWithoutRef<"div"> & { fitToSize?: boolean }) {
  const ctx = useContext(PanelCtx);
  const register = ctx?.registerScroller;
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      register?.(el);
    },
    [register],
  );
  return (
    <PanelBody__Box ref={ref} $fitToSize={fitToSize} {...rest}>
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
// Title and subtitle sit INSIDE the glow, so they scroll with the body. That
// is today's behaviour (the retired `PanelScrollable` wrapped ALL its children
// in the scroll area, so a widget passing a title got a scrolling title) and it
// is kept deliberately: pinning the header is wanted, but as its own pass
// rather than as a side effect of adding padding to 43 widgets. Because the
// composition is explicit, that later pass changes this one default rather
// than every widget.
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
   * Content is sized to fit and never scrolls. Forwarded to `Panel.Body`
   * rather than handled here, so manual composition stays reproducible.
   */
  fitToSize?: boolean;
}

function PanelRoot({
  panelTitle,
  panelSubtitle,
  panelAside,
  panelStatus,
  fitToSize,
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
    panelAside !== undefined;

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
  return (
    <PanelContextProvider>
      <PanelContainer {...rest}>
        <PanelGlow>
          <PanelHeader
            title={panelTitle}
            subtitle={panelSubtitle}
            aside={aside}
          />
          <PanelBody fitToSize={fitToSize}>{children}</PanelBody>
        </PanelGlow>
      </PanelContainer>
    </PanelContextProvider>
  );
}

export const Panel = Object.assign(PanelRoot, {
  Context: PanelContextProvider,
  Container: PanelContainer,
  Header: PanelHeader,
  Title: PanelTitle,
  Subtitle: PanelSubtitle,
  Glow: PanelGlow,
  Body: PanelBody,
  Status: PanelStatusProvider,
  useStreamStatus: usePanelStreamStatus,
});
