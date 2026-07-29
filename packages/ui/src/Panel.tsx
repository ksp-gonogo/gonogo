import {
  type ComponentPropsWithoutRef,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import styled from "styled-components";

export const Panel = styled.div`
  /* Glow extension picked up by ScrollArea: descendant glows extend by these
     amounts so they sit flush with the panel chrome rather than the inner
     scroll-container edge. Panel's overflow:hidden clips the overhang. The
     Panel itself imposes NO content inset (full-bleed standard, content
     reaches every edge; margin lives outside, in the dashboard gutter), so a
     ScrollArea that sits DIRECTLY in the Panel body needs no glow extension.
     A ScrollArea nested inside a padded PanelBody re-sets these to PanelBody's
     inset so its glow still reaches the chrome. */
  --scroll-glow-pad-y: 0px;
  --scroll-glow-pad-x: 0px;

  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  /* Full-bleed: no uniform content inset. Visual content (charts/maps/gauges/
     plots/full-width lists) bleeds to the body edge; text/readouts stay
     readable via LOCAL padding on PanelTitle/PanelSubtitle and PanelBody. */
  padding: 0;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
`;

/* The header IS text, so it carries its own inset (the Panel no longer does).
   Rendered as a direct Panel child by ~every widget, so self-padding here keeps
   all headers readable with no per-widget change while the body below bleeds. */
export const PanelTitle = styled.h3`
  margin: 0;
  padding: var(--space-12) var(--space-16) var(--space-8);
  font-size: var(--font-size-xs);
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;

export const PanelSubtitle = styled.div`
  padding: 0 var(--space-16);
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  letter-spacing: 0.05em;
  /* Off the spacing ladder: -4px is half PanelTitle's 8px bottom inset, a
     derived value rather than a chosen one. Recompute it if that inset moves;
     do not point it at a rung. */
  margin-top: -4px;
`;

/**
 * Padded body region for TEXT/readout content, restoring the standard inset the
 * Panel no longer imposes (full-bleed standard). Wrap a widget's textual body
 * in this so it stays readable; leave VISUAL content (charts, maps, gauges,
 * plots, full-width list rows) directly in the Panel so it bleeds to the edge.
 * Fills the remaining Panel height (`flex:1; min-height:0`) and re-sets the
 * ScrollArea glow-pad vars to its own inset so a nested ScrollArea's edge glow
 * still reaches the Panel chrome.
 */
export const PanelBody = styled.div`
  --scroll-glow-pad-y: var(--space-8);
  --scroll-glow-pad-x: var(--space-16);
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  padding: var(--space-8) var(--space-16) var(--space-12);
`;

const ScrollAreaRoot = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
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
  /* Extend horizontally past the scroll container so the glow sits flush with
     the panel chrome's left/right borders. Panel's overflow:hidden clips it. */
  left: calc(-1 * var(--scroll-glow-pad-x, 0px));
  right: calc(-1 * var(--scroll-glow-pad-x, 0px));
  ${({ $position }) =>
    $position === "top"
      ? "top: calc(-1 * var(--scroll-glow-pad-y, 0px));"
      : "bottom: calc(-1 * var(--scroll-glow-pad-y, 0px));"}
  height: calc(16px + var(--scroll-glow-pad-y, 0px));
  pointer-events: none;
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  transition: opacity var(--duration-base) var(--ease-standard);
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
  /* Local sibling ordering inside ScrollAreaRoot only (the glow over the
     scrolling inner element). Off the app-global z ladder on purpose: any
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

const PanelScrollableShell = styled(Panel)`
  padding: 0;
  gap: 0;
  /* Shell has no padding, so the inner ScrollArea already fills the panel,
     no glow extension needed. Units are required, not cosmetic: these feed
     calc(), where calc(-1 * 0) yields a number rather than a length and
     calc(16px + 0) is invalid outright, so a unitless zero dropped BOTH the
     glow's offset and its height and the glow never rendered inside a
     scrollable shell at all. */
  --scroll-glow-pad-y: 0px;
  --scroll-glow-pad-x: 0px;
`;

const PanelScrollableArea = styled(ScrollArea)`
  flex: 1;
`;

const PanelScrollableContent = styled.div`
  padding: var(--space-12) var(--space-16);
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
`;

export const PanelScrollable = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<"div">
>(function PanelScrollable({ children, ...rest }, ref) {
  return (
    <PanelScrollableShell {...rest}>
      <PanelScrollableArea ref={ref}>
        <PanelScrollableContent>{children}</PanelScrollableContent>
      </PanelScrollableArea>
    </PanelScrollableShell>
  );
});

export const Placeholder = styled.span`
  font-size: var(--font-size-sm);
  color: var(--color-text-faint);
`;
