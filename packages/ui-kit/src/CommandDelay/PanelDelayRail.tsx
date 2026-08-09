import { useEffect, useRef, useState } from "react";
import styled, { css } from "styled-components";
import { CommandDelay } from "./CommandDelay";
import { type CommandHandle, useActiveHandles } from "./DelayRailContext";
import { usePanelRailTarget } from "./PanelRailTarget";

/**
 * Whether a handle's `CommandDelay` would draw anything: a stream with real
 * delay, or a discrete handle with in-flight rows. Mirrors `CommandDelay`'s own
 * null-decision so the rail shows a handle iff its `CommandDelay` renders. An
 * instant / idle command (a meta-vantage or not-yet-dispatched handle) is still
 * registered, so its must-consume token is marked and it appears the instant it
 * goes in flight, but it contributes no rail chrome meanwhile.
 */
function handleHasContent(handle: CommandHandle): boolean {
  if (handle.shape === "stream") return handle.effectiveDelaySeconds > 0;
  return handle.inFlight.length > 0;
}

/**
 * The Panel-owned signal-delay rail. Reads the active command handles from the
 * nearest `DelayRailContext` (populated by `usePanelDelay` in the widget) and
 * renders each handle's delay UI through `CommandDelay`. Takes no prop: it is
 * context-collecting, so a command widget passes nothing.
 *
 * v3/v4 shape: the rail is a single `<button>` sitting flush at the true top
 * edge, spanning the full widget width, in normal flow above the Panel title.
 * Collapsed it is the 16px drag-bar strip (grazing glows for discrete commands,
 * a mini sparkline for a stream); with several commands in flight their
 * summaries overlay in that one band. Activating it (click / Enter / Space,
 * native `<button>`; Esc collapses) PINS it, and pinning GROWS the rail in real
 * layout space: each command switches to its fuller `inline` view (the discrete
 * list, the full-height stream graph with its labels back), the button's height
 * grows, and because that measured height feeds `--panel-rail-height`, the Panel
 * title and body are pushed DOWN. It never overlays anything, it takes space.
 * `aria-pressed` / `aria-expanded` carry the state. Activating it AGAIN
 * (click / Enter / Space / Esc) un-pins and re-minifies it: pin is a true
 * toggle, not a one-way expand, and the pinned rail shows a small "▲"
 * hint so that's discoverable, not just present in the aria-label (which
 * carries the word "collapse" for assistive tech; the visible hint stays
 * icon-only). Hover
 * separately grows it as a transient preview (pointer devices only, gone on
 * pointer-leave, a no-op once pinned); an explicit un-pin click wins over a
 * pointer that simply hasn't moved off the rail yet, see
 * `suppressHoverPreview` below.
 *
 * Renders `null` when no active handle has anything to draw, so a widget whose
 * commands are all instant or idle gets no rail element at all and the panel
 * reads the `var(--panel-rail-height, 0px)` fallback.
 */
export function PanelDelayRail() {
  const handles = useActiveHandles();
  const visible = handles.filter(handleHasContent);
  const hasContent = visible.length > 0;
  const railRef = useRef<HTMLButtonElement>(null);
  const targetRef = usePanelRailTarget();
  const [pinned, setPinned] = useState(false);
  // Suppresses the CSS hover-preview immediately after an explicit un-pin
  // click made while the pointer is still over the rail, the common case
  // (the pointer is right there because the operator just clicked it). Without
  // this, `:hover` alone keeps forcing the grown layout, so the click's
  // un-pin is invisible until the pointer happens to leave, reading as "there
  // is no way to collapse it back".
  //
  // Cleared on the pointer's next genuine ENTRY, not its exit: collapsing the
  // rail out from under a stationary pointer changes the CSS `:hover` match
  // (browsers re-run hit-testing after layout) WITHOUT dispatching a real
  // `mouseleave` DOM event, real leave/enter events only fire on actual
  // pointer movement, so a leave-triggered clear can be silently skipped when
  // the click lands beyond the collapsed strip's shorter bounds. A fresh
  // `mouseenter`, by contrast, is spec-guaranteed on real re-entry, so it is
  // the reliable place to lift the suppression for the next hover.
  const [suppressHoverPreview, setSuppressHoverPreview] = useState(false);

  // Re-run when the rail mounts / unmounts (hasContent flip). On mount it
  // observes the rail and publishes its height onto the target element; on
  // unmount it removes the var so the panel falls back to 0px. The single
  // ResizeObserver watches ONLY the rail element, so a pin GROWING the rail
  // republishes the taller height (pushing the header + body down) with no
  // measure-render-measure loop. hasContent is the mount/unmount TRIGGER, not a
  // value read in the body, which the exhaustive-deps rule cannot see.
  // biome-ignore lint/correctness/useExhaustiveDependencies: hasContent is the rail-mount/unmount trigger, not a body input
  useEffect(() => {
    const rail = railRef.current;
    const target = targetRef?.current;
    if (!rail || !target || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const height = entries[entries.length - 1]?.contentRect.height ?? 0;
      target.style.setProperty("--panel-rail-height", `${height}px`);
    });
    ro.observe(rail);
    return () => {
      ro.disconnect();
      target.style.removeProperty("--panel-rail-height");
    };
  }, [hasContent, targetRef]);

  if (!hasContent) return null;

  // Stream(s) on top, discrete underneath (operator's v3 ordering): a stable
  // partition, streams keep their order, discrete keep theirs.
  const ordered = [
    ...visible.filter((h) => h.shape === "stream"),
    ...visible.filter((h) => h.shape !== "stream"),
  ];

  return (
    <PanelDelayRail__Rail
      type="button"
      data-panel-rail=""
      ref={railRef}
      data-pinned={pinned}
      data-suppress-hover={suppressHoverPreview}
      aria-pressed={pinned}
      aria-expanded={pinned}
      aria-label={
        pinned
          ? "Signal-delay detail; activate to collapse"
          : "Signal-delay detail; activate to expand it in place"
      }
      onClick={() => {
        setPinned((p) => {
          const next = !p;
          if (!next) setSuppressHoverPreview(true);
          return next;
        });
      }}
      onMouseEnter={() => setSuppressHoverPreview(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && pinned) {
          e.stopPropagation();
          setPinned(false);
        }
      }}
    >
      {pinned && (
        <PanelDelayRail__CollapseHint aria-hidden="true">
          ▲
        </PanelDelayRail__CollapseHint>
      )}
      {ordered.map((h) => (
        <CommandDelay
          key={h.id}
          handle={h}
          variant={pinned ? "expanded" : "rail"}
          ariaLabel={pinned ? "Delay detail" : undefined}
        />
      ))}
    </PanelDelayRail__Rail>
  );
}

/**
 * The rail button. Flush to the true top-left-right edges (cancels the body's
 * own top + side inset, so it sits at the very top with no dead band above it
 * and spans the full width; the sticky header's offset accounts for the flush
 * rail, see PanelStickyHeader). A real `<button>` for the pin disclosure, reset
 * to carry no button chrome.
 *
 * Collapsed (the resting state, kept COMPACT): a thin band, all handles OVERLAID
 * (grid, every child in the one cell) so several grazing glows + a mini sparkline
 * share the top edge rather than crowd, the title sits just below with normal
 * padding, no reserved dead space. GROWN on hover OR pin (click): the band
 * becomes a flex column that stacks each command's fuller view and expands into
 * real layout space, which republishes `--panel-rail-height` and pushes the
 * title + body DOWN (the operator is happy for content to slide on expand;
 * growth eats the stream-to-title padding first). Hover is a transient preview
 * on pointer devices; a click PINS it open. Coarse pointers get a taller
 * collapsed strip and rely on the pin (no hover).
 */
const grownRail = css`
  display: flex;
  flex-direction: column;
  gap: var(--space-8, 8px);
  /* Generous cap the grown content fits inside; the visible height settles at
     the content height, the extra headroom is never seen. A stream + discrete
     combined rail needs the room, so nothing clips. */
  max-height: 800px;
  /* Fully full-bleed: no padding at all, so the pinned stream GRAPH spans the
     true widget width edge to edge and grazes the top. Each child owns its own
     inset instead: the stream's legend row takes the standard content margin,
     and the discrete row-container insets itself evenly. */
  padding: 0;

  & > * {
    grid-area: auto;
  }
`;

const PanelDelayRail__Rail = styled.button`
  appearance: none;
  border: 0;
  /* Never let the scroller's flex layout shrink the grown rail below its content
     (that would clip the lower stacked commands under overflow:hidden): the rail
     takes its full height and the body scrolls under it. */
  flex: 0 0 auto;
  margin: calc(-1 * var(--space-8, 8px)) calc(-1 * var(--space-16, 16px)) 0;
  padding: 0;
  /* Positioning context for the pinned-only collapse hint below. */
  position: relative;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-align: inherit;

  /* Collapsed: one 16px band, children stacked in a single grid cell. Height is
     capped by max-height so pinning can animate it open (auto is not
     animatable): the element's height follows min(content, max-height), so
     growing the cap grows the rail smoothly and shrinking it collapses it. */
  display: grid;
  height: auto;
  /* Cap collapsed height so it stays a thin band: a discrete-only rail settles
     at its 16px grazing-glow height (height:auto), a stream at its 32px mini
     graph, both under this cap. */
  max-height: 32px;
  overflow: hidden;
  transition: max-height var(--duration-slow, 200ms) var(--ease-standard, ease);

  & > * {
    grid-area: 1 / 1;
  }

  @media (pointer: coarse) {
    max-height: 36px;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: -2px;
  }

  /* Pinned (sticky) grows. */
  &[data-pinned="true"] {
    ${grownRail}
  }

  /* Hover is a transient preview grow on pointer devices only (touch has no
     hover and relies on the pin). A pinned rail is already grown, so hover is a
     no-op there. The data-suppress-hover exclusion is the un-pin-while-hovering
     escape hatch above: an explicit click-to-collapse wins over a pointer that
     merely never moved. */
  @media (hover: hover) {
    &:hover:not([data-suppress-hover="true"]) {
      ${grownRail}
    }
  }
`;

/**
 * The pinned-only visible cue that the rail is a toggle: a click (or Enter /
 * Space, it is the same `<button>`) collapses it back to the minified strip.
 * `aria-hidden`, the button's own `aria-label` already carries this for
 * assistive tech; this is purely the sighted affordance so pinning doesn't
 * read as a one-way action.
 */
const PanelDelayRail__CollapseHint = styled.span`
  position: absolute;
  top: var(--space-4, 4px);
  right: var(--space-16, 16px);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  pointer-events: none;
  z-index: 1;
`;
